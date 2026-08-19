import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { InvoiceStatus, LabOrderStatus, OrderStatusCode, WhatsAppMessageStatus } from '@/types/database'

type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'purple'

const tones: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700',
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-blue-100 text-blue-800',
  teal: 'bg-brand-100 text-brand-800',
  purple: 'bg-purple-100 text-purple-800',
}

export function Badge({ tone = 'gray', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

// ── Domain-specific badges: one source of colour truth per status family. ────

const orderTones: Record<OrderStatusCode, Tone> = {
  new: 'blue',
  prescription_received: 'blue',
  frame_selected: 'blue',
  lens_ordered: 'purple',
  in_lab: 'purple',
  quality_check: 'amber',
  ready: 'green',
  customer_notified: 'green',
  delivered: 'teal',
  completed: 'gray',
  cancelled: 'red',
}

export function OrderStatusBadge({ status, label }: { status: OrderStatusCode; label?: string }) {
  return <Badge tone={orderTones[status] ?? 'gray'}>{label ?? status.replaceAll('_', ' ')}</Badge>
}

export function PaymentStatusBadge({ grandTotal, amountPaid }: { grandTotal: number; amountPaid: number }) {
  if (amountPaid <= 0 && grandTotal > 0) return <Badge tone="red">Unpaid</Badge>
  if (amountPaid + 0.005 < grandTotal) return <Badge tone="amber">Partially paid</Badge>
  return <Badge tone="green">Paid</Badge>
}

const invoiceTones: Record<InvoiceStatus, Tone> = { draft: 'gray', issued: 'green', cancelled: 'red' }
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={invoiceTones[status]}>{status}</Badge>
}

const labTones: Record<LabOrderStatus, Tone> = {
  sent: 'blue',
  in_process: 'purple',
  received: 'teal',
  qc_pending: 'amber',
  qc_passed: 'green',
  qc_failed: 'red',
}
export function LabStatusBadge({ status }: { status: LabOrderStatus }) {
  return <Badge tone={labTones[status]}>{status.replaceAll('_', ' ')}</Badge>
}

const waTones: Record<WhatsAppMessageStatus, Tone> = {
  queued: 'gray',
  sending: 'blue',
  sent: 'blue',
  delivered: 'green',
  read: 'teal',
  failed: 'red',
  cancelled: 'gray',
}
export function WaStatusBadge({ status }: { status: WhatsAppMessageStatus }) {
  return <Badge tone={waTones[status]}>{status}</Badge>
}
