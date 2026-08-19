import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { recordPayment } from '@/services/billing'
import type { PaymentMethod } from '@/types/database'
import { formatMoney, parseMoney } from '@/lib/money'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
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

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  balance,
  customerName,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  invoiceId: string
  balance: number
  customerName: string
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [allowAdvance, setAllowAdvance] = useState(false)

  // Default to settling the bill in full — the overwhelmingly common case.
  useEffect(() => {
    if (open) setAmount(balance > 0 ? balance.toFixed(2) : '')
  }, [open, balance])

  const value = parseMoney(amount)
  const overBalance = value > balance + 0.005
  const canOverpay = can(PERMS.paymentsAllowOverpay)

  const mutation = useMutation({
    mutationFn: () =>
      recordPayment({
        invoiceId,
        amount: value,
        method,
        referenceNo: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        allowAdvance: overBalance && allowAdvance,
      }),
    onSuccess: () => {
      toast.success(`${formatMoney(value)} received from ${customerName}`)
      void queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['payments'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setAmount('')
      setReference('')
      setNotes('')
      setAllowAdvance(false)
      onOpenChange(false)
      onDone?.()
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not record the payment.')),
  })

  const blocked = overBalance && !(canOverpay && allowAdvance)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record payment"
      description={`Balance due: ${formatMoney(balance)}`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!blocked && value > 0) mutation.mutate()
        }}
        className="space-y-4"
      >
        <FormField
          label="Amount received"
          required
          error={overBalance && !canOverpay ? 'More than the balance due' : undefined}
          htmlFor="pay-amount"
        >
          <Input
            id="pay-amount"
            type="number"
            step="0.01"
            min={0}
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>

        {/* Quick amounts — the two most common actions at a counter. */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setAmount(balance.toFixed(2))}>
            Full balance {formatMoney(balance)}
          </Button>
          {balance >= 2 && (
            <Button variant="outline" size="sm" onClick={() => setAmount((balance / 2).toFixed(2))}>
              Half
            </Button>
          )}
        </div>

        <FormField label="Paid by" required htmlFor="pay-method">
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
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </FormField>

        {method !== 'cash' && (
          <FormField
            label="Reference number"
            hint="UPI reference, card slip or cheque number"
            htmlFor="pay-ref"
          >
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </FormField>
        )}

        <FormField label="Notes" htmlFor="pay-notes">
          <Textarea id="pay-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>

        {overBalance && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-900">
              This is {formatMoney(value - balance)} more than the balance due.
            </p>
            {canOverpay ? (
              <label className="mt-2 flex items-start gap-2 text-amber-900">
                <input
                  type="checkbox"
                  checked={allowAdvance}
                  onChange={(e) => setAllowAdvance(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-amber-400 text-brand-700"
                />
                Accept the extra as an advance
              </label>
            ) : (
              <p className="mt-1 text-amber-800">
                Only an administrator can accept more than the balance. Reduce the amount, or ask
                an admin.
              </p>
            )}
          </div>
        )}

        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Payments are permanent. A mistake is corrected with a refund entry, never by deleting —
          so the cash book always reconciles.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={blocked || value <= 0}>
            Record {value > 0 ? formatMoney(value) : 'payment'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
