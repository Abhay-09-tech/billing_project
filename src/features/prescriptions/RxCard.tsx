import type { PrescriptionRow } from '@/types/database'
import { formatDate, formatRxPower } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const RX_TYPE_LABELS: Record<PrescriptionRow['rx_type'], string> = {
  distance: 'Distance',
  near: 'Near',
  bifocal: 'Bifocal',
  progressive: 'Progressive',
  contact_lens: 'Contact lens',
}

/**
 * One prescription rendered the way an optician reads it: OD above OS,
 * SPH / CYL / AXIS / ADD across. Values are never rounded for display —
 * an incorrect power is a remake.
 */
export function RxCard({
  rx,
  compact = false,
  className,
}: {
  rx: PrescriptionRow
  compact?: boolean
  className?: string
}) {
  const voided = Boolean(rx.voided_at)
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        voided ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200 bg-white',
        className,
      )}
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-900">{formatDate(rx.rx_date)}</p>
        <Badge tone="blue">{RX_TYPE_LABELS[rx.rx_type]}</Badge>
        {voided && <Badge tone="red">Voided</Badge>}
        {rx.supersedes_id && <Badge tone="gray">Revision</Badge>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[19rem] text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-gray-500">
              <th className="w-10 pb-1 text-left font-medium">Eye</th>
              <th className="pb-1 text-right font-medium">SPH</th>
              <th className="pb-1 text-right font-medium">CYL</th>
              <th className="pb-1 text-right font-medium">AXIS</th>
              <th className="pb-1 text-right font-medium">ADD</th>
              {!compact && <th className="pb-1 text-right font-medium">PD</th>}
            </tr>
          </thead>
          <tbody>
            <RxRow
              label="OD"
              sph={rx.od_sph}
              cyl={rx.od_cyl}
              axis={rx.od_axis}
              add={rx.od_add}
              pd={compact ? undefined : rx.pd_right}
              compact={compact}
            />
            <RxRow
              label="OS"
              sph={rx.os_sph}
              cyl={rx.os_cyl}
              axis={rx.os_axis}
              add={rx.os_add}
              pd={compact ? undefined : rx.pd_left}
              compact={compact}
            />
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        {rx.pd_binocular != null && <span>PD (binocular): {rx.pd_binocular}</span>}
        {rx.od_seg_ht != null && <span>Seg ht OD: {rx.od_seg_ht}</span>}
        {rx.os_seg_ht != null && <span>Seg ht OS: {rx.os_seg_ht}</span>}
        {hasPrism(rx) && <span className="text-amber-700">Prism prescribed</span>}
        {rx.prescribed_by && <span>By: {rx.prescribed_by}</span>}
      </div>

      {rx.remarks && <p className="mt-2 text-sm text-gray-600">{rx.remarks}</p>}
      {voided && rx.void_reason && (
        <p className="mt-2 text-sm text-red-700">Voided: {rx.void_reason}</p>
      )}
    </div>
  )
}

function RxRow({
  label,
  sph,
  cyl,
  axis,
  add,
  pd,
  compact,
}: {
  label: string
  sph: number | null
  cyl: number | null
  axis: number | null
  add: number | null
  pd?: number | null
  compact: boolean
}) {
  return (
    <tr className="border-t border-gray-100">
      <td className="py-1.5 text-left text-xs font-semibold text-gray-500">{label}</td>
      <td className="py-1.5 text-right">{formatRxPower(sph, { plano: true })}</td>
      <td className="py-1.5 text-right">{formatRxPower(cyl)}</td>
      <td className="py-1.5 text-right">{axis != null ? `${axis}°` : '—'}</td>
      <td className="py-1.5 text-right">{formatRxPower(add)}</td>
      {!compact && <td className="py-1.5 text-right">{pd ?? '—'}</td>}
    </tr>
  )
}

function hasPrism(rx: PrescriptionRow): boolean {
  return Boolean(rx.od_prism_h || rx.od_prism_v || rx.os_prism_h || rx.os_prism_v)
}
