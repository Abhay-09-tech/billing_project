import { supabase } from '@/lib/supabase'
import type {
  BrandRow,
  InventoryTransactionRow,
  LowStockRow,
  ProductCategoryRow,
  ProductRow,
  ProductStockRow,
  SupplierRow,
} from '@/types/database'

export type ProductWithStock = ProductRow & {
  product_categories: Pick<ProductCategoryRow, 'id' | 'name' | 'code' | 'kind'> | null
  brands: Pick<BrandRow, 'id' | 'name'> | null
  product_stock: Pick<ProductStockRow, 'qty_on_hand' | 'qty_reserved'>[]
}

export interface ProductListParams {
  search?: string
  categoryId?: string
  activeOnly?: boolean
  page: number
  pageSize: number
}

export async function listProducts({
  search,
  categoryId,
  activeOnly = true,
  page,
  pageSize,
}: ProductListParams) {
  let query = supabase
    .from('products')
    .select(
      '*, product_categories(id, name, code, kind), brands(id, name), product_stock(qty_on_hand, qty_reserved)',
      { count: 'exact' },
    )
    .is('deleted_at', null)
    .order('name')
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (activeOnly) query = query.eq('is_active', true)
  if (categoryId) query = query.eq('category_id', categoryId)
  if (search && search.trim().length >= 2) {
    const term = search.trim()
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,model.ilike.%${term}%,barcode.ilike.%${term}%`)
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as ProductWithStock[], total: count ?? 0 }
}

export async function getCategories(): Promise<ProductCategoryRow[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as ProductCategoryRow[]
}

export async function getBrands(): Promise<BrandRow[]> {
  const { data, error } = await supabase.from('brands').select('*').eq('is_active', true).order('name')
  if (error) throw error
  return (data ?? []) as BrandRow[]
}

export async function getSuppliers(): Promise<SupplierRow[]> {
  const { data, error } = await supabase.from('suppliers').select('*').eq('is_active', true).order('name')
  if (error) throw error
  return (data ?? []) as SupplierRow[]
}

export async function nextSku(): Promise<string> {
  const { data, error } = await supabase.rpc('rpc_next_sku')
  if (error) throw error
  return data as string
}

export async function createProduct(
  input: Omit<Partial<ProductRow>, 'id' | 'created_at' | 'updated_at'> & {
    name: string
    sku: string
    category_id: string
    selling_price: number
    gst_rate_pct: number
  },
): Promise<ProductRow> {
  const { data, error } = await supabase.from('products').insert(input).select('*').single()
  if (error) throw error
  return data as ProductRow
}

export async function updateProduct(id: string, patch: Partial<ProductRow>): Promise<void> {
  const { error } = await supabase.from('products').update(patch).eq('id', id)
  if (error) throw error
}

// ── Inventory ───────────────────────────────────────────────────────────────

export async function adjustStock(params: {
  productId: string
  qtyDelta: number
  reason: 'purchase_inward' | 'adjustment' | 'damage' | 'opening_stock'
  note?: string
  unitCost?: number
}): Promise<InventoryTransactionRow> {
  const { data, error } = await supabase.rpc('rpc_adjust_stock', {
    p_product_id: params.productId,
    p_qty_delta: params.qtyDelta,
    p_reason: params.reason,
    p_note: params.note ?? null,
    p_unit_cost: params.unitCost ?? null,
  })
  if (error) throw error
  return data as InventoryTransactionRow
}

export type StockMovement = InventoryTransactionRow & {
  products: Pick<ProductRow, 'id' | 'name' | 'sku'> | null
}

export async function listStockMovements(params: {
  productId?: string
  page: number
  pageSize: number
}) {
  let query = supabase
    .from('inventory_transactions')
    .select('*, products(id, name, sku)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(params.page * params.pageSize, (params.page + 1) * params.pageSize - 1)

  if (params.productId) query = query.eq('product_id', params.productId)

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as StockMovement[], total: count ?? 0 }
}

export async function listLowStock(): Promise<LowStockRow[]> {
  const { data, error } = await supabase.from('v_low_stock').select('*').order('qty_on_hand')
  if (error) throw error
  return (data ?? []) as LowStockRow[]
}
