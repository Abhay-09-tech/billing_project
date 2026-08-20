import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download } from 'lucide-react'
import { getSalesOverview } from '@/services/dashboard'
import { listPayments, listOutstanding } from '@/services/billing'
import { formatMoney, formatMoneyWhole } from '@/lib/money'
import { formatDate, formatMobile } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import { friendlyError } from '@/lib/errors'
import { RANGE_LABELS, resolveRange, type DateRange, type RangePreset } from '@/lib/date-ranges'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { Table, TBody, TD, TDNum, TH, THead, THNum, TR } from '@/components/ui/table'
import { Input, Select } from '@/components/ui/fields'
import { cn } from '@/lib/utils'

type Report = 'sales' | 'payments' | 'outstanding'

const REPORTS: Array<{ value: Report; label: string }> = [
  { value: 'sales', label: 'Sales' },
  { value: 'payments', label: 'Payment methods' },
  { value: 'outstanding', label: 'Outstanding' },
]

export default function ReportsPage() {
  const [report, setReport] = useState<Report>('sales')
  const [preset, setPreset] = useState<RangePreset>('last30')
  const [custom, setCustom] = useState<DateRange>({
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  })

  const range = useMemo(() => resolveRange(preset, custom), [preset, custom])

  return (
    <>
      <PageHeader title="Reports" subtitle="Every figure is queried live from the database" />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {REPORTS.map((r) => (
          <button
            key={r.value}
            onClick={() => setReport(r.value)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              report === r.value
                ? 'border-brand-300 bg-brand-50 text-brand-800'
                : 'border-cream-300 bg-white text-brand-700 hover:bg-cream-100',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {report !== 'outstanding' && (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <Select
            value={preset}
            onChange={(e) => setPreset(e.target.value as RangePreset)}
            className="w-full max-w-[12rem]"
            aria-label="Date range"
          >
            {(
              [
                'today',
                'yesterday',
                'last7',
                'last30',
                'this_month',
                'prev_month',
                'this_year',
                'custom',
              ] as RangePreset[]
            ).map((p) => (
              <option key={p} value={p}>
                {RANGE_LABELS[p]}
              </option>
            ))}
          </Select>
          {preset === 'custom' && (
            <>
              <Input
                type="date"
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="w-auto"
                aria-label="From date"
              />
              <Input
                type="date"
                value={custom.to}
                min={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="w-auto"
                aria-label="To date"
              />
            </>
          )}
        </div>
      )}

      {report === 'sales' && <SalesReport range={range} />}
      {report === 'payments' && <PaymentsReport range={range} />}
      {report === 'outstanding' && <OutstandingReport />}
    </>
  )
}

function SalesReport({ range }: { range: DateRange }) {
  const query = useQuery({
    queryKey: ['reports', 'sales', range.from, range.to],
    queryFn: () => getSalesOverview(range.from, range.to),
  })

  if (query.isPending) return <Card><LoadingState /></Card>
  if (query.isError)
    return (
      <Card>
        <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
      </Card>
    )

  const rows = query.data
  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + Number(r.orders_count),
      invoices: acc.invoices + Number(r.invoices_count),
      gross: acc.gross + Number(r.gross_sales),
      discounts: acc.discounts + Number(r.discounts),
      gst: acc.gst + Number(r.gst),
      collected: acc.collected + Number(r.collected),
    }),
    { orders: 0, invoices: 0, gross: 0, discounts: 0, gst: 0, collected: 0 },
  )

  const avgOrder = totals.invoices > 0 ? totals.gross / totals.invoices : 0

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Orders" value={totals.orders} />
        <Stat label="Bills" value={totals.invoices} />
        <Stat label="Sales" value={formatMoneyWhole(totals.gross)} />
        <Stat label="Average bill" value={formatMoneyWhole(avgOrder)} />
        <Stat label="GST" value={formatMoneyWhole(totals.gst)} />
        <Stat label="Collected" value={formatMoneyWhole(totals.collected)} />
      </div>

      <Card>
        <CardHeader
          title="Daily sales"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `sales-${range.from}-to-${range.to}`,
                  ['Date', 'Orders', 'Bills', 'Sales', 'Discounts', 'GST', 'Collected'],
                  rows.map((r) => [
                    r.day,
                    r.orders_count,
                    r.invoices_count,
                    r.gross_sales,
                    r.discounts,
                    r.gst,
                    r.collected,
                  ]),
                )
              }
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="No data for this period" icon={<BarChart3 className="h-10 w-10" />} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <THNum>Orders</THNum>
                <THNum>Bills</THNum>
                <THNum>Sales</THNum>
                <THNum className="hidden sm:table-cell">Discounts</THNum>
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
                  <TDNum className="hidden text-brand-600 sm:table-cell">
                    {formatMoney(r.discounts)}
                  </TDNum>
                  <TDNum className="hidden text-brand-600 sm:table-cell">{formatMoney(r.gst)}</TDNum>
                  <TDNum>{formatMoney(r.collected)}</TDNum>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  )
}

