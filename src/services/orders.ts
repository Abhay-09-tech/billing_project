import { supabase } from '@/lib/supabase'
import type {
  CustomerRow,
  LabOrderRow,
  LabOrderStatus,
  LabVendorRow,
  NewOrderItemInput,
  OrderItemRow,
  OrderRow,
  OrderStatusCode,
  OrderStatusHistoryRow,
  OrderStatusRow,
  PrescriptionRow,
} from '@/types/database'

export type OrderWithCustomer = OrderRow & {
  customers: Pick<CustomerRow, 'id' | 'full_name' | 'mobile' | 'customer_code' | 'whatsapp_number'> | null
}

export interface OrderListParams {
  search?: string
  status?: OrderStatusCode | 'open'
  from?: string
  to?: string
  page: number
  pageSize: number
}

export async function listOrders({ search, status, from, to, page, pageSize }: OrderListParams) {
  let query = supabase
    .from('orders')
    .select('*, customers(id, full_name, mobile, customer_code, whatsapp_number)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status === 'open') {
    query = query.not('status', 'in', '("delivered","completed","cancelled")')
  } else if (status) {
    query = query.eq('status', status)
  }
  if (from) query = query.gte('created_at', `${from}T00:00:00`)
  if (to) query = query.lte('created_at', `${to}T23:59:59.999`)
  if (search && search.trim().length >= 2) query = query.ilike('order_code', `%${search.trim()}%`)

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as OrderWithCustomer[], total: count ?? 0 }
}

/** Today's order queue for the dashboard (brief §6). */
export async function listTodayQueue(): Promise<OrderWithCustomer[]> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('orders')
    .select('*, customers(id, full_name, mobile, customer_code, whatsapp_number)')
    .gte('created_at', `${today}T00:00:00`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as OrderWithCustomer[]
}

export interface OrderDetail {
  order: OrderWithCustomer
  items: OrderItemRow[]
  history: OrderStatusHistoryRow[]
  prescription: PrescriptionRow | null
  labOrders: LabOrderRow[]
}

export async function getOrderDetail(id: string): Promise<OrderDetail> {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, customers(id, full_name, mobile, customer_code, whatsapp_number)')
    .eq('id', id)
    .single()
  if (error) throw error
  const typedOrder = order as OrderWithCustomer

  const [itemsRes, historyRes, rxRes, labRes] = await Promise.all([
    supabase.from('order_items').select('*').eq('order_id', id).order('created_at'),
    supabase.from('order_status_history').select('*').eq('order_id', id).order('changed_at', { ascending: false }),
    typedOrder.prescription_id
      ? supabase.from('prescriptions').select('*').eq('id', typedOrder.prescription_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('lab_orders').select('*').eq('order_id', id).order('created_at', { ascending: false }),
  ])
  for (const res of [itemsRes, historyRes, rxRes, labRes]) {
    if (res.error) throw res.error
  }

  return {
    order: typedOrder,
    items: (itemsRes.data ?? []) as OrderItemRow[],
    history: (historyRes.data ?? []) as OrderStatusHistoryRow[],
    prescription: (rxRes.data ?? null) as PrescriptionRow | null,
    labOrders: (labRes.data ?? []) as LabOrderRow[],
  }
}

export async function getOrderStatuses(): Promise<OrderStatusRow[]> {
  const { data, error } = await supabase
    .from('order_statuses')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as OrderStatusRow[]
}

export interface CreateOrderInput {
  customerId: string
  items: NewOrderItemInput[]
  prescriptionId?: string | null
  expectedDeliveryDate?: string | null
  notes?: string | null
  advanceAmount?: number
  advanceMethod?: string
  /**
   * Generated once per form submission. A double click, a retry or a second
   * tab sends the same id and the database returns the original order instead
   * of creating a second one (brief §15).
   */
  requestId?: string
}

export async function createOrder(input: CreateOrderInput): Promise<OrderRow> {
  const { data, error } = await supabase.rpc('rpc_create_order', {
    p_customer_id: input.customerId,
    p_items: input.items,
    p_prescription_id: input.prescriptionId ?? null,
    p_expected_delivery_date: input.expectedDeliveryDate ?? null,
    p_notes: input.notes ?? null,
    p_advance_amount: input.advanceAmount ?? 0,
    p_advance_method: input.advanceMethod ?? 'cash',
    p_request_id: input.requestId ?? null,
  })
  if (error) throw error
  return data as OrderRow
}

export async function setOrderStatus(
  orderId: string,
  newStatus: OrderStatusCode,
  note?: string,
): Promise<OrderRow> {
  const { data, error } = await supabase.rpc('rpc_set_order_status', {
    p_order_id: orderId,
    p_new_status: newStatus,
    p_note: note ?? undefined,
  })
  if (error) throw error
  return data as OrderRow
}

// ── Lab ─────────────────────────────────────────────────────────────────────

export type LabOrderWithContext = LabOrderRow & {
  orders: (Pick<OrderRow, 'id' | 'order_code' | 'expected_delivery_date'> & {
    customers: Pick<CustomerRow, 'id' | 'full_name' | 'mobile'> | null
  }) | null
  lab_vendors: Pick<LabVendorRow, 'id' | 'name'> | null
}

export async function listLabOrders(params: {
  status?: LabOrderStatus
  page: number
  pageSize: number
}) {
  let query = supabase
    .from('lab_orders')
    .select(
      '*, orders(id, order_code, expected_delivery_date, customers(id, full_name, mobile)), lab_vendors(id, name)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(params.page * params.pageSize, (params.page + 1) * params.pageSize - 1)

  if (params.status) query = query.eq('status', params.status)

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as LabOrderWithContext[], total: count ?? 0 }
}

export async function getLabVendors(): Promise<LabVendorRow[]> {
  const { data, error } = await supabase.from('lab_vendors').select('*').eq('is_active', true).order('name')
  if (error) throw error
  return (data ?? []) as LabVendorRow[]
}

export async function createLabOrder(input: {
  order_id: string
  lab_vendor_id?: string | null
  lens_details?: string | null
  expected_return_date?: string | null
}): Promise<LabOrderRow> {
  const { data, error } = await supabase.from('lab_orders').insert(input).select('*').single()
  if (error) throw error
  return data as LabOrderRow
}

export async function updateLabOrder(id: string, patch: Partial<LabOrderRow>): Promise<void> {
  const { error } = await supabase.from('lab_orders').update(patch).eq('id', id)
  if (error) throw error
}
