import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Package, Pencil, Plus } from 'lucide-react'
import { getCategories, listProducts, type ProductWithStock } from '@/services/products'
import { formatMoney } from '@/lib/money'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { SearchInput } from '@/components/ui/search-input'
import { Pagination } from '@/components/ui/pagination'
import { Table, TBody, TD, TDNum, TH, THead, THNum, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/fields'
import { ProductDialog } from './ProductDialog'

const PAGE_SIZE = 25

export default function ProductsPage() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<ProductWithStock | null>(null)
  const dialogOpen = searchParams.get('new') === '1' || editing !== null

  const setDialogOpen = (open: boolean) => {
    const next = new URLSearchParams(searchParams)
    if (open) next.set('new', '1')
    else next.delete('new')
    setSearchParams(next, { replace: true })
    if (!open) setEditing(null)
  }

  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const query = useQuery({
    queryKey: ['products', 'list', search, categoryId, page],
    queryFn: () =>
      listProducts({ search, categoryId: categoryId || undefined, page, pageSize: PAGE_SIZE }),
  })

  return (
    <>
      <PageHeader
        title="Products"
        subtitle={query.data ? `${query.data.total} active` : undefined}
        actions={
          can(PERMS.productsCreate) && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New product
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
          placeholder="Search by name, SKU, model or barcode…"
          className="w-full max-w-sm"
        />
        <Select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value)
            setPage(0)
          }}
          className="w-full max-w-[12rem]"
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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
            title={search || categoryId ? 'No products match' : 'No products yet'}
            hint={
              search || categoryId
                ? 'Try a different search or category.'
                : 'Add your frames, lenses and accessories to start billing.'
            }
            icon={<Package className="h-10 w-10" />}
            action={
              !search &&
              !categoryId &&
              can(PERMS.productsCreate) && (
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New product
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH className="hidden md:table-cell">Category</TH>
                  <TH className="hidden lg:table-cell">Brand</TH>
                  <THNum>Price</THNum>
                  <THNum className="hidden sm:table-cell">GST</THNum>
                  <THNum>Stock</THNum>
                  {can(PERMS.productsManage) && <TH className="w-12" />}
                </TR>
              </THead>
              <TBody>
                {query.data.rows.map((p) => {
                  const qty = Number(p.product_stock?.[0]?.qty_on_hand ?? 0)
                  const low = p.is_stock_tracked && qty <= Number(p.min_stock_level)
                  return (
                    <TR key={p.id}>
                      <TD>
                        <p className="font-medium text-brand-900">{p.name}</p>
                        <p className="text-xs text-brand-600">
                          {p.sku}
                          {p.model ? ` · ${p.model}` : ''}
                          {p.color ? ` · ${p.color}` : ''}
                        </p>
                      </TD>
                      <TD className="hidden text-brand-700 md:table-cell">
                        {p.product_categories?.name ?? '—'}
                      </TD>
                      <TD className="hidden text-brand-700 lg:table-cell">{p.brands?.name ?? '—'}</TD>
                      <TDNum className="font-medium">{formatMoney(p.selling_price)}</TDNum>
                      <TDNum className="hidden text-brand-600 sm:table-cell">{p.gst_rate_pct}%</TDNum>
                      <TDNum>
                        {!p.is_stock_tracked ? (
                          <Badge tone="gray">Made to order</Badge>
                        ) : low ? (
                          <Badge tone="amber">{qty} low</Badge>
                        ) : (
                          <span className="tabular-nums">{qty}</span>
                        )}
                      </TDNum>
                      {can(PERMS.productsManage) && (
                        <TD>
                          <button
                            onClick={() => setEditing(p)}
                            className="rounded-lg p-2 text-brand-500 hover:bg-cream-200 hover:text-brand-800"
                            aria-label={`Edit ${p.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </TD>
                      )}
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

      <ProductDialog open={dialogOpen} onOpenChange={setDialogOpen} product={editing} />
    </>
  )
}
