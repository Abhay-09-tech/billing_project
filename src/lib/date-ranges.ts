/**
 * Shared date-range presets (brief §6 Sales Overview + §25 report filters).
 * All ranges are inclusive [from, to] in local (shop) time, formatted as
 * yyyy-MM-dd for Postgres `date` params.
 */
import {
  endOfMonth,
  format,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from 'date-fns'

export type RangePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'this_month'
  | 'prev_month'
  | 'this_year'
  | 'custom'

export interface DateRange {
  from: string
  to: string
}

const fmt = (d: Date) => format(d, 'yyyy-MM-dd')

export function resolveRange(preset: RangePreset, custom?: DateRange): DateRange {
  const now = new Date()
  switch (preset) {
    case 'today':
      return { from: fmt(now), to: fmt(now) }
    case 'yesterday': {
      const y = subDays(now, 1)
      return { from: fmt(y), to: fmt(y) }
    }
    case 'last7':
      return { from: fmt(subDays(now, 6)), to: fmt(now) }
    case 'last30':
      return { from: fmt(subDays(now, 29)), to: fmt(now) }
    case 'this_month':
      return { from: fmt(startOfMonth(now)), to: fmt(now) }
    case 'prev_month': {
      const p = subMonths(now, 1)
      return { from: fmt(startOfMonth(p)), to: fmt(endOfMonth(p)) }
    }
    case 'this_year':
      return { from: fmt(startOfYear(now)), to: fmt(now) }
    case 'custom':
      return custom ?? { from: fmt(now), to: fmt(now) }
  }
}

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  this_month: 'This month',
  prev_month: 'Previous month',
  this_year: 'This year',
  custom: 'Custom',
}
