/**
 * GST line arithmetic — TypeScript MIRROR of public.compute_gst_line.
 *
 * The Postgres function is authoritative: what it computes is what gets
 * stored. This mirror exists ONLY so forms can show a live total while
 * typing. Both implementations are covered by the same test vectors
 * (src/lib/gst.test.ts ↔ scripts/db-test/run.mjs); if they ever drift,
 * the tests fail.
 */
import { round2 } from './money'

export interface GstLineInput {
  qty: number
  unitPrice: number
  discountAmt: number
  gstRatePct: number
  taxInclusive: boolean
  intraState: boolean
}

export interface GstLineResult {
  taxableAmt: number
  cgstAmt: number
  sgstAmt: number
  igstAmt: number
  lineTotal: number
}

export function computeGstLine(input: GstLineInput): GstLineResult {
  const { qty, unitPrice, discountAmt, gstRatePct, taxInclusive, intraState } = input
  const net = round2(qty * unitPrice) - (discountAmt || 0)
  if (net < 0) throw new Error('Discount cannot exceed the line amount.')

  let taxableAmt: number
  let tax: number
  let lineTotal: number

  if (taxInclusive) {
    taxableAmt = round2(net / (1 + gstRatePct / 100))
    tax = round2(net - taxableAmt)
    lineTotal = net
  } else {
    taxableAmt = net
    tax = round2(net * (gstRatePct / 100))
    lineTotal = round2(net + tax)
  }

  if (intraState) {
    const cgstAmt = round2(tax / 2)
    // Odd paisa goes to SGST so the pair always sums to the exact tax.
    const sgstAmt = round2(tax - cgstAmt)
    return { taxableAmt, cgstAmt, sgstAmt, igstAmt: 0, lineTotal }
  }
  return { taxableAmt, cgstAmt: 0, sgstAmt: 0, igstAmt: tax, lineTotal }
}

export interface InvoiceTotals {
  subtotal: number
  discountTotal: number
  taxableTotal: number
  cgstTotal: number
  sgstTotal: number
  igstTotal: number
  roundOff: number
  grandTotal: number
}

/** Sum per-line results the same way rpc_create_invoice does. */
export function computeInvoiceTotals(
  lines: Array<GstLineInput & { computed?: GstLineResult }>,
): InvoiceTotals {
  let subtotal = 0
  let discountTotal = 0
  let taxableTotal = 0
  let cgstTotal = 0
  let sgstTotal = 0
  let igstTotal = 0
  let total = 0

  for (const line of lines) {
    const r = line.computed ?? computeGstLine(line)
    subtotal = round2(subtotal + round2(line.qty * line.unitPrice))
    discountTotal = round2(discountTotal + (line.discountAmt || 0))
    taxableTotal = round2(taxableTotal + r.taxableAmt)
    cgstTotal = round2(cgstTotal + r.cgstAmt)
    sgstTotal = round2(sgstTotal + r.sgstAmt)
    igstTotal = round2(igstTotal + r.igstAmt)
    total = round2(total + r.lineTotal)
  }

  const grandTotal = Math.round(total)
  return {
    subtotal,
    discountTotal,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    roundOff: round2(grandTotal - total),
    grandTotal,
  }
}
