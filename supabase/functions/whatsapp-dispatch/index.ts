/**
 * whatsapp-dispatch — the outbox worker.
 *
 * Invoked every minute by pg_cron. Claims due messages with
 * FOR UPDATE SKIP LOCKED so two overlapping runs can never send the same
 * message twice, sends them through the provider adapter, and records the
 * real outcome with exponential backoff on transient failures.
 *
 * Deploy:  supabase functions deploy whatsapp-dispatch --no-verify-jwt
 * Secrets: supabase secrets set WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { createProvider, requireEnv, WhatsAppSendError } from '../_shared/whatsapp-provider.ts'

const BATCH_SIZE = 20

// 1m, 5m, 30m, 2h, 6h — long enough to ride out an outage, short enough that
// an order-ready message still arrives while it is useful.
const BACKOFF_MINUTES = [1, 5, 30, 120, 360]

interface QueuedMessage {
  id: string
  to_msisdn: string
  variables: string[]
  attempts: number
  max_attempts: number
  template: { provider_template_name: string; language: string } | null
}

Deno.serve(async (req) => {
  // Only the cron job or an admin should be able to run this.
  const secret = req.headers.get('x-dispatch-secret')
  if (secret !== requireEnv('DISPATCH_SECRET')) {
    return json({ error: 'unauthorized' }, 401)
  }

  const supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  )

  let provider
  try {
    provider = createProvider()
  } catch (err) {
    console.error('[dispatch] provider not configured:', err)
    return json({ error: 'provider not configured', detail: String(err) }, 503)
  }

  // Claim a batch atomically. claim_whatsapp_batch flips the rows to 'sending'
  // inside one transaction, so a concurrent run sees none of them.
  const { data: claimed, error: claimError } = await supabase.rpc('claim_whatsapp_batch', {
    p_limit: BATCH_SIZE,
  })
  if (claimError) {
    console.error('[dispatch] could not claim messages:', claimError)
    return json({ error: 'claim failed' }, 500)
  }

  const messages = (claimed ?? []) as QueuedMessage[]
  let sent = 0
  let failed = 0

  for (const message of messages) {
    if (!message.template) {
      await supabase
        .from('whatsapp_messages')
        .update({
          status: 'failed',
          error_code: 'no_template',
          error_message: 'The template linked to this message no longer exists.',
        })
        .eq('id', message.id)
      failed++
      continue
    }

    try {
      const result = await provider.sendTemplate({
        to: message.to_msisdn,
        templateName: message.template.provider_template_name,
        languageCode: message.template.language,
        variables: (message.variables ?? []).map(String),
      })

      await supabase
        .from('whatsapp_messages')
        .update({
          status: 'sent',
          provider: provider.name,
          provider_message_id: result.providerMessageId,
          sent_at: new Date().toISOString(),
          attempts: message.attempts + 1,
          error_code: null,
          error_message: null,
        })
        .eq('id', message.id)
      sent++
    } catch (err) {
      const attempts = message.attempts + 1
      const isSendError = err instanceof WhatsAppSendError
      const permanent = isSendError && err.permanent
      const exhausted = attempts >= message.max_attempts
      const giveUp = permanent || exhausted

      const backoff = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]

      await supabase
        .from('whatsapp_messages')
        .update({
          status: giveUp ? 'failed' : 'queued',
          attempts,
          error_code: isSendError ? err.code : 'unknown',
          error_message: err instanceof Error ? err.message : String(err),
          next_attempt_at: giveUp
            ? new Date().toISOString()
            : new Date(Date.now() + backoff * 60_000).toISOString(),
        })
        .eq('id', message.id)

      failed++
      console.error(`[dispatch] ${message.id} failed (attempt ${attempts}, permanent=${permanent}):`, err)
    }
  }

  return json({ claimed: messages.length, sent, failed })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
