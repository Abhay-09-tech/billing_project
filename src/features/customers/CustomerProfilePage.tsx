import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CreditCard,
  Eye,
  MessageCircle,
  Phone,
  Plus,
  Receipt,
  ShoppingBag,
} from 'lucide-react'
import { getCustomer360 } from '@/services/customers'
import { formatMoney } from '@/lib/money'
import { formatDate, formatMobile, formatRelativeDay } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, EmptyState, ErrorState, LoadingState } from '@/components/ui/layout'
import { InvoiceStatusBadge, OrderStatusBadge, PaymentStatusBadge, WaStatusBadge } from '@/components/ui/badge'
import { Table, TBody, TD, TDNum, TH, THead, THNum, TR } from '@/components/ui/table'
import { RxCard } from '@/features/prescriptions/RxCard'
import { NewPrescriptionDialog } from '@/features/prescriptions/NewPrescriptionDialog'

export default function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [rxOpen, setRxOpen] = useState(false)

  const query = useQuery({
    queryKey: ['customer', id],
    queryFn: () => getCustomer360(id!),
    enabled: Boolean(id),
  })

  if (query.isPending) return <LoadingState label="Loading customer…" />
  if (query.isError)
    return <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />

  const { customer, prescriptions, orders, invoices, payments, whatsapp, totals, addresses } = query.data
  const currentRx = prescriptions.find((p) => !p.voided_at)
  const history = prescriptions.filter((p) => p.id !== currentRx?.id)
  const waNumber = customer.whatsapp_number ?? customer.mobile

  return (
    <>
      <Link
        to="/customers"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Customers
      </Link>

      {/* ── Identity + summary ───────────────────────────────────────────── */}
      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{customer.full_name}</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {customer.customer_code}
              {customer.city ? ` · ${customer.city}` : ''}
            </p>
            {addresses[0] && <p className="mt-1 text-sm text-gray-600">{addresses[0].address_line}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`tel:+91${customer.mobile}`}>
              <Button variant="outline" size="sm">
                <Phone className="h-4 w-4" />
                {formatMobile(customer.mobile)}
              </Button>
            </a>
            <a href={`https://wa.me/91${waNumber}`} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </Button>
            </a>
            {can(PERMS.ordersCreate) && (
              <Button size="sm" onClick={() => navigate(`/orders?new=1&customer=${customer.id}`)}>
                <Plus className="h-4 w-4" />
                New order
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Summary label="Total orders" value={totals.totalOrders} />
          <Summary label="Total purchases" value={formatMoney(totals.totalPurchases)} />
          <Summary label="Total paid" value={formatMoney(totals.totalPaid)} />
          <Summary
            label="Outstanding"
            value={formatMoney(totals.outstanding)}
            tone={totals.outstanding > 0 ? 'amber' : undefined}
          />
          <Summary label="First purchase" value={customer.first_purchase_at ? formatDate(customer.first_purchase_at) : '—'} />
          <Summary label="Last visit" value={customer.last_visit_at ? formatRelativeDay(customer.last_visit_at) : 'Never'} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Prescriptions ─────────────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Prescriptions"
            actions={
              can(PERMS.prescriptionsCreate) && (
                <Button size="sm" onClick={() => setRxOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Add prescription
                </Button>
              )
            }
          />
          <div className="p-4 sm:p-5">
            {prescriptions.length === 0 ? (
              <EmptyState
                title="No prescription recorded"
                hint="Add the customer's current prescription to use it on orders."
                icon={<Eye className="h-10 w-10" />}
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Current prescription
                  </p>
                  {currentRx ? (
                    <RxCard rx={currentRx} />
                  ) : (
                    <p className="text-sm text-gray-500">All prescriptions have been voided.</p>
                  )}
                </div>
                {history.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                      History ({history.length})
                    </p>
                    <div className="space-y-2">
                      {history.map((rx) => (
                        <RxCard key={rx.id} rx={rx} compact />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* ── Orders ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader title={`Orders (${orders.length})`} />
          {orders.length === 0 ? (
            <EmptyState title="No orders yet" icon={<ShoppingBag className="h-10 w-10" />} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Date</TH>
                  <THNum>Amount</THNum>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {orders.map((o) => (
                  <TR key={o.id} onClick={() => navigate(`/orders/${o.id}`)}>
                    <TD className="font-medium text-gray-900">{o.order_code}</TD>
                    <TD className="whitespace-nowrap text-gray-500">{formatDate(o.created_at)}</TD>
                    <TDNum>{formatMoney(o.grand_total)}</TDNum>
                    <TD>
                      <OrderStatusBadge status={o.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* ── Invoices ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader title={`Invoices (${invoices.length})`} />
          {invoices.length === 0 ? (
            <EmptyState title="No invoices yet" icon={<Receipt className="h-10 w-10" />} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Date</TH>
                  <THNum>Total</THNum>
                  <TH>Payment</TH>
                </TR>
              </THead>
              <TBody>
                {invoices.map((i) => (
                  <TR key={i.id} onClick={() => navigate(`/billing/${i.id}`)}>
                    <TD className="font-medium text-gray-900">
                      {i.invoice_no ?? <InvoiceStatusBadge status={i.status} />}
                    </TD>
                    <TD className="whitespace-nowrap text-gray-500">
                      {i.invoice_date ? formatDate(i.invoice_date) : formatDate(i.created_at)}
                    </TD>
                    <TDNum>{formatMoney(i.grand_total)}</TDNum>
                    <TD>
                      {i.status === 'issued' ? (
                        <PaymentStatusBadge grandTotal={Number(i.grand_total)} amountPaid={Number(i.amount_paid)} />
                      ) : (
                        <InvoiceStatusBadge status={i.status} />
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* ── Payments ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader title={`Payments (${payments.length})`} />
          {payments.length === 0 ? (
            <EmptyState title="No payments yet" icon={<CreditCard className="h-10 w-10" />} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Receipt</TH>
                  <TH>Date</TH>
                  <TH>Method</TH>
                  <THNum>Amount</THNum>
                </TR>
              </THead>
              <TBody>
                {payments.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-gray-900">{p.payment_code}</TD>
                    <TD className="whitespace-nowrap text-gray-500">{formatDate(p.paid_at)}</TD>
                    <TD className="capitalize text-gray-600">{p.method.replace('_', ' ')}</TD>
                    <TDNum className={p.direction < 0 ? 'text-red-600' : ''}>
                      {p.direction < 0 ? '−' : ''}
                      {formatMoney(p.amount)}
                    </TDNum>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* ── WhatsApp history ──────────────────────────────────────────── */}
        <Card>
          <CardHeader title="WhatsApp history" />
          {whatsapp.length === 0 ? (
            <EmptyState
              title="No messages sent"
              hint="Order and payment notifications will appear here once WhatsApp is connected."
              icon={<MessageCircle className="h-10 w-10" />}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Message</TH>
                  <TH>Date</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {whatsapp.map((msg) => (
                  <TR key={msg.id}>
                    <TD className="max-w-xs truncate text-gray-700">{msg.rendered_body ?? '—'}</TD>
                    <TD className="whitespace-nowrap text-gray-500">{formatDate(msg.created_at)}</TD>
                    <TD>
                      <WaStatusBadge status={msg.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      {id && (
        <NewPrescriptionDialog open={rxOpen} onOpenChange={setRxOpen} customerId={id} />
      )}
    </>
  )
}

function Summary({ label, value, tone }: { label: string; value: string | number; tone?: 'amber' }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={`mt-0.5 text-sm font-semibold tabular-nums sm:text-base ${
          tone === 'amber' ? 'text-amber-700' : 'text-gray-900'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
