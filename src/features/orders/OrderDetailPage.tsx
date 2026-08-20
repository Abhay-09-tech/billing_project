import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FlaskConical, MessageCircle, Phone, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import {
  createLabOrder,
  getLabVendors,
  getOrderDetail,
  getOrderStatuses,
  setOrderStatus,
} from '@/services/orders'
import { createInvoiceFromOrder, issueInvoice } from '@/services/billing'
import type { OrderStatusCode } from '@/types/database'
import { formatMoney } from '@/lib/money'
import { formatDate, formatDateTime, formatMobile } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, ErrorState, LoadingState } from '@/components/ui/layout'
import { OrderStatusBadge } from '@/components/ui/badge'
import { Table, TBody, TD, TDNum, TH, THead, THNum, TR } from '@/components/ui/table'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Input, Select, Textarea } from '@/components/ui/fields'
import { RxCard } from '@/features/prescriptions/RxCard'
import { WhatsAppShareDialog } from '@/features/whatsapp/WhatsAppShareDialog'
import { buildOrderReadyMessage, buildOrderUpdateMessage } from '@/lib/whatsapp'
import { getSetting } from '@/services/settings'

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()

  const [pendingStatus, setPendingStatus] = useState<OrderStatusCode | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [labOpen, setLabOpen] = useState(false)
  const [waOpen, setWaOpen] = useState(false)

  const shop = useQuery({
    queryKey: ['settings', 'shop.profile'],
    queryFn: () => getSetting<{ name?: string }>('shop.profile'),
  })

  const query = useQuery({
    queryKey: ['order', id],
    queryFn: () => getOrderDetail(id!),
    enabled: Boolean(id),
  })
  const statuses = useQuery({ queryKey: ['order-statuses'], queryFn: getOrderStatuses })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['order', id] })
    void queryClient.invalidateQueries({ queryKey: ['orders'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const statusMutation = useMutation({
    mutationFn: ({ status, note }: { status: OrderStatusCode; note?: string }) =>
      setOrderStatus(id!, status, note),
    onSuccess: (order) => {
      const label = statuses.data?.find((s) => s.code === order.status)?.label ?? order.status
      toast.success(`Order marked as ${label}`)
      invalidate()
      setPendingStatus(null)
      setCancelOpen(false)
      setCancelReason('')
    },
    onError: (err) => {
      toast.error(friendlyError(err, 'Could not update the order status.'))
      setPendingStatus(null)
    },
  })

  const invoiceMutation = useMutation({
    mutationFn: async () => {
      // Create the draft and issue it in one action: staff think of this as
      // "make the bill", not two steps. rpc_create_invoice is guarded by a
      // unique index on (order_id) so a double click cannot bill twice.
      const draft = await createInvoiceFromOrder(query.data!.order.customer_id, id!)
      return issueInvoice(draft.id)
    },
    onSuccess: (invoice) => {
      toast.success(`Invoice ${invoice.invoice_no} created`)
      invalidate()
      navigate(`/billing/${invoice.id}?created=1`)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not create the bill.')),
  })

  if (query.isPending) return <LoadingState label="Loading order…" />
  if (query.isError)
    return <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />

  const { order, items, history, prescription, labOrders } = query.data
  const current = statuses.data?.find((s) => s.code === order.status)
  const nextStatuses = (current?.allowed_next ?? []).filter((c) => c !== 'cancelled')
  const canCancel = (current?.allowed_next ?? []).includes('cancelled')
  const balance = Number(order.grand_total) - Number(order.advance_amount)
  const isReady = order.status === 'ready' || order.status === 'customer_notified'
  const shopName = shop.data?.name || 'Perfect Optical Vision'
  const customerName = order.customers?.full_name ?? 'Customer'

  // "Ready" gets the pickup wording; every other status gets a progress update.
  const waMessage = isReady
    ? buildOrderReadyMessage({
        shopName,
        customerName,
        orderCode: order.order_code,
        balance,
      })
    : buildOrderUpdateMessage({
        shopName,
        customerName,
        orderCode: order.order_code,
        statusLabel: current?.label ?? order.status,
        expectedDate: order.expected_delivery_date ? formatDate(order.expected_delivery_date) : null,
      })

  return (
    <>
      <Link
        to="/orders"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Orders
      </Link>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="mb-5 rounded-xl border border-cream-300 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-brand-900 sm:text-2xl">{order.order_code}</h1>
              <OrderStatusBadge status={order.status} label={current?.label} />
            </div>
            <p className="mt-1 text-sm text-brand-600">
              Created {formatDate(order.created_at)}
              {order.expected_delivery_date
                ? ` · Expected ${formatDate(order.expected_delivery_date)}`
                : ''}
            </p>
            <Link
              to={`/customers/${order.customer_id}`}
              className="mt-2 inline-block font-medium text-brand-700 hover:text-brand-800"
            >
              {order.customers?.full_name}
            </Link>
            <p className="text-sm text-brand-600">{formatMobile(order.customers?.mobile)}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {order.customers?.mobile && (
              <a href={`tel:+91${order.customers.mobile}`}>
                <Button variant="outline" size="sm">
                  <Phone className="h-4 w-4" />
                  Call
                </Button>
              </a>
            )}
            {can(PERMS.whatsappSend) && (
              <Button
                variant={isReady ? 'primary' : 'outline'}
                size="sm"
                className={
                  isReady
                    ? 'bg-brand-700 hover:bg-brand-800'
                    : 'border-brand-300 text-brand-700 hover:bg-brand-50'
                }
                onClick={() => setWaOpen(true)}
              >
                <MessageCircle className="h-4 w-4" />
                {isReady ? 'Notify Customer on WhatsApp' : 'Send Order Update'}
              </Button>
            )}
            {can(PERMS.labManage) && labOrders.length === 0 && (
              <Button variant="outline" size="sm" onClick={() => setLabOpen(true)}>
                <FlaskConical className="h-4 w-4" />
                Send to lab
              </Button>
            )}
            {can(PERMS.invoicesCreate) && !order.invoice_id && order.status !== 'cancelled' && (
              <Button size="sm" loading={invoiceMutation.isPending} onClick={() => invoiceMutation.mutate()}>
                <Receipt className="h-4 w-4" />
                Create bill
              </Button>
            )}
            {order.invoice_id && (
              <Link to={`/billing/${order.invoice_id}`}>
                <Button variant="outline" size="sm">
                  <Receipt className="h-4 w-4" />
                  View bill
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* ── Status actions ──────────────────────────────────────────── */}
        {can(PERMS.ordersUpdateStatus) && (nextStatuses.length > 0 || canCancel) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-cream-200 pt-4">
            <span className="text-sm text-brand-600">Move to:</span>
            {nextStatuses.map((code) => {
              const s = statuses.data?.find((x) => x.code === code)
              return (
                <Button
                  key={code}
                  size="sm"
                  variant={code === 'ready' || code === 'delivered' ? 'primary' : 'outline'}
                  loading={statusMutation.isPending && pendingStatus === code}
                  disabled={statusMutation.isPending}
                  onClick={() => {
                    setPendingStatus(code)
                    statusMutation.mutate({ status: code })
                  }}
                >
                  {s?.label ?? code}
                </Button>
              )
            })}
            {canCancel && (
              <Button
                size="sm"
                variant="ghost"
                className="text-error-600 hover:bg-error-50"
                onClick={() => setCancelOpen(true)}
              >
                Cancel order
              </Button>
            )}
          </div>
        )}

        {order.status === 'cancelled' && order.cancel_reason && (
          <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
            Cancelled: {order.cancel_reason}
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
                <TH>Item</TH>
                <THNum>Qty</THNum>
                <THNum>Price</THNum>
                <THNum className="hidden sm:table-cell">Discount</THNum>
                <THNum>Total</THNum>
              </TR>
            </THead>
            <TBody>
              {items.map((item) => (
                <TR key={item.id}>
                  <TD>
                    <p className="font-medium text-brand-900">{item.description}</p>
                    <p className="text-xs text-brand-600 capitalize">
                      {item.item_kind === 'lens' ? 'Lens (made to order)' : item.item_kind}
                    </p>
                  </TD>
                  <TDNum>{item.qty}</TDNum>
                  <TDNum>{formatMoney(item.unit_price)}</TDNum>
                  <TDNum className="hidden text-brand-600 sm:table-cell">
                    {Number(item.discount_amt) > 0 ? formatMoney(item.discount_amt) : '—'}
                  </TDNum>
                  <TDNum className="font-medium">{formatMoney(item.line_total)}</TDNum>
                </TR>
              ))}
            </TBody>
          </Table>
          <dl className="space-y-1.5 border-t border-cream-200 px-4 py-4 text-sm sm:px-5">
            <div className="flex justify-between text-brand-700">
              <dt>Total (incl. GST)</dt>
              <dd className="tabular-nums">{formatMoney(order.grand_total)}</dd>
            </div>
            <div className="flex justify-between text-brand-700">
              <dt>Advance received</dt>
              <dd className="tabular-nums">{formatMoney(order.advance_amount)}</dd>
            </div>
            <div className="flex justify-between border-t border-cream-200 pt-1.5 font-semibold text-brand-900">
              <dt>Balance</dt>
              <dd className={`tabular-nums ${balance > 0 ? 'text-warning-700' : ''}`}>
                {formatMoney(balance)}
              </dd>
            </div>
          </dl>
          {order.notes && (
            <p className="border-t border-cream-200 px-4 py-3 text-sm text-brand-700 sm:px-5">
              <span className="font-medium text-brand-800">Notes: </span>
              {order.notes}
            </p>
          )}
        </Card>

        <div className="space-y-5">
          {/* ── Prescription ────────────────────────────────────────── */}
          <Card>
            <CardHeader title="Prescription" />
            <div className="p-4 sm:p-5">
              {prescription ? (
                <RxCard rx={prescription} />
              ) : (
                <p className="text-sm text-brand-600">
                  No prescription linked to this order.
                </p>
              )}
            </div>
          </Card>

          {/* ── Lab ─────────────────────────────────────────────────── */}
          {labOrders.length > 0 && (
            <Card>
              <CardHeader title="Lab" />
              <div className="space-y-3 p-4 sm:p-5">
                {labOrders.map((lab) => (
                  <div key={lab.id} className="text-sm">
                    <p className="font-medium text-brand-900 capitalize">
                      {lab.status.replaceAll('_', ' ')}
                    </p>
                    <p className="text-brand-600">Sent {formatDate(lab.sent_at)}</p>
                    {lab.expected_return_date && (
                      <p className="text-brand-600">
                        Expected back {formatDate(lab.expected_return_date)}
                      </p>
                    )}
                    {lab.lens_details && <p className="mt-1 text-brand-700">{lab.lens_details}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── History ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader title="History" />
            <ol className="space-y-3 p-4 sm:p-5">
              {history.map((h) => (
                <li key={h.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  <div>
                    <p className="text-brand-900">
                      {statuses.data?.find((s) => s.code === h.to_status)?.label ?? h.to_status}
                    </p>
                    <p className="text-xs text-brand-600">{formatDateTime(h.changed_at)}</p>
                    {h.note && <p className="mt-0.5 text-brand-700">{h.note}</p>}
                  </div>
                </li>
              ))}
              <li className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-300" />
                <div>
                  <p className="text-brand-900">Order created</p>
                  <p className="text-xs text-brand-600">{formatDateTime(order.created_at)}</p>
                </div>
              </li>
            </ol>
          </Card>
        </div>
      </div>

      {/* ── Cancel ──────────────────────────────────────────────────── */}
      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this order?"
        description="Stocked items go back on the shelf. The order stays visible in history."
      >
        <div className="space-y-4">
          <FormField label="Reason" required hint="Recorded permanently against the order" htmlFor="cancel-reason">
            <Textarea
              id="cancel-reason"
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Customer changed their mind"
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
            <Button
              variant="danger"
              disabled={cancelReason.trim().length < 3}
              loading={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ status: 'cancelled', note: cancelReason.trim() })}
            >
              Cancel order
            </Button>
          </div>
        </div>
      </Dialog>

      <SendToLabDialog
        open={labOpen}
        onOpenChange={setLabOpen}
        orderId={id!}
        defaultDetails={items
          .filter((i) => i.item_kind === 'lens')
          .map((i) => i.description)
          .join('; ')}
        onDone={invalidate}
      />

      <WhatsAppShareDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        title={isReady ? 'Notify customer — order ready' : 'Send order update'}
        customerId={order.customer_id}
        customerName={customerName}
        savedWhatsApp={order.customers?.whatsapp_number}
        mobile={order.customers?.mobile}
        message={waMessage}
        relatedEntityType="order"
        relatedEntityId={order.id}
        onSent={invalidate}
      />
    </>
  )
}

function SendToLabDialog({
  open,
  onOpenChange,
  orderId,
  defaultDetails,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  orderId: string
  defaultDetails: string
  onDone: () => void
}) {
  const [vendorId, setVendorId] = useState('')
  const [details, setDetails] = useState(defaultDetails)
  const [expected, setExpected] = useState('')

  const vendors = useQuery({ queryKey: ['lab-vendors'], queryFn: getLabVendors, enabled: open })

  const mutation = useMutation({
    mutationFn: () =>
      createLabOrder({
        order_id: orderId,
        lab_vendor_id: vendorId || null,
        lens_details: details.trim() || null,
        expected_return_date: expected || null,
      }),
    onSuccess: () => {
      toast.success('Sent to lab')
      onDone()
      onOpenChange(false)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not create the lab job.')),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Send to lab" description="Create the lab job for this order">
      <div className="space-y-4">
        <FormField label="Lab" htmlFor="lab-vendor">
          <Select id="lab-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Not specified</option>
            {vendors.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          {vendors.data?.length === 0 && (
            <p className="mt-1 text-xs text-brand-600">
              No labs added yet — you can still create the job and set the lab later.
            </p>
          )}
        </FormField>
        <FormField label="Lens details" hint="What the lab needs to make" htmlFor="lab-details">
          <Textarea id="lab-details" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
        </FormField>
        <FormField label="Expected back on" htmlFor="lab-date">
          <Input
            id="lab-date"
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Send to lab
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