function PaymentsReport({ range }: { range: DateRange }) {
  const query = useQuery({
    queryKey: ['reports', 'payments', range.from, range.to],
    queryFn: () => listPayments({ from: range.from, to: range.to, page: 0, pageSize: 1000 }),
  })

  if (query.isPending) return <Card><LoadingState /></Card>
  if (query.isError)
    return (
      <Card>
        <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
      </Card>
    )

  const byMethod = query.data.rows.reduce<Record<string, { count: number; total: number }>>(
    (acc, p) => {
      const entry = acc[p.method] ?? { count: 0, total: 0 }
      entry.count += 1
      entry.total += Number(p.amount) * p.direction
      acc[p.method] = entry
      return acc
    },
    {},
  )
  const total = Object.values(byMethod).reduce((s, m) => s + m.total, 0)

  return (
    <Card>
      <CardHeader
        title="Collections by method"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(
                `payments-${range.from}-to-${range.to}`,
                ['Method', 'Count', 'Total'],
                Object.entries(byMethod).map(([m, v]) => [m, v.count, v.total]),
              )
            }
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
        }
      />
      {query.data.rows.length === 0 ? (
        <EmptyState title="No payments in this period" icon={<BarChart3 className="h-10 w-10" />} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Method</TH>
              <THNum>Payments</THNum>
              <THNum>Total</THNum>
              <THNum className="hidden sm:table-cell">Share</THNum>
            </TR>
          </THead>
          <TBody>
            {Object.entries(byMethod)
              .sort((a, b) => b[1].total - a[1].total)
              .map(([m, v]) => (
                <TR key={m}>
                  <TD className="capitalize">{m.replace('_', ' ')}</TD>
                  <TDNum>{v.count}</TDNum>
                  <TDNum className="font-medium">{formatMoney(v.total)}</TDNum>
                  <TDNum className="hidden text-brand-600 sm:table-cell">
                    {total > 0 ? `${Math.round((v.total / total) * 100)}%` : '—'}
                  </TDNum>
                </TR>
              ))}
            <TR>
              <TD className="font-semibold">Total</TD>
              <TDNum className="font-semibold">{query.data.rows.length}</TDNum>
              <TDNum className="font-semibold">{formatMoney(total)}</TDNum>
              <TDNum className="hidden sm:table-cell" />
            </TR>
          </TBody>
        </Table>
      )}
    </Card>
  )
}

function OutstandingReport() {
  const query = useQuery({ queryKey: ['reports', 'outstanding'], queryFn: listOutstanding })

  if (query.isPending) return <Card><LoadingState /></Card>
  if (query.isError)
    return (
      <Card>
        <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
      </Card>
    )

  const rows = query.data
  const buckets = { current: 0, d8: 0, d31: 0, d61: 0 }
  for (const r of rows) {
    const d = Number(r.days_outstanding)
    const b = Number(r.balance)
    if (d <= 7) buckets.current += b
    else if (d <= 30) buckets.d8 += b
    else if (d <= 60) buckets.d31 += b
    else buckets.d61 += b
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="0–7 days" value={formatMoneyWhole(buckets.current)} />
        <Stat label="8–30 days" value={formatMoneyWhole(buckets.d8)} />
        <Stat label="31–60 days" value={formatMoneyWhole(buckets.d31)} />
        <Stat label="Over 60 days" value={formatMoneyWhole(buckets.d61)} tone="red" />
      </div>

      <Card>
        <CardHeader
          title="Outstanding by invoice"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `outstanding-${new Date().toISOString().slice(0, 10)}`,
                  ['Customer', 'Mobile', 'Invoice', 'Date', 'Total', 'Paid', 'Balance', 'Days'],
                  rows.map((r) => [
                    r.full_name,
                    r.mobile,
                    r.invoice_no,
                    r.invoice_date,
                    r.grand_total,
                    r.amount_paid,
                    r.balance,
                    r.days_outstanding,
                  ]),
                )
              }
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="Nothing outstanding" icon={<BarChart3 className="h-10 w-10" />} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Customer</TH>
                <TH className="hidden sm:table-cell">Invoice</TH>
                <THNum className="hidden md:table-cell">Total</THNum>
                <THNum>Balance</THNum>
                <THNum>Days</THNum>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.invoice_id}>
                  <TD>
                    <p className="font-medium text-brand-900">{r.full_name}</p>
                    <p className="text-xs tabular-nums text-brand-600">{formatMobile(r.mobile)}</p>
                  </TD>
                  <TD className="hidden text-brand-700 sm:table-cell">{r.invoice_no}</TD>
                  <TDNum className="hidden text-brand-700 md:table-cell">
                    {formatMoney(r.grand_total)}
                  </TDNum>
                  <TDNum className="font-semibold text-warning-700">{formatMoney(r.balance)}</TDNum>
                  <TDNum
                    className={Number(r.days_outstanding) > 30 ? 'font-medium text-error-600' : ''}
                  >
                    {r.days_outstanding}
                  </TDNum>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'red'
}) {
  return (
    <div className="rounded-xl border border-cream-300 bg-white p-3.5">
      <p className="text-xs text-brand-600">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-lg font-semibold tabular-nums sm:text-xl',
          tone === 'red' ? 'text-error-700' : 'text-brand-900',
        )}
      >
        {value}
      </p>
    </div>
  )
}
