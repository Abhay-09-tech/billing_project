import { describe, expect, it } from 'vitest'
import {
  buildInvoiceMessage,
  buildPaymentReminderMessage,
  buildWhatsAppLink,
  normalizePhone,
} from './whatsapp'

describe('normalizePhone — the formats staff actually type', () => {
  const validCases: Array<[string, string]> = [
    ['9876543210', '919876543210'],
    ['+91 9876543210', '919876543210'],
    ['+91-9876543210', '919876543210'],
    ['+91-98765-43210', '919876543210'],
    ['+91 98765 43210', '919876543210'],
    ['(+91) 98765 43210', '919876543210'],
    ['919876543210', '919876543210'],
    ['09876543210', '919876543210'],
    ['00919876543210', '919876543210'],
    ['  9876543210  ', '919876543210'],
    ['98765 43210', '919876543210'],
  ]

  it.each(validCases)('normalises %s → %s', (input, expected) => {
    const result = normalizePhone(input)
    expect(result.valid).toBe(true)
    expect(result.e164).toBe(expected)
  })

  it('formats for display without breaking the link', () => {
    expect(normalizePhone('9876543210').display).toBe('+91 98765 43210')
  })

  const invalidCases = [
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['12345', 'too short'],
    ['1234567890', 'starts with 1 — not an Indian mobile'],
    ['5876543210', 'starts with 5 — not an Indian mobile'],
    ['abcdefghij', 'letters'],
    ['98765432101234567', 'too long'],
  ] as const

  it.each(invalidCases)('rejects "%s" (%s)', (input) => {
    const result = normalizePhone(input)
    expect(result.valid).toBe(false)
    expect(result.e164).toBeNull()
    expect(result.error).toBeTruthy()
    // Staff must never see a technical error.
    expect(result.error).not.toMatch(/regex|null|undefined|Error:/i)
  })

  it('accepts a plausible non-Indian number as-is', () => {
    const result = normalizePhone('442071234567', '44')
    expect(result.valid).toBe(true)
    expect(result.e164).toBe('442071234567')
  })
})

describe('buildWhatsAppLink', () => {
  it('produces a wa.me link with no stray formatting in the number', () => {
    const { e164 } = normalizePhone('+91-98765 43210')
    const link = buildWhatsAppLink(e164!, 'Hello')
    expect(link).toBe('https://wa.me/919876543210?text=Hello')
    expect(link).not.toMatch(/[ ()+-]/)
  })

  it('encodes newlines, rupees and ampersands safely', () => {
    const link = buildWhatsAppLink('919876543210', 'Total: ₹2,500\nR & R')
    expect(link).toContain('%E2%82%B9') // ₹
    expect(link).toContain('%0A') // newline
    expect(link).toContain('%26') // &
    expect(link.split('?text=')[1]).not.toContain(' ')
  })
})

describe('invoice message', () => {
  const base = {
    shopName: 'Perfect Optical Vision',
    customerName: 'Rahul Sharma',
    invoiceNo: 'POV/26-27/00001',
    orderCode: 'POV-O000015',
    grandTotal: 2500,
    amountPaid: 2000,
  }

  it('states total, paid and balance in rupees', () => {
    const msg = buildInvoiceMessage(base)
    expect(msg).toContain('Rahul Sharma')
    expect(msg).toContain('POV/26-27/00001')
    expect(msg).toContain('POV-O000015')
    expect(msg).toContain('₹2,500.00')
    expect(msg).toContain('₹2,000.00')
    expect(msg).toContain('₹500.00')
    expect(msg).toContain('Kindly clear the balance')
  })

  it('omits the chase line when the bill is settled', () => {
    const msg = buildInvoiceMessage({ ...base, amountPaid: 2500 })
    expect(msg).toContain('₹0.00')
    expect(msg).not.toContain('Kindly clear the balance')
  })

  it('includes the invoice link when one is supplied', () => {
    const msg = buildInvoiceMessage({ ...base, invoiceUrl: 'https://example.com/i/abc' })
    expect(msg).toContain('https://example.com/i/abc')
  })

  it('reminder message leads with the balance', () => {
    const msg = buildPaymentReminderMessage({
      shopName: 'Perfect Optical Vision',
      customerName: 'Rahul',
      invoiceNo: 'POV/26-27/00001',
      balance: 500,
    })
    expect(msg).toContain('Balance due: ₹500.00')
  })
})
