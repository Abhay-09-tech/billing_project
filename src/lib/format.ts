import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from 'date-fns'

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return format(parseISO(iso), 'dd MMM yyyy')
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return format(parseISO(iso), 'dd MMM yyyy, h:mm a')
}

/** "Today, 3:45 pm" / "Yesterday" / "12 May 2025" — for activity feeds. */
export function formatRelativeDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = parseISO(iso)
  if (isToday(d)) return `Today, ${format(d, 'h:mm a')}`
  if (isYesterday(d)) return `Yesterday, ${format(d, 'h:mm a')}`
  return format(d, 'dd MMM yyyy')
}

export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  return formatDistanceToNow(parseISO(iso), { addSuffix: true })
}

/** 9876543210 → 98765 43210 (readable Indian mobile). */
export function formatMobile(mobile: string | null | undefined): string {
  if (!mobile) return '—'
  return mobile.length === 10 ? `${mobile.slice(0, 5)} ${mobile.slice(5)}` : mobile
}

/** Rx numbers print with explicit sign and 2dp: -2.25, +1.00, 0.00 → Plano. */
export function formatRxPower(v: number | null | undefined, { plano = false } = {}): string {
  if (v == null) return '—'
  if (v === 0 && plano) return 'Pl'
  return (v > 0 ? '+' : '') + v.toFixed(2)
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}
