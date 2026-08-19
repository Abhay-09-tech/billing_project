import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, MessageCircle, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { cancelInvoice, getInvoiceDetail, issueInvoice } from '@/services/billing'
import { formatMoney } from '@/lib/money'
import { formatDate, formatDateTime } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, ErrorState, LoadingState } from '@/components/ui/layout'
import { InvoiceStatusBadge, PaymentStatusBadge } from '@/components/ui/badge'
import { Table, TBody, TD, TDNum, TH, THead, THNum, TR } from '@/components/ui/table'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Textarea } from '@/components/ui/fields'
import { InvoicePrint } from './InvoicePrint'
import { RecordPaymentDialog } from '@/features/payments/RecordPaymentDialog'

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const [payOpen, setPayOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const query = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => getInvoiceDetail(id!),
    enabled: Boolean(id),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['invoice', id] })
    void queryClient.invalidateQueries({ queryKey: ['invoices'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['payments'] })
  }

  const issueMutation = useMutation({
    mutationFn: () => issueInvoice(id!),
    onSuccess: (inv) => {
      toast.success(`Invoice ${inv.invoice_no} issued`)
      invalidate()
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not issue the invoice.')),
  })

  const cancelMutation = useMutation({
    mutationFn: () => cancelInvoice(id!, cancelReason.trim()),
    onSuccess: () => {
      toast.success('Invoice cancelled')
      invalidate()
      setCancelOpen(false)
      setCancelReason('')
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not cancel the invoice.')),
  })

  if (query.isPending) return <LoadingState label="Loading bill…" />
  if (query.isError)
    return <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />

  const { invoice, items, payments } = query.data
  const balance = Number(invoice.grand_total) - Number(invoice.amount_paid)
  const isDraft = invoice.status === 'draft'
  const isIssued = invoice.status === 'issued'
  const waNumber = invoice.customers?.whatsapp_number ?? invoice.customers?.mobile

  const waText = encodeURIComponent(
    `Hello ${invoice.customers?.full_name ?? ''}, your bill ${invoice.invoice_no} at Perfect Optical Vision is ₹${Number(invoice.grand_total).toFixed(2)}.` +
      (balance > 0 ? ` Balance due: ₹${balance.toFixed(2)}.` : ' Paid in full. Thank you!'),
  )

  return (
    <>
      {/* Print-only layout; hidden on screen. */}
      {isIssued && <InvoicePrint invoice={invoice} items={items} />}

      <div className="print:hidden">
        <Link
          to="/billing"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Billing
        </Link>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">
                  {invoice.invoice_no ?? 'Draft bill'}
                </h1>
                <InvoiceStatusBadge status={invoice.status} />
                {isIssued && (
                  <PaymentStatusBadge
                    grandTotal={Number(invoice.grand_total)}
                    amountPaid={Number(invoice.amount_paid)}
                  />
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {invoice.invoice_date
                  ? formatDate(invoice.invoice_date)
                  : `Created ${formatDate(invoice.created_at)}`}
              </p>
              <Link
                to={`/customers/${invoice.customer_id}`}
                className="mt-2 inline-block font-medium text-brand-700 hover:text-brand-800"
              >
                {invoice.customers?.full_name}
              </Link>
            </div>

            <div className="flex flex-wrap gap-2">
              {isDraft && can(PERMS.invoicesCreate) && (
                <Button loading={issueMutation.isPending} onClick={() => issueMutation.mutate()}>
                  Issue bill
                </Button>
              )}
              {isIssued && (
                <>
                  <Button variant="outline" onClick={() => window.print()}>
                    <Printer className="h-4 w-4" />
                    Print / PDF
                  </Button>
                  {waNumber && (
                    <a href={`https://wa.me/91${waNumber}?text=${waText}`} target="_blank" rel="noreferrer">
                      <Button variant="outline">
                        <MessageCircle className="h-4 w-4" />
                        WhatsApp
                      </Button>
                    </a>
                  )}
                  {balance > 0 && can(PERMS.paymentsCreate) && (
                    <Button onClick={() => setPayOpen(true)}>Record payment</Button>
                  )}
                  {can(PERMS.invoicesCancel) && Number(invoice.amount_paid) === 0 && (
                    <Button
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => setCancelOpen(true)}
                    >
                      Cancel
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {isDraft && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This is a draft. Issuing it allocates the invoice number permanently and locks the
              amounts — after that, corrections need a credit note.
            </p>
          )}
          {invoice.status === 'cancelled' && invoice.cancel_reason && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              Cancelled {invoice.cancelled_at ? formatDate(invoice.cancelled_at) : ''}:{' '}
              {invoice.cancel_reason}
            </p>
          )}
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {/* ── Items ─────────────────────────────────────────────────── */}
          <Card className="lg:col-span-2">
            <CardHeader title="Items" />
            <Table>
              <THead>
                <TR>
                  <TH>Description</TH>
                  <THNum>Qty</THNum>
                  <THNum className="hidden sm:table-cell">Taxable</THNum>
                  <THNum className="hidden sm:table-cell">GST</THNum>
                  <THNum>Amount</THNum>
                </TR>
              </THead>
              <TBody>
                {items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <p className="font-medium text-gray-900">{item.description}</p>
                      {item.hsn_code && <p className="text-xs text-gray-500">HSN {item.hsn_code}</p>}
                    </TD>
                    <TDNum>{Number(item.qty)}</TDNum>
                    <TDNum className="hidden text-gray-600 sm:table-cell">
                      {formatMoney(item.taxable_amt)}
                    </TDNum>
                    <TDNum className="hidden text-gray-600 sm:table-cell">
                      {formatMoney(
                        Number(item.cgst_amt) + Number(item.sgst_amt) + Number(item.igst_amt),
                      )}
                    </TDNum>
                    <TDNum className="font-medium">{formatMoney(item.line_total)}</TDNum>
                  </TR>
                ))}
              </TBody>
            </Table>

            <dl className="space-y-1.5 border-t border-gray-100 px-4 py-4 text-sm sm:px-5">
              <Row label="Taxable value" value={formatMoney(invoice.taxable_total)} />
              {Number(invoice.discount_total) > 0 && (
                <Row label="Discount" value={`− ${formatMoney(invoice.discount_total)}`} />
              )}
              {invoice.is_intra_state ? (
                <>
                  <Row label="CGST" value={formatMoney(invoice.cgst_total)} />
                  <Row label="SGST" value={formatMoney(invoice.sgst_total)} />
                </>
              ) : (
                <Row label="IGST" value={formatMoney(invoice.igst_total)} />
              )}
              {Number(invoice.round_off) !== 0 && (
                <Row label="Round off" value={formatMoney(invoice.round_off)} />
              )}
              <div className="flex justify-between border-t border-gray-100 pt-1.5 text-base font-semibold text-gray-900">
                <dt>Grand total</dt>
                <dd className="tabular-nums">{formatMoney(invoice.grand_total)}</dd>
              </div>
              <Row label="Paid" value={formatMoney(invoice.amount_paid)} />
              <div className="flex justify-between font-semibold">
                <dt className="text-gray-700">Balance due</dt>
                <dd className={`tabular-nums ${balance > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                  {formatMoney(balance)}
                </dd>
              </div>
            </dl>
          </Card>

          {/* ── Payments ──────────────────────────────────────────────── */}
          <Card>
            <CardHeader title="Payments" />
            {payments.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500 sm:px-5">
                No payments recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {payments.map((p) => (
                  <li key={p.id} className="px-4 py-3 sm:px-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900 capitalize">
                          {p.method.replace('_', ' ')}
                          {p.entry_type !== 'payment' && (
                            <span className="ml-1 text-xs text-gray-500">({p.entry_type})</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">{formatDateTime(p.paid_at)}</p>
                        {p.reference_no && (
                          <p className="text-xs text-gray-500">Ref: {p.reference_no}</p>
                        )}
                      </div>
                      <p
                        className={`font-medium tabular-nums ${p.direction < 0 ? 'text-red-600' : 'text-gray-900'}`}
                      >
                        {p.direction < 0 ? '−' : ''}
                        {formatMoney(p.amount)}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">{p.payment_code}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ── Dialogs ───────────────────────────────────────────────────── */}
      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoiceId={invoice.id}
        balance={balance}
        customerName={invoice.customers?.full_name ?? ''}
        onDone={invalidate}
      />

      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this invoice?"
        description="The invoice number stays reserved — GST requires the series to stay unbroken."
      >
        <div className="space-y-4">
          <FormField label="Reason" required htmlFor="inv-cancel">
            <Textarea
              id="inv-cancel"
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Billed the wrong customer"
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep invoice
            </Button>
            <Button
              variant="danger"
              disabled={cancelReason.trim().length < 3}
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              Cancel invoice
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-gray-600">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
