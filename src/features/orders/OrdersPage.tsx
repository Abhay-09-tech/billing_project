import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, ShoppingBag } from 'lucide-react'
import { getOrderStatuses, listOrders } from '@/services/orders'
import type { OrderStatusCode } from '@/types/database'
import { formatMoney } from '@/lib/money'
import { formatDate, formatMobile } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { SearchInput } from '@/components/ui/search-input'
import { Pagination } from '@/components/ui/pagination'
import { Table, TBody, TD, TDNum, TH, THead, THNum, TR } from '@/components/ui/table'
import { OrderStatusBadge } from '@/components/ui/badge'
import { Select } from '@/components/ui/fields'
import { NewOrderDialog } from './NewOrderDialog'

const PAGE_SIZE = 25

export default function OrdersPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const statusParam = searchParams.get('status') ?? 'open'
  const newOpen = searchParams.get('new') === '1'
  const initialCustomer = searchParams.get('customer')

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const statuses = useQuery({ queryKey: ['order-statuses'], queryFn: getOrderStatuses })

  const query = useQuery({
    queryKey: ['orders', 'list', search, statusParam, page],
    queryFn: () =>
      listOrders({
        search,
        status: statusParam === 'all' ? undefined : (statusParam as OrderStatusCode | 'open'),
        page,
        pageSize: PAGE_SIZE,
      }),
  })

  const statusLabel = (code: OrderStatusCode) =>
    statuses.data?.find((s) => s.code === code)?.label ?? code.replaceAll('_', ' ')

  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle={query.data ? `${query.data.total} shown` : undefined}
        actions={
          can(PERMS.ordersCreate) && (
            <Button onClick={() => setParam('new', '1')}>
              <Plus className="h-4 w-4" />
              New order
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput
          value={search}
          onValueChange={(v) => {
            setSearch(v)
            setPage(0)
          }}
          placeholder="Search order number…"
          className="w-full max-w-sm"
        />
        <Select
          value={statusParam}
          onChange={(e) => {
            setParam('status', e.target.value)
            setPage(0)
          }}
          className="w-full max-w-[14rem]"
          aria-label="Filter by status"
        >
          <option value="open">In progress</option>
          <option value="all">All orders</option>
          {statuses.data?.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.rows.length === 0 ? (
          <EmptyState
            title={statusParam === 'open' ? 'No orders in progress' : 'No orders found'}
            hint={
              statusParam === 'open'
                ? 'Completed and cancelled orders are hidden — switch the filter to see them.'
                : 'Try a different filter or search.'
            }
            icon={<ShoppingBag className="h-10 w-10" />}
            action={
              can(PERMS.ordersCreate) && (
                <Button onClick={() => setParam('new', '1')}>
                  <Plus className="h-4 w-4" />
                  New order
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Customer</TH>
                  <TH className="hidden md:table-cell">Mobile</TH>
                  <THNum>Amount</THNum>
                  <THNum className="hidden sm:table-cell">Balance</THNum>
                  <TH>Status</TH>
                  <TH className="hidden lg:table-cell">Expected</TH>
                </TR>
              </THead>
              <TBody>
                {query.data.rows.map((o) => {
                  const balance = Number(o.grand_total) - Number(o.advance_amount)
                  const overdue =
                    o.expected_delivery_date &&
                    !['delivered', 'completed', 'cancelled'].includes(o.status) &&
                    o.expected_delivery_date < today
                  return (
                    <TR key={o.id} onClick={() => navigate(`/orders/${o.id}`)}>
                      <TD>
                        <p className="font-medium text-brand-900">{o.order_code}</p>
                        <p className="text-xs text-brand-600">{formatDate(o.created_at)}</p>
                      </TD>
                      <TD>{o.customers?.full_name ?? '—'}</TD>
                      <TD className="hidden tabular-nums text-brand-600 md:table-cell">
                        {formatMobile(o.customers?.mobile)}
                      </TD>
                      <TDNum>{formatMoney(o.grand_total)}</TDNum>
                      <TDNum
                        className={`hidden sm:table-cell ${balance > 0 ? 'text-warning-700' : 'text-brand-500'}`}
                      >
                        {balance > 0 ? formatMoney(balance) : '—'}
                      </TDNum>
                      <TD>
                        <OrderStatusBadge status={o.status} label={statusLabel(o.status)} />
                      </TD>
                      <TD
                        className={`hidden lg:table-cell ${overdue ? 'font-medium text-error-600' : 'text-brand-600'}`}
                      >
                        {o.expected_delivery_date ? formatDate(o.expected_delivery_date) : '—'}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={query.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      <NewOrderDialog
        open={newOpen}
        onOpenChange={(v) => {
          setParam('new', v ? '1' : null)
          if (!v) setParam('customer', null)
        }}
        initialCustomerId={initialCustomer}
        onCreated={(order) => navigate(`/orders/${order.id}`)}
      />
    </>
  )
}
