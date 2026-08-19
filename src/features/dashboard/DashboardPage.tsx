import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  PackageCheck,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  UserPlus,
  Users,
} from 'lucide-react'
import { getDashboardMetrics, getSalesOverview, subscribeToBusinessChanges } from '@/services/dashboard'
import { listTodayQueue } from '@/services/orders'
import { formatMoney, formatMoneyWhole } from '@/lib/money'
import { formatDate, formatMobile } from '@/lib/format'
import { RANGE_LABELS, resolveRange, type RangePreset } from '@/lib/date-ranges'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/ui/badge'
import { Table, TBody, TD, TDNum, TH, THead, THNum, TR } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can, user } = useAuth()
  const [preset, setPreset] = useState<RangePreset>('last7')

  const metrics = useQuery({
    queryKey: ['dashboard', 'metrics'],
    queryFn: () => getDashboardMetrics(),
  })

  const queue = useQuery({
    queryKey: ['dashboard', 'queue'],
    queryFn: listTodayQueue,
  })

  const range = useMemo(() => resolveRange(preset), [preset])
  const sales = useQuery({
    queryKey: ['dashboard', 'sales', range.from, range.to],
    queryFn: () => getSalesOverview(range.from, range.to),
    enabled: can(PERMS.reportsRead),
  })

  // Realtime as an invalidation signal only.
  useEffect(
    () =>
      subscribeToBusinessChanges(() => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      }),
    [queryClient],
  )

  const m = metrics.data

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${user?.profile.full_name.split(' ')[0] ?? ''}`}
        subtitle={formatDate(new Date().toISOString())}
      />

      {/* ── Quick actions (brief §6) ─────────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <QuickAction icon={UserPlus} label="New Customer" onClick={() => navigate('/customers?new=1')} show={can(PERMS.customersCreate)} />
        <QuickAction icon={ShoppingBag} label="New Order" onClick={() => navigate('/orders?new=1')} show={can(PERMS.ordersCreate)} />
        <QuickAction icon={Receipt} label="New Bill" onClick={() => navigate('/billing?new=1')} show={can(PERMS.invoicesCreate)} />
        <QuickAction icon={CreditCard} label="Add Payment" onClick={() => navigate('/payments?new=1')} show={can(PERMS.paymentsCreate)} />
        <QuickAction icon={Search} label="Find Customer" onClick={() => navigate('/customers')} show={can(PERMS.customersRead)} />
        <QuickAction icon={Plus} label="Add Product" onClick={() => navigate('/products?new=1')} show={can(PERMS.productsCreate)} />
      </div>

      {/* ── Today's metrics ──────────────────────────────────────────────── */}
      {metrics.isPending ? (
        <Card className="mb-5">
          <LoadingState label="Loading today's numbers…" />
        </Card>
      ) : metrics.isError ? (
        <Card className="mb-5">
          <ErrorState message={friendlyError(metrics.error)} onRetry={() => void metrics.refetch()} />
        </Card>
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Sales today" value={formatMoneyWhole(m!.sales_today)} icon={IndianRupee} tone="teal" />
          <Stat label="Collected today" value={formatMoneyWhole(m!.payments_today)} icon={CreditCard} tone="green" />
          <Stat label="Outstanding" value={formatMoneyWhole(m!.outstanding_total)} icon={AlertTriangle} tone={m!.outstanding_total > 0 ? 'amber' : 'gray'} onClick={() => navigate('/payments?tab=outstanding')} />
          <Stat label="Orders today" value={m!.orders_today} icon={ShoppingBag} />
          <Stat label="Customers today" value={m!.customers_today} icon={Users} sub={`${m!.new_customers} new · ${m!.returning_customers} returning`} />
          <Stat label="Pending orders" value={m!.pending_orders} icon={ShoppingBag} onClick={() => navigate('/orders?status=open')} />
          <Stat label="Ready for pickup" value={m!.ready_for_pickup} icon={PackageCheck} tone={m!.ready_for_pickup > 0 ? 'green' : 'gray'} onClick={() => navigate('/orders?status=ready')} />
          <Stat label="Delivered today" value={m!.delivered_today} icon={CheckCircle2} />
        </div>
      )}

      {/* ── Alerts row ───────────────────────────────────────────────────── */}
      {m && (m.low_stock_count > 0 || m.wa_failed_today > 0) && (
        <div className="mb-5 flex flex-wrap gap-2">
          {m.low_stock_count > 0 && (
            <button
              onClick={() => navigate('/inventory?filter=low')}
              className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              <AlertTriangle className="h-4 w-4" />
              {m.low_stock_count} product{m.low_stock_count === 1 ? '' : 's'} at or below minimum stock
            </button>
          )}
          {m.wa_failed_today > 0 && (
            <button
              onClick={() => navigate('/whatsapp?status=failed')}
              className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              <AlertTriangle className="h-4 w-4" />
              {m.wa_failed_today} WhatsApp message{m.wa_failed_today === 1 ? '' : 's'} failed today
            </button>
          )}
        </div>
      )}

      {/* ── Today's order queue (brief §6) ───────────────────────────────── */}
      <Card className="mb-5">
        <CardHeader
          title="Today's orders"
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('/orders')}>
              View all
            </Button>
          }
        />
        {queue.isPending ? (
          <LoadingState />
        ) : queue.isError ? (
          <ErrorState message={friendlyError(queue.error)} onRetry={() => void queue.refetch()} />
        ) : queue.data!.length === 0 ? (
          <EmptyState
            title="No orders yet today"
            hint="Orders created today appear here with their payment and delivery status."
            icon={<ShoppingBag className="h-10 w-10" />}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Customer</TH>
                <TH className="hidden sm:table-cell">Mobile</TH>
                <THNum>Amount</THNum>
                <TH>Payment</TH>
                <TH>Status</TH>
                <TH className="hidden lg:table-cell">Expected</TH>
              </TR>
            </THead>
            <TBody>
              {queue.data!.map((order) => (
                <TR key={order.id} onClick={() => navigate(`/orders/${order.id}`)}>
                  <TD className="font-medium text-gray-900">{order.order_code}</TD>
                  <TD>{order.customers?.full_name ?? '—'}</TD>
                  <TD className="hidden text-gray-500 sm:table-cell">{formatMobile(order.customers?.mobile)}</TD>
                  <TDNum>{formatMoney(order.grand_total)}</TDNum>
                  <TD>
                    <PaymentStatusBadge grandTotal={Number(order.grand_total)} amountPaid={Number(order.advance_amount)} />
                  </TD>
                  <TD>
                    <OrderStatusBadge status={order.status} />
                  </TD>
                  <TD className="hidden text-gray-500 lg:table-cell">
                    {order.expected_delivery_date ? formatDate(order.expected_delivery_date) : '—'}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* ── Sales overview (brief §6) ────────────────────────────────────── */}
      {can(PERMS.reportsRead) && (
        <Card>
          <CardHeader
            title="Sales overview"
            actions={
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as RangePreset)}
                className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm focus:border-brand-600 focus:outline-none"
                aria-label="Date range"
              >
                {(['today', 'yesterday', 'last7', 'last30', 'this_month', 'prev_month'] as RangePreset[]).map((p) => (
                  <option key={p} value={p}>
                    {RANGE_LABELS[p]}
                  </option>
                ))}
              </select>
            }
          />
          {sales.isPending ? (
            <LoadingState />
          ) : sales.isError ? (
            <ErrorState message={friendlyError(sales.error)} onRetry={() => void sales.refetch()} />
          ) : (
            <SalesTable rows={sales.data!} />
          )}
        </Card>
      )}
    </>
  )
}

function SalesTable({ rows }: { rows: Array<{ day: string; orders_count: number; invoices_count: number; gross_sales: number; discounts: number; gst: number; collected: number }> }) {
  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + Number(r.orders_count),
      invoices: acc.invoices + Number(r.invoices_count),
      gross: acc.gross + Number(r.gross_sales),
      gst: acc.gst + Number(r.gst),
      collected: acc.collected + Number(r.collected),
    }),
    { orders: 0, invoices: 0, gross: 0, gst: 0, collected: 0 },
  )

  if (rows.length === 0) return <EmptyState title="No data for this period" />

  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-gray-100 px-4 py-4 sm:grid-cols-4 sm:px-5">
        <MiniStat label="Orders" value={totals.orders} />
        <MiniStat label="Bills" value={totals.invoices} />
        <MiniStat label="Sales" value={formatMoneyWhole(totals.gross)} />
        <MiniStat label="Collected" value={formatMoneyWhole(totals.collected)} />
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Date</TH>
            <THNum>Orders</THNum>
            <THNum>Bills</THNum>
            <THNum>Sales</THNum>
            <THNum className="hidden sm:table-cell">GST</THNum>
            <THNum>Collected</THNum>
          </TR>
        </THead>
        <TBody>
          {[...rows].reverse().map((r) => (
            <TR key={r.day}>
              <TD className="whitespace-nowrap">{formatDate(r.day)}</TD>
              <TDNum>{r.orders_count}</TDNum>
              <TDNum>{r.invoices_count}</TDNum>
              <TDNum>{formatMoney(r.gross_sales)}</TDNum>
              <TDNum className="hidden text-gray-500 sm:table-cell">{formatMoney(r.gst)}</TDNum>
              <TDNum>{formatMoney(r.collected)}</TDNum>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-gray-900 tabular-nums">{value}</p>
    </div>
  )
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
  show,
}: {
  icon: typeof Plus
  label: string
  onClick: () => void
  show: boolean
}) {
  if (!show) return null
  return (
    <button
      onClick={onClick}
      className="flex min-h-touch flex-col items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 py-3.5 text-center text-xs font-medium text-gray-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 sm:text-sm"
    >
      <Icon className="h-5 w-5 text-brand-700" aria-hidden />
      {label}
    </button>
  )
}

const statTones = {
  gray: 'text-gray-400',
  teal: 'text-brand-600',
  green: 'text-green-600',
  amber: 'text-amber-600',
} as const

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'gray',
  onClick,
}: {
  label: string
  value: string | number
  sub?: string
  icon: typeof Users
  tone?: keyof typeof statTones
  onClick?: () => void
}) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        'rounded-xl border border-gray-200 bg-white p-3.5 text-left sm:p-4',
        onClick && 'transition-colors hover:border-brand-300 hover:bg-brand-50/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-gray-500 sm:text-sm">{label}</p>
        <Icon className={cn('h-4 w-4 shrink-0', statTones[tone])} aria-hidden />
      </div>
      <p className="mt-1 text-xl font-semibold text-gray-900 tabular-nums sm:text-2xl">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </Wrapper>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
