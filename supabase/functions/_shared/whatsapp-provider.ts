/**
 * WhatsApp provider adapter.
 *
 * The rest of the system talks to this interface only, so switching from Meta
 * Cloud API to a BSP (AiSensy, Interakt, Gupshup) is one new implementation
 * and one settings change — no other file moves. (docs/ARCHITECTURE.md §6.1)
 */

export interface SendTemplateInput {
  to: string // digits only, country code included
  templateName: string
  languageCode: string
  variables: string[] // ordered, matching {{1}}, {{2}}, …
}

export interface SendResult {
  providerMessageId: string
}

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    /** Provider error code, stored for diagnosis. */
    readonly code: string,
    /** Permanent failures must not be retried — retrying burns quota forever. */
    readonly permanent: boolean,
  ) {
    super(message)
    this.name = 'WhatsAppSendError'
  }
}

export interface WhatsAppProvider {
  readonly name: string
  sendTemplate(input: SendTemplateInput): Promise<SendResult>
}

/**
 * Meta WhatsApp Cloud API.
 * https://developers.facebook.com/docs/whatsapp/cloud-api
 */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = 'meta_cloud'

  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly apiVersion = 'v21.0',
  ) {}

  async sendTemplate({ to, templateName, languageCode, variables }: SendTemplateInput): Promise<SendResult> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(variables.length > 0
          ? {
              components: [
                {
                  type: 'body',
                  parameters: variables.map((text) => ({ type: 'text', text })),
                },
              ],
            }
          : {}),
      },
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const json = await response.json().catch(() => ({}))

    if (!response.ok) {
      const error = json?.error ?? {}
      const code = String(error.code ?? response.status)
      throw new WhatsAppSendError(
        error.message ?? `WhatsApp API returned ${response.status}`,
        code,
        isPermanent(response.status, Number(error.code)),
      )
    }

    const id = json?.messages?.[0]?.id
    if (!id) {
      throw new WhatsAppSendError('WhatsApp accepted the request but returned no message id', 'no_id', false)
    }
    return { providerMessageId: id }
  }
}

/**
 * Decide whether retrying could ever succeed.
 *
 * Retrying a permanently-failed message (bad number, unapproved template,
 * revoked token) just wastes quota and fills the outbox with noise, so those
 * fail immediately and surface on the WhatsApp dashboard for a human to fix.
 */
function isPermanent(httpStatus: number, metaCode: number): boolean {
  // 4xx other than 429 (rate limit) and 408 (timeout) will not fix themselves.
  if (httpStatus === 429 || httpStatus === 408) return false
  if (httpStatus >= 500) return false
  if (httpStatus >= 400) {
    // 131026 = message undeliverable, 132xxx = template problems,
    // 190 = expired/invalid access token, 100 = invalid parameter.
    const permanentCodes = [100, 190, 131026, 131047, 132000, 132001, 132005, 132007, 132012, 132015]
    return permanentCodes.includes(metaCode) || httpStatus === 400 || httpStatus === 401 || httpStatus === 403
  }
  return false
}

/** Chooses the provider from environment configuration. */
export function createProvider(): WhatsAppProvider {
  const provider = Deno.env.get('WHATSAPP_PROVIDER') ?? 'meta_cloud'

  switch (provider) {
    case 'meta_cloud': {
      const token = requireEnv('WHATSAPP_ACCESS_TOKEN')
      const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID')
      return new MetaCloudProvider(token, phoneNumberId)
    }
    default:
      throw new Error(
        `Unknown WHATSAPP_PROVIDER "${provider}". Add an adapter in _shared/whatsapp-provider.ts.`,
      )
  }
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`Missing required secret ${name}. Set it with: supabase secrets set ${name}=...`)
  }
  return value
}
