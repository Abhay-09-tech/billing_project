import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Plus, Warehouse } from 'lucide-react'
import { listLowStock, listProducts, listStockMovements } from '@/services/products'
import { formatMoney } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { Pagination } from '@/components/ui/pagination'
import { Table, TBody, TD, TDNum, TH, THead, THNum, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { InventoryReason } from '@/types/database'
import { StockAdjustDialog } from './StockAdjustDialog'

const PAGE_SIZE = 25

const REASON_LABELS: Record<InventoryReason, string> = {
  opening_stock: 'Opening stock',
  purchase_inward: 'Stock received',
  sale: 'Sold',
  sale_return: 'Returned',
  adjustment: 'Correction',
  damage: 'Damaged',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  lab_consumption: 'Used in lab',
}

type Tab = 'levels' | 'movements'

export default function InventoryPage() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(searchParams.get('filter') === 'low' ? 'levels' : 'levels')
  const [page, setPage] = useState(0)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const lowOnly = searchParams.get('filter') === 'low'

  const setLowOnly = (on: boolean) => {
    const next = new URLSearchParams(searchParams)
    if (on) next.set('filter', 'low')
    else next.delete('filter')
    setSearchParams(next, { replace: true })
  }

  const stock = useQuery({
    queryKey: ['inventory', 'levels', page],
    queryFn: () => listProducts({ page, pageSize: PAGE_SIZE }),
    enabled: tab === 'levels',
  })

  const lowStock = useQuery({ queryKey: ['inventory', 'low'], queryFn: listLowStock })

  const movements = useQuery({
    queryKey: ['inventory', 'movements', page],
    queryFn: () => listStockMovements({ page, pageSize: PAGE_SIZE }),
    enabled: tab === 'movements',
  })

  const trackedRows = (stock.data?.rows ?? []).filter((p) => p.is_stock_tracked)
  const visibleRows = lowOnly
    ? trackedRows.filter(
        (p) => Number(p.product_stock?.[0]?.qty_on_hand ?? 0) <= Number(p.min_stock_level),
      )
    : trackedRows

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Stock levels and the full history behind them"
        actions={
          can(PERMS.inventoryAdjust) && (
            <Button onClick={() => setAdjustOpen(true)}>
              <Plus className="h-4 w-4" />
              Update stock
            </Button>
          )
        }
      />

      {lowStock.data && lowStock.data.length > 0 && !lowOnly && (
        <button
          onClick={() => setLowOnly(true)}
          className="mb-4 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-sm text-amber-800 sm:w-auto"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {lowStock.data.length} product{lowStock.data.length === 1 ? '' : 's'} at or below the
          low-stock level — tap to see them
        </button>
      )}

      <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 sm:inline-flex">
        {(
          [
            ['levels', 'Stock levels'],
            ['movements', 'History'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => {
              setTab(value)
              setPage(0)
            }}
            className={cn(
              'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors sm:flex-none',
              tab === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'levels' ? (
        <Card>
          <CardHeader
            title={lowOnly ? 'Low stock only' : 'Stock levels'}
            actions={
              lowOnly && (
                <Button variant="ghost" size="sm" onClick={() => setLowOnly(false)}>
                  Show all
                </Button>
              )
            }
          />
          {stock.isPending ? (
            <LoadingState />
          ) : stock.isError ? (
            <ErrorState message={friendlyError(stock.error)} onRetry={() => void stock.refetch()} />
          ) : visibleRows.length === 0 ? (
            <EmptyState
              title={lowOnly ? 'Nothing is low on stock' : 'No stocked products yet'}
              hint={
                lowOnly
                  ? 'Every tracked product is above its minimum level.'
                  : 'Add products with "Track stock" switched on to manage inventory here.'
              }
              icon={<Warehouse className="h-10 w-10" />}
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH className="hidden md:table-cell">Category</TH>
                    <THNum>In stock</THNum>
                    <THNum className="hidden sm:table-cell">Min</THNum>
                    <THNum className="hidden lg:table-cell">Stock value</THNum>
                    <TH className="w-24" />
                  </TR>
                </THead>
                <TBody>
                  {visibleRows.map((p) => {
                    const qty = Number(p.product_stock?.[0]?.qty_on_hand ?? 0)
                    const low = qty <= Number(p.min_stock_level)
                    const cost = p.purchase_price != null ? Number(p.purchase_price) * qty : null
                    return (
                      <TR key={p.id}>
                        <TD>
                          <p className="font-medium text-gray-900">{p.name}</p>
                          <p className="text-xs text-gray-500">{p.sku}</p>
                        </TD>
                        <TD className="hidden text-gray-600 md:table-cell">
                          {p.product_categories?.name ?? '—'}
                        </TD>
                        <TDNum>
                          {qty <= 0 ? (
                            <Badge tone="red">Out of stock</Badge>
                          ) : low ? (
                            <Badge tone="amber">{qty}</Badge>
                          ) : (
                            <span className="font-medium tabular-nums">{qty}</span>
                          )}
                        </TDNum>
                        <TDNum className="hidden text-gray-500 sm:table-cell">
                          {p.min_stock_level}
                        </TDNum>
                        <TDNum className="hidden text-gray-600 lg:table-cell">
                          {cost != null ? formatMoney(cost) : '—'}
                        </TDNum>
                        <TD>
                          {can(PERMS.inventoryAdjust) && (
                            <Button variant="ghost" size="sm" onClick={() => setAdjustOpen(true)}>
                              Update
                            </Button>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
              {!lowOnly && (
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={stock.data.total}
                  onPageChange={setPage}
                />
              )}
            </>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader title="Stock history" />
          {movements.isPending ? (
            <LoadingState />
          ) : movements.isError ? (
            <ErrorState message={friendlyError(movements.error)} onRetry={() => void movements.refetch()} />
          ) : movements.data.rows.length === 0 ? (
            <EmptyState
              title="No stock movements yet"
              hint="Receiving stock, selling and corrections all appear here."
              icon={<Warehouse className="h-10 w-10" />}
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Product</TH>
                    <TH>Reason</TH>
                    <THNum>Change</THNum>
                    <TH className="hidden lg:table-cell">Note</TH>
                  </TR>
                </THead>
                <TBody>
                  {movements.data.rows.map((m) => {
                    const delta = Number(m.qty_delta)
                    return (
                      <TR key={m.id}>
                        <TD className="whitespace-nowrap text-gray-500">
                          {formatDateTime(m.created_at)}
                        </TD>
                        <TD>
                          <p className="font-medium text-gray-900">{m.products?.name ?? '—'}</p>
                          <p className="text-xs text-gray-500">{m.products?.sku}</p>
                        </TD>
                        <TD className="text-gray-600">{REASON_LABELS[m.reason] ?? m.reason}</TD>
                        <TDNum>
                          <span
                            className={cn(
                              'inline-flex items-center gap-0.5 font-medium tabular-nums',
                              delta > 0 ? 'text-green-700' : 'text-red-700',
                            )}
                          >
                            {delta > 0 ? (
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDownRight className="h-3.5 w-3.5" />
                            )}
                            {delta > 0 ? '+' : ''}
                            {delta}
                          </span>
                        </TDNum>
                        <TD className="hidden max-w-xs truncate text-gray-500 lg:table-cell">
                          {m.note ?? '—'}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={movements.data.total}
                onPageChange={setPage}
              />
            </>
          )}
        </Card>
      )}

      <StockAdjustDialog open={adjustOpen} onOpenChange={setAdjustOpen} />
    </>
  )
}
