/**
 * Money helpers. All arithmetic that decides a stored amount happens in
 * Postgres (compute_gst_line) — these helpers exist for display and for the
 * live preview mirror in gst.ts. Amounts are rupees with 2dp, handled via
 * paise-integer arithmetic to avoid float drift.
 */

/** Round to 2 decimal places, half away from zero (matches Postgres round()). */
export function round2(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) * 100) / 100
}

/** ₹12,345.50 — Indian digit grouping. */
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Whole-rupee variant for dashboards: ₹12,346 */
const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export function formatMoney(amount: number | string | null | undefined): string {
  const n = typeof amount === 'string' ? Number(amount) : (amount ?? 0)
  return inr.format(Number.isFinite(n) ? n : 0)
}

export function formatMoneyWhole(amount: number | string | null | undefined): string {
  const n = typeof amount === 'string' ? Number(amount) : (amount ?? 0)
  return inrWhole.format(Number.isFinite(n) ? n : 0)
}

/** Parse user money input ("1,250.5" → 1250.5); NaN-safe. */
export function parseMoney(input: string): number {
  const n = Number(input.replace(/[₹,\s]/g, ''))
  return Number.isFinite(n) ? round2(n) : 0
}

/** a ≈ b within half a paisa — never compare money with ===. */
export function moneyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005
}
