import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { listInvoices } from '@/services/billing'
import type { InvoiceStatus } from '@/types/database'
import { formatMoney } from '@/lib/money'
import { formatDate, formatMobile } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { SearchInput } from '@/components/ui/search-input'
import { Pagination } from '@/components/ui/pagination'
import { Table, TBody, TD, TDNum, TH, THead, THNum, TR } from '@/components/ui/table'
import { InvoiceStatusBadge, PaymentStatusBadge } from '@/components/ui/badge'
import { Select } from '@/components/ui/fields'
import { RANGE_LABELS, resolveRange, type RangePreset } from '@/lib/date-ranges'

const PAGE_SIZE = 25

export default function BillingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<InvoiceStatus | ''>('')
  const [preset, setPreset] = useState<RangePreset>('last30')
  const [page, setPage] = useState(0)

  const range = resolveRange(preset)

  const query = useQuery({
    queryKey: ['invoices', 'list', search, status, range.from, range.to, page],
    queryFn: () =>
      listInvoices({
        search,
        status: status || undefined,
        from: range.from,
        to: range.to,
        page,
        pageSize: PAGE_SIZE,
      }),
  })

  const totals = (query.data?.rows ?? []).reduce(
    (acc, i) => {
      if (i.status !== 'issued') return acc
      return {
        billed: acc.billed + Number(i.grand_total),
        collected: acc.collected + Number(i.amount_paid),
      }
    },
    { billed: 0, collected: 0 },
  )

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Bills are created from an order — open the order and choose “Create bill”."
      />

      {searchParams.get('new') === '1' && (
        <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm text-brand-900">
          To raise a bill, open the customer's order and press <strong>Create bill</strong>. That
          copies the items, prescription and any advance across automatically.
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput
          value={search}
          onValueChange={(v) => {
            setSearch(v)
            setPage(0)
          }}
          placeholder="Search invoice number…"
          className="w-full max-w-sm"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as InvoiceStatus | '')
            setPage(0)
          }}
          className="w-full max-w-[10rem]"
          aria-label="Filter by status"
        >
          <option value="">All bills</option>
          <option value="issued">Issued</option>
          <option value="draft">Drafts</option>
          <option value="cancelled">Cancelled</option>
        </Select>
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
      </div>

      {query.data && query.data.rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
          <div className="rounded-xl border border-gray-200 bg-white p-3.5">
            <p className="text-xs text-gray-500">Billed (this page)</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
              {formatMoney(totals.billed)}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-3.5">
            <p className="text-xs text-gray-500">Collected</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
              {formatMoney(totals.collected)}
            </p>
          </div>
        </div>
      )}

      <Card>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.rows.length === 0 ? (
          <EmptyState
            title="No bills in this period"
            hint="Change the date range, or create a bill from an order."
            icon={<Receipt className="h-10 w-10" />}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Customer</TH>
                  <TH className="hidden md:table-cell">Mobile</TH>
                  <THNum>Total</THNum>
                  <THNum className="hidden sm:table-cell">Balance</THNum>
                  <TH>Payment</TH>
                </TR>
              </THead>
              <TBody>
                {query.data.rows.map((inv) => {
                  const balance = Number(inv.grand_total) - Number(inv.amount_paid)
                  return (
                    <TR key={inv.id} onClick={() => navigate(`/billing/${inv.id}`)}>
                      <TD>
                        <p className="font-medium text-gray-900">
                          {inv.invoice_no ?? 'Draft'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {inv.invoice_date ? formatDate(inv.invoice_date) : formatDate(inv.created_at)}
                        </p>
                      </TD>
                      <TD>{inv.customers?.full_name ?? '—'}</TD>
                      <TD className="hidden tabular-nums text-gray-500 md:table-cell">
                        {formatMobile(inv.customers?.mobile)}
                      </TD>
                      <TDNum>{formatMoney(inv.grand_total)}</TDNum>
                      <TDNum
                        className={`hidden sm:table-cell ${balance > 0 && inv.status === 'issued' ? 'text-amber-700' : 'text-gray-400'}`}
                      >
                        {inv.status === 'issued' && balance > 0 ? formatMoney(balance) : '—'}
                      </TDNum>
                      <TD>
                        {inv.status === 'issued' ? (
                          <PaymentStatusBadge
                            grandTotal={Number(inv.grand_total)}
                            amountPaid={Number(inv.amount_paid)}
                          />
                        ) : (
                          <InvoiceStatusBadge status={inv.status} />
                        )}
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
    </>
  )
}
