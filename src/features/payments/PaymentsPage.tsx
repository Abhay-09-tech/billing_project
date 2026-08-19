import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CreditCard, MessageCircle } from 'lucide-react'
import { listOutstanding, listPayments } from '@/services/billing'
import type { PaymentMethod } from '@/types/database'
import { formatMoney, formatMoneyWhole } from '@/lib/money'
import { formatDate, formatDateTime, formatMobile } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Card, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { Pagination } from '@/components/ui/pagination'
import { Table, TBody, TD, TDNum, TH, THead, THNum, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/fields'
import { RANGE_LABELS, resolveRange, type RangePreset } from '@/lib/date-ranges'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

type Tab = 'received' | 'outstanding'

export default function PaymentsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const [preset, setPreset] = useState<RangePreset>('last30')
  const [method, setMethod] = useState<PaymentMethod | ''>('')

  const tab: Tab = searchParams.get('tab') === 'outstanding' ? 'outstanding' : 'received'
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'outstanding') params.set('tab', 'outstanding')
    else params.delete('tab')
    setSearchParams(params, { replace: true })
    setPage(0)
  }

  const range = resolveRange(preset)

  const payments = useQuery({
    queryKey: ['payments', 'list', range.from, range.to, method, page],
    queryFn: () =>
      listPayments({
        from: range.from,
        to: range.to,
        method: method || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: tab === 'received',
  })

  const outstanding = useQuery({
    queryKey: ['payments', 'outstanding'],
    queryFn: listOutstanding,
    enabled: tab === 'outstanding',
  })

  // Payment-method breakdown for the period (brief §24 Payment Report).
  const byMethod = (payments.data?.rows ?? []).reduce<Record<string, number>>((acc, p) => {
    acc[p.method] = (acc[p.method] ?? 0) + Number(p.amount) * p.direction
    return acc
  }, {})
  const collected = Object.values(byMethod).reduce((a, b) => a + b, 0)

  const outstandingTotal = (outstanding.data ?? []).reduce((s, r) => s + Number(r.balance), 0)

  return (
    <>
      <PageHeader title="Payments" subtitle="Money received, and what is still owed" />

      <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 sm:inline-flex">
        {(
          [
            ['received', 'Received'],
            ['outstanding', 'Outstanding'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors sm:flex-none',
              tab === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'received' ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Select
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value as RangePreset)
                setPage(0)
              }}
              className="w-full max-w-[11rem]"
              aria-label="Date range"
            >
              {(
                ['today', 'yesterday', 'last7', 'last30', 'this_month', 'prev_month', 'this_year'] as RangePreset[]
              ).map((p) => (
                <option key={p} value={p}>
                  {RANGE_LABELS[p]}
                </option>
              ))}
            </Select>
            <Select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as PaymentMethod | '')
                setPage(0)
              }}
              className="w-full max-w-[10rem]"
              aria-label="Filter by method"
            >
              <option value="">All methods</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Other</option>
            </Select>
          </div>

          {payments.data && payments.data.rows.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-xl border border-brand-200 bg-brand-50 p-3.5">
                <p className="text-xs text-brand-700">Total (this page)</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-brand-900">
                  {formatMoneyWhole(collected)}
                </p>
              </div>
              {(['cash', 'upi', 'card', 'bank_transfer', 'other'] as const).map((m) => (
                <div key={m} className="rounded-xl border border-gray-200 bg-white p-3.5">
                  <p className="text-xs text-gray-500 capitalize">{m.replace('_', ' ')}</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                    {formatMoneyWhole(byMethod[m] ?? 0)}
                  </p>
                </div>
              ))}
            </div>
          )}

          <Card>
            {payments.isPending ? (
              <LoadingState />
            ) : payments.isError ? (
              <ErrorState message={friendlyError(payments.error)} onRetry={() => void payments.refetch()} />
            ) : payments.data.rows.length === 0 ? (
              <EmptyState
                title="No payments in this period"
                hint="Record payments from a bill."
                icon={<CreditCard className="h-10 w-10" />}
              />
            ) : (
              <>
                <Table>
                  <THead>
                    <TR>
                      <TH>Receipt</TH>
                      <TH>Customer</TH>
                      <TH className="hidden md:table-cell">Invoice</TH>
                      <TH>Method</TH>
                      <TH className="hidden lg:table-cell">When</TH>
                      <THNum>Amount</THNum>
                    </TR>
                  </THead>
                  <TBody>
                    {payments.data.rows.map((p) => (
                      <TR
                        key={p.id}
                        onClick={() => p.invoice_id && navigate(`/billing/${p.invoice_id}`)}
                      >
                        <TD>
                          <p className="font-medium text-gray-900">{p.payment_code}</p>
                          {p.entry_type !== 'payment' && (
                            <Badge tone={p.direction < 0 ? 'red' : 'gray'}>{p.entry_type}</Badge>
                          )}
                        </TD>
                        <TD>{p.customers?.full_name ?? '—'}</TD>
                        <TD className="hidden text-gray-600 md:table-cell">
                          {p.invoices?.invoice_no ?? '—'}
                        </TD>
                        <TD className="text-gray-600 capitalize">{p.method.replace('_', ' ')}</TD>
                        <TD className="hidden whitespace-nowrap text-gray-500 lg:table-cell">
                          {formatDateTime(p.paid_at)}
                        </TD>
                        <TDNum className={p.direction < 0 ? 'font-medium text-red-600' : 'font-medium'}>
                          {p.direction < 0 ? '−' : ''}
                          {formatMoney(p.amount)}
                        </TDNum>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={payments.data.total}
                  onPageChange={setPage}
                />
              </>
            )}
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader
            title="Outstanding balances"
            actions={
              outstanding.data && outstanding.data.length > 0 ? (
                <span className="text-sm font-semibold tabular-nums text-amber-700">
                  {formatMoney(outstandingTotal)} owed
                </span>
              ) : undefined
            }
          />
          {outstanding.isPending ? (
            <LoadingState />
          ) : outstanding.isError ? (
            <ErrorState
              message={friendlyError(outstanding.error)}
              onRetry={() => void outstanding.refetch()}
            />
          ) : outstanding.data.length === 0 ? (
            <EmptyState
              title="Nothing outstanding"
              hint="Every issued bill is fully paid."
              icon={<CreditCard className="h-10 w-10" />}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Customer</TH>
                  <TH className="hidden sm:table-cell">Invoice</TH>
                  <THNum className="hidden md:table-cell">Total</THNum>
                  <THNum className="hidden md:table-cell">Paid</THNum>
                  <THNum>Balance</THNum>
                  <TH>Age</TH>
                  <TH className="w-28" />
                </TR>
              </THead>
              <TBody>
                {outstanding.data.map((row) => {
                  const days = Number(row.days_outstanding)
                  const waNumber = row.whatsapp_number ?? row.mobile
                  const text = encodeURIComponent(
                    `Hello ${row.full_name}, your pending balance for invoice ${row.invoice_no} at Perfect Optical Vision is ₹${Number(row.balance).toFixed(2)}. Kindly clear it at your convenience. Thank you.`,
                  )
                  return (
                    <TR key={row.invoice_id}>
                      <TD>
                        <button
                          onClick={() => navigate(`/customers/${row.customer_id}`)}
                          className="font-medium text-brand-700 hover:text-brand-800"
                        >
                          {row.full_name}
                        </button>
                        <p className="text-xs tabular-nums text-gray-500">
                          {formatMobile(row.mobile)}
                        </p>
                      </TD>
                      <TD className="hidden sm:table-cell">
                        <button
                          onClick={() => navigate(`/billing/${row.invoice_id}`)}
                          className="text-gray-700 hover:text-gray-900"
                        >
                          {row.invoice_no}
                        </button>
                        <p className="text-xs text-gray-500">{formatDate(row.invoice_date)}</p>
                      </TD>
                      <TDNum className="hidden text-gray-600 md:table-cell">
                        {formatMoney(row.grand_total)}
                      </TDNum>
                      <TDNum className="hidden text-gray-600 md:table-cell">
                        {formatMoney(row.amount_paid)}
                      </TDNum>
                      <TDNum className="font-semibold text-amber-700">
                        {formatMoney(row.balance)}
                      </TDNum>
                      <TD>
                        {days > 30 ? (
                          <Badge tone="red">
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            {days}d
                          </Badge>
                        ) : days > 7 ? (
                          <Badge tone="amber">{days}d</Badge>
                        ) : (
                          <span className="text-sm tabular-nums text-gray-500">{days}d</span>
                        )}
                      </TD>
                      <TD>
                        <a href={`https://wa.me/91${waNumber}?text=${text}`} target="_blank" rel="noreferrer">
                          <Button variant="outline" size="sm">
                            <MessageCircle className="h-4 w-4" />
                            Remind
                          </Button>
                        </a>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </Card>
      )}
    </>
  )
}
