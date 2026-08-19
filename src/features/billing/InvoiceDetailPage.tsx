import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, ShoppingBag } from 'lucide-react'
import { toast } from 'sonner'
import { cancelInvoice, getInvoiceDetail, issueInvoice } from '@/services/billing'
import { getCustomer360 } from '@/services/customers'
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
import { InvoiceActions } from './InvoiceActions'
import { RecordPaymentDialog } from '@/features/payments/RecordPaymentDialog'

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [payOpen, setPayOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [showConfirmation, setShowConfirmation] = useState(searchParams.get('created') === '1')

  const query = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => getInvoiceDetail(id!),
    enabled: Boolean(id),
  })

  // The customer's address is only needed for the printed invoice.
  const customer = useQuery({
    queryKey: ['customer', query.data?.invoice.customer_id],
    queryFn: () => getCustomer360(query.data!.invoice.customer_id),
    enabled: Boolean(query.data?.invoice.customer_id),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['invoice', id] })
    void queryClient.invalidateQueries({ queryKey: ['invoices'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['payments'] })
    void queryClient.invalidateQueries({ queryKey: ['whatsapp'] })
  }

  const issueMutation = useMutation({
    mutationFn: () => issueInvoice(id!),
    onSuccess: (inv) => {
      toast.success(`Invoice ${inv.invoice_no} issued`)
      invalidate()
      setShowConfirmation(true)
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

  // Clear the ?created flag so a refresh does not re-show the confirmation.
  useEffect(() => {
    if (searchParams.get('created') === '1') {
      const next = new URLSearchParams(searchParams)
      next.delete('created')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  if (query.isPending) return <LoadingState label="Loading bill…" />
  if (query.isError)
    return <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />

  const { invoice, items, payments } = query.data
  const balance = Number(invoice.grand_total) - Number(invoice.amount_paid)
  const isDraft = invoice.status === 'draft'
  const isIssued = invoice.status === 'issued'
  const orderCode = customer.data?.orders.find((o) => o.id === invoice.order_id)?.order_code ?? null
  const address = customer.data?.addresses.find((a) => a.is_primary)?.address_line ?? null

  const actions = (
    <InvoiceActions
      invoice={invoice}
      items={items}
      payments={payments}
      orderCode={orderCode}
      customerAddress={address}
      onWhatsAppSent={invalidate}
    />
  )

  return (
    <>
      {/* Print-only layout; hidden on screen (see the print rules in index.css). */}
      {isIssued && (
        <InvoicePrint
          invoice={invoice}
          items={items}
          payments={payments}
          orderCode={orderCode}
          customerAddress={address}
        />
      )}

      <div className="print:hidden">
        {/* ── Invoice created confirmation (brief §14) ────────────────────── */}
        {showConfirmation && isIssued && (
          <Card className="mb-5 border-green-200 bg-green-50/50">
            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-green-600" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900">Invoice created successfully</h2>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">{invoice.invoice_no}</p>

                  <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-gray-500">Customer</dt>
                      <dd className="mt-0.5 font-medium text-gray-900">
                        {invoice.customers?.full_name}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">Total</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums text-gray-900">
                        {formatMoney(invoice.grand_total)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">Paid</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums text-gray-900">
                        {formatMoney(invoice.amount_paid)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">Balance</dt>
                      <dd
                        className={`mt-0.5 font-semibold tabular-nums ${balance > 0 ? 'text-amber-700' : 'text-green-700'}`}
                      >
                        {formatMoney(balance)}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 border-t border-green-200 pt-4">
                    <p className="mb-2.5 text-sm font-medium text-gray-700">What next?</p>
                    <div className="sm:hidden">
                      <InvoiceActions
                        invoice={invoice}
                        items={items}
                        payments={payments}
                        orderCode={orderCode}
                        customerAddress={address}
                        layout="stacked"
                        onWhatsAppSent={invalidate}
                      />
                    </div>
                    <div className="hidden sm:block">{actions}</div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setShowConfirmation(false)}>
                        Dismiss
                      </Button>
                      {invoice.order_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/orders/${invoice.order_id}`)}
                        >
                          <ShoppingBag className="h-4 w-4" />
                          Back to order
                        </Button>
                      )}
                      {balance > 0 && can(PERMS.paymentsCreate) && (
                        <Button variant="ghost" size="sm" onClick={() => setPayOpen(true)}>
                          Record payment
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        <Link
          to="/billing"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Billing
        </Link>

        {/* ── Header ──────────────────────────────────────────────────────── */}
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
                {orderCode && ` · Order ${orderCode}`}
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
              {isIssued && balance > 0 && can(PERMS.paymentsCreate) && (
                <Button onClick={() => setPayOpen(true)}>Record payment</Button>
              )}
              {isIssued && can(PERMS.invoicesCancel) && Number(invoice.amount_paid) === 0 && (
                <Button
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => setCancelOpen(true)}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>

          {isIssued && !showConfirmation && (
            <div className="mt-4 border-t border-gray-100 pt-4">{actions}</div>
          )}

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
          {/* ── Items ─────────────────────────────────────────────────────── */}
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

          {/* ── Payments ──────────────────────────────────────────────────── */}
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

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
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
