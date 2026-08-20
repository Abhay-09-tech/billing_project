import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { refundPayment } from '@/services/billing'
import type { PaymentMethod, PaymentRow } from '@/types/database'
import { formatMoney, parseMoney } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Input, Textarea } from '@/components/ui/fields'
import { cn } from '@/lib/utils'

const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank' },
  { value: 'other', label: 'Other' },
]

/**
 * Reverses a payment that was recorded wrongly, or refunds money returned to
 * the customer.
 *
 * Payments are never edited or deleted. A cash book that can be rewritten
 * cannot be trusted or audited, so a mistake is corrected by adding an
 * opposite entry: both rows stay visible and the balance comes out right.
 */
export function RefundPaymentDialog({
  open,
  onOpenChange,
  payment,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  payment: PaymentRow | null
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reason, setReason] = useState('')

  // Default to reversing the whole payment — the common case is "wrong
  // amount typed", not a partial refund.
  useEffect(() => {
    if (open && payment) {
      setAmount(Number(payment.amount).toFixed(2))
      setMethod(payment.method)
      setReason('')
    }
  }, [open, payment])

  const value = parseMoney(amount)
  const original = payment ? Number(payment.amount) : 0
  const tooMuch = value > original + 0.005

  const mutation = useMutation({
    mutationFn: () =>
      refundPayment({
        paymentId: payment!.id,
        amount: value,
        method,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success(`${formatMoney(value)} refunded`)
      void queryClient.invalidateQueries({ queryKey: ['invoice'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['payments'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      onOpenChange(false)
      onDone?.()
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not record the refund.')),
  })

  if (!payment) return null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Refund or reverse this payment"
      description={`${payment.payment_code} · ${formatMoney(payment.amount)} · ${formatDateTime(payment.paid_at)}`}
    >
      <div className="space-y-4">
        <FormField
          label="Amount to refund"
          required
          error={tooMuch ? 'More than the original payment' : undefined}
          hint={`Original payment: ${formatMoney(original)}`}
          htmlFor="rf-amount"
        >
          <Input
            id="rf-amount"
            type="number"
            step="0.01"
            min={0}
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>

        <FormField label="Refunded by" required htmlFor="rf-method">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                className={cn(
                  'min-h-touch rounded-lg border px-2 py-2 text-sm font-medium transition-colors',
                  method === m.value
                    ? 'border-brand-600 bg-brand-50 text-brand-800'
                    : 'border-cream-300 text-brand-700 hover:bg-brand-50',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </FormField>

        <FormField
          label="Reason"
          required
          hint="Recorded permanently against both entries"
          htmlFor="rf-reason"
        >
          <Textarea
            id="rf-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Entered 5000 instead of 500"
          />
        </FormField>

        <p className="rounded-lg bg-cream-100 px-3 py-2 text-xs text-brand-700">
          The original payment is not deleted. A matching refund entry is added, so both stay
          visible in the customer's history and the outstanding balance corrects itself.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={tooMuch || value <= 0 || reason.trim().length < 3}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Refund {value > 0 ? formatMoney(value) : ''}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
