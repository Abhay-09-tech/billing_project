/**
 * WhatsApp helpers — number normalisation, link building and message text.
 *
 * There are two entirely separate WhatsApp paths in this system, and they must
 * never be confused (docs/ARCHITECTURE.md §6, brief §5):
 *
 *   MANUAL   — this file. Builds a wa.me deep link and opens it. The staff
 *              member presses send in WhatsApp themselves. Recorded as
 *              "opened", never as delivered.
 *
 *   AUTOMATED — supabase/functions/whatsapp-dispatch. Sends Meta-approved
 *              templates through the official Cloud API and records real
 *              provider delivery status.
 *
 * No browser automation, no scraping, no unofficial libraries.
 */

const INDIA_CC = '91'

export interface PhoneResult {
  /** Digits only, country code included — the form wa.me needs. */
  e164: string | null
  /** Human display, e.g. "+91 98765 43210". */
  display: string
  valid: boolean
  error?: string
}

/**
 * Normalise anything staff might type or paste into a WhatsApp-usable number.
 *
 * Accepts: 9876543210 · +91 9876543210 · +91-98765-43210 · 09876543210 ·
 *          (+91) 98765 43210 · 919876543210
 */
export function normalizePhone(input: string | null | undefined, countryCode = INDIA_CC): PhoneResult {
  const raw = (input ?? '').trim()
  if (!raw) return { e164: null, display: '', valid: false, error: 'Enter a WhatsApp number.' }

  // Strip everything that is not a digit. A leading "+" carries no extra
  // information once we know the country code, and dashes, spaces, brackets
  // and non-breaking spaces are exactly what break naive wa.me links.
  let digits = raw.replace(/\D/g, '')

  if (!digits) {
    return { e164: null, display: raw, valid: false, error: 'Enter a valid WhatsApp number.' }
  }

  // Indian handling: a leading 0 is a domestic trunk prefix, not part of the number.
  if (countryCode === INDIA_CC) {
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
    // 0091... international prefix
    if (digits.length === 14 && digits.startsWith('00')) digits = digits.slice(2)

    if (digits.length === 10) {
      if (!/^[6-9]/.test(digits)) {
        return {
          e164: null,
          display: raw,
          valid: false,
          error: 'Indian mobile numbers start with 6, 7, 8 or 9.',
        }
      }
      digits = countryCode + digits
    }

    if (digits.length === 12 && digits.startsWith(countryCode)) {
      const local = digits.slice(2)
      if (!/^[6-9]\d{9}$/.test(local)) {
        return { e164: null, display: raw, valid: false, error: 'Enter a valid WhatsApp number.' }
      }
      return { e164: digits, display: formatE164(digits), valid: true }
    }
  }

  // Other countries: accept a plausible international length as-is.
  if (digits.length >= 10 && digits.length <= 15) {
    return { e164: digits, display: `+${digits}`, valid: true }
  }

  return { e164: null, display: raw, valid: false, error: 'Enter a valid WhatsApp number.' }
}

/** +91 98765 43210 */
function formatE164(digits: string): string {
  if (digits.length === 12 && digits.startsWith(INDIA_CC)) {
    const local = digits.slice(2)
    return `+${INDIA_CC} ${local.slice(0, 5)} ${local.slice(5)}`
  }
  return `+${digits}`
}

/**
 * Build the official WhatsApp deep link.
 *
 * `https://wa.me/<number>?text=<encoded>` is WhatsApp's own documented
 * click-to-chat format. On desktop it opens WhatsApp Web (or WhatsApp
 * Desktop if installed); on a phone it opens the app directly. Nothing here
 * automates WhatsApp — it hands over to it.
 */
export function buildWhatsAppLink(e164: string, message: string): string {
  return `https://wa.me/${e164}?text=${encodeURIComponent(message)}`
}

/** Opens the link in a new tab, keeping the app's own tab alive. */
export function openWhatsApp(e164: string, message: string): void {
  window.open(buildWhatsAppLink(e164, message), '_blank', 'noopener,noreferrer')
}

// ── Message builders ────────────────────────────────────────────────────────
// Plain text, no markdown: WhatsApp renders *bold* with single asterisks and
// mangles anything else. Kept deliberately simple so staff can edit freely.

const money = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface InvoiceMessageInput {
  shopName: string
  customerName: string
  invoiceNo: string
  orderCode?: string | null
  grandTotal: number
  amountPaid: number
  invoiceUrl?: string | null
}

export function buildInvoiceMessage(input: InvoiceMessageInput): string {
  const balance = Number(input.grandTotal) - Number(input.amountPaid)
  const lines = [
    `Hello ${input.customerName},`,
    '',
    `Thank you for choosing ${input.shopName}.`,
    '',
    `Invoice: ${input.invoiceNo}`,
  ]
  if (input.orderCode) lines.push(`Order: ${input.orderCode}`)
  lines.push(
    `Total: ${money(input.grandTotal)}`,
    `Paid: ${money(input.amountPaid)}`,
    `Balance: ${money(balance)}`,
  )
  if (balance > 0) {
    lines.push('', 'Kindly clear the balance at your convenience.')
  }
  if (input.invoiceUrl) {
    lines.push('', `Your invoice: ${input.invoiceUrl}`)
  }
  lines.push('', 'Thank you.')
  return lines.join('\n')
}

export function buildOrderReadyMessage(input: {
  shopName: string
  customerName: string
  orderCode: string
  balance?: number
}): string {
  const lines = [
    `Hello ${input.customerName},`,
    '',
    `Your spectacles for order ${input.orderCode} are ready for pickup at ${input.shopName}.`,
  ]
  if (input.balance && input.balance > 0) {
    lines.push('', `Balance payable on collection: ${money(input.balance)}`)
  }
  lines.push('', 'Thank you.')
  return lines.join('\n')
}

export function buildOrderUpdateMessage(input: {
  shopName: string
  customerName: string
  orderCode: string
  statusLabel: string
  expectedDate?: string | null
}): string {
  const lines = [
    `Hello ${input.customerName},`,
    '',
    `An update on your order ${orderRef(input.orderCode)} at ${input.shopName}:`,
    `Status: ${input.statusLabel}`,
  ]
  if (input.expectedDate) lines.push(`Expected ready by: ${input.expectedDate}`)
  lines.push('', 'Thank you.')
  return lines.join('\n')
}

export function buildPaymentReminderMessage(input: {
  shopName: string
  customerName: string
  invoiceNo: string
  balance: number
}): string {
  return [
    `Hello ${input.customerName},`,
    '',
    `This is a gentle reminder from ${input.shopName}.`,
    '',
    `Invoice: ${input.invoiceNo}`,
    `Balance due: ${money(input.balance)}`,
    '',
    'Kindly clear it at your convenience. Thank you.',
  ].join('\n')
}

export function buildGeneralMessage(input: { shopName: string; customerName: string }): string {
  return [`Hello ${input.customerName},`, '', `This is ${input.shopName}.`, '', ''].join('\n')
}

const orderRef = (code: string) => code
