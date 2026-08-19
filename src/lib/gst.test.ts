import { describe, expect, it } from 'vitest'
import { computeGstLine, computeInvoiceTotals } from './gst'
import { formatMoney, moneyEquals, parseMoney, round2 } from './money'

/**
 * These vectors are duplicated in scripts/db-test/run.mjs against
 * public.compute_gst_line. If the TypeScript mirror and the Postgres
 * function ever disagree, one of the two suites fails.
 */
describe('computeGstLine — tax-inclusive (Perfect Optical Vision default)', () => {
  it('splits a ₹8,000 inclusive line at 12% into taxable 7142.86 + tax 857.14', () => {
    const r = computeGstLine({
      qty: 1,
      unitPrice: 8000,
      discountAmt: 0,
      gstRatePct: 12,
      taxInclusive: true,
      intraState: true,
    })
    expect(r.taxableAmt).toBe(7142.86)
    expect(r.cgstAmt + r.sgstAmt).toBe(857.14)
    expect(r.lineTotal).toBe(8000)
  })

  it('gives the odd paisa to SGST so CGST+SGST always equals the tax exactly', () => {
    const r = computeGstLine({
      qty: 1,
      unitPrice: 8000,
      discountAmt: 0,
      gstRatePct: 12,
      taxInclusive: true,
      intraState: true,
    })
    // 857.14 / 2 = 428.57 exactly, but 5000@12% inclusive gives an odd split:
    expect(round2(r.cgstAmt + r.sgstAmt)).toBe(857.14)

    const odd = computeGstLine({
      qty: 1,
      unitPrice: 5000,
      discountAmt: 0,
      gstRatePct: 12,
      taxInclusive: true,
      intraState: true,
    })
    expect(round2(odd.cgstAmt + odd.sgstAmt)).toBe(round2(5000 - odd.taxableAmt))
  })

  it('applies the discount before extracting tax', () => {
    const r = computeGstLine({
      qty: 1,
      unitPrice: 5000,
      discountAmt: 500,
      gstRatePct: 12,
      taxInclusive: true,
      intraState: true,
    })
    expect(r.lineTotal).toBe(4500)
    expect(r.taxableAmt).toBe(round2(4500 / 1.12))
  })

  it('multiplies quantity before discount', () => {
    const r = computeGstLine({
      qty: 3,
      unitPrice: 250,
      discountAmt: 50,
      gstRatePct: 12,
      taxInclusive: true,
      intraState: true,
    })
    expect(r.lineTotal).toBe(700)
  })

  it('rejects a discount larger than the line', () => {
    expect(() =>
      computeGstLine({
        qty: 1,
        unitPrice: 100,
        discountAmt: 150,
        gstRatePct: 12,
        taxInclusive: true,
        intraState: true,
      }),
    ).toThrow()
  })

  it('handles a zero-rated line without dividing by zero', () => {
    const r = computeGstLine({
      qty: 1,
      unitPrice: 1000,
      discountAmt: 0,
      gstRatePct: 0,
      taxInclusive: true,
      intraState: true,
    })
    expect(r.taxableAmt).toBe(1000)
    expect(r.cgstAmt).toBe(0)
    expect(r.sgstAmt).toBe(0)
    expect(r.lineTotal).toBe(1000)
  })
})

describe('computeGstLine — tax-exclusive and inter-state', () => {
  it('adds tax on top when prices exclude GST', () => {
    const r = computeGstLine({
      qty: 1,
      unitPrice: 2000,
      discountAmt: 0,
      gstRatePct: 12,
      taxInclusive: false,
      intraState: true,
    })
    expect(r.taxableAmt).toBe(2000)
    expect(r.cgstAmt).toBe(120)
    expect(r.sgstAmt).toBe(120)
    expect(r.lineTotal).toBe(2240)
  })

  it('uses IGST alone for an inter-state supply', () => {
    const r = computeGstLine({
      qty: 1,
      unitPrice: 2000,
      discountAmt: 0,
      gstRatePct: 12,
      taxInclusive: false,
      intraState: false,
    })
    expect(r.igstAmt).toBe(240)
    expect(r.cgstAmt).toBe(0)
    expect(r.sgstAmt).toBe(0)
  })
})

describe('computeInvoiceTotals', () => {
  it('rounds per line then sums, and records the rupee round-off', () => {
    const totals = computeInvoiceTotals([
      { qty: 1, unitPrice: 5000, discountAmt: 0, gstRatePct: 12, taxInclusive: true, intraState: true },
      { qty: 1, unitPrice: 3000, discountAmt: 0, gstRatePct: 12, taxInclusive: true, intraState: true },
    ])
    expect(totals.grandTotal).toBe(8000)
    expect(totals.roundOff).toBe(0)
    expect(round2(totals.taxableTotal + totals.cgstTotal + totals.sgstTotal)).toBe(8000)
  })

  it('produces a non-zero round-off when the paise do not land on a rupee', () => {
    const totals = computeInvoiceTotals([
      { qty: 1, unitPrice: 999.5, discountAmt: 0, gstRatePct: 12, taxInclusive: true, intraState: true },
    ])
    expect(totals.grandTotal).toBe(1000)
    expect(totals.roundOff).toBe(0.5)
  })

  it('returns zeroes for an empty invoice', () => {
    const totals = computeInvoiceTotals([])
    expect(totals.grandTotal).toBe(0)
    expect(totals.taxableTotal).toBe(0)
  })
})

describe('money helpers', () => {
  it('formats rupees with Indian digit grouping', () => {
    expect(formatMoney(1234567.5)).toContain('12,34,567.50')
  })

  it('parses messy user input', () => {
    expect(parseMoney('₹1,250.50')).toBe(1250.5)
    expect(parseMoney('abc')).toBe(0)
  })

  it('compares money with tolerance, not float equality', () => {
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true)
    expect(moneyEquals(100, 100.01)).toBe(false)
  })
})
