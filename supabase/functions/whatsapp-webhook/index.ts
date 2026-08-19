/**
 * whatsapp-webhook — receives delivery receipts and inbound replies from Meta.
 *
 * This is how a message becomes genuinely "delivered" or "read": we never set
 * those statuses ourselves, only when Meta tells us. Manual sends stay at
 * "opened" forever, because nobody ever reports on them.
 *
 * Deploy: supabase functions deploy whatsapp-webhook --no-verify-jwt
 * Then set the callback URL in the Meta app dashboard to this function's URL.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { requireEnv } from '../_shared/whatsapp-provider.ts'

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // ── Meta's verification handshake (GET, once at setup) ───────────────────
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === requireEnv('WHATSAPP_VERIFY_TOKEN')) {
      return new Response(challenge ?? '', { status: 200 })
    }
    return new Response('forbidden', { status: 403 })
  }

  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  // ── Signature check ──────────────────────────────────────────────────────
  // Without this anyone who learns the URL could forge delivery receipts.
  const raw = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  if (!(await isValidSignature(raw, signature, requireEnv('WHATSAPP_APP_SECRET')))) {
    console.warn('[webhook] rejected a request with an invalid signature')
    return new Response('invalid signature', { status: 401 })
  }

  const supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  )

  let payload: MetaWebhookPayload
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('bad json', { status: 400 })
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {}

      // ── Delivery status updates ──────────────────────────────────────────
      for (const status of value.statuses ?? []) {
        const at = new Date(Number(status.timestamp) * 1000).toISOString()

        const patch: Record<string, unknown> = { status: status.status }
        if (status.status === 'delivered') patch.delivered_at = at
        if (status.status === 'read') patch.read_at = at
        if (status.status === 'sent') patch.sent_at = at
        if (status.status === 'failed') {
          patch.error_code = String(status.errors?.[0]?.code ?? 'unknown')
          patch.error_message = status.errors?.[0]?.title ?? 'Delivery failed'
        }

        // Never downgrade: a late "sent" must not overwrite "read".
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 3 }
        const { data: existing } = await supabase
          .from('whatsapp_messages')
          .select('status')
          .eq('provider_message_id', status.id)
          .maybeSingle()

        if (existing && (rank[status.status] ?? 0) < (rank[existing.status] ?? 0)) continue

        const { error } = await supabase
          .from('whatsapp_messages')
          .update(patch)
          .eq('provider_message_id', status.id)
        if (error) console.error('[webhook] status update failed:', error)
      }

      // ── Inbound customer replies ─────────────────────────────────────────
      for (const message of value.messages ?? []) {
        const from = message.from
        const { data: customer } = await supabase
          .from('customers')
          .select('id')
          .or(`mobile.eq.${from.slice(-10)},whatsapp_number.eq.${from.slice(-10)}`)
          .limit(1)
          .maybeSingle()

        const { error } = await supabase.from('whatsapp_inbound').insert({
          from_msisdn: from,
          customer_id: customer?.id ?? null,
          provider_message_id: message.id,
          message_type: message.type,
          body: message.text?.body ?? message.button?.text ?? null,
          raw: message,
        })
        // A duplicate delivery of the same webhook is normal; ignore the clash.
        if (error && error.code !== '23505') console.error('[webhook] inbound insert failed:', error)
      }
    }
  }

  // Always 200 quickly: Meta retries aggressively on anything else.
  return new Response('ok', { status: 200 })
})

/** HMAC-SHA256 of the raw body, compared in constant time. */
async function isValidSignature(
  body: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const received = header.slice('sha256='.length)

  if (expected.length !== received.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i)
  }
  return diff === 0
}

interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: Array<{
          id: string
          status: string
          timestamp: string
          errors?: Array<{ code: number; title: string }>
        }>
        messages?: Array<{
          id: string
          from: string
          type: string
          text?: { body: string }
          button?: { text: string }
        }>
      }
    }>
  }>
}
