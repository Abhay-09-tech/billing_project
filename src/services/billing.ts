import { supabase } from '@/lib/supabase'
import type {
  CustomerRow,
  InvoiceItemRow,
  InvoiceRow,
  InvoiceStatus,
  NewOrderItemInput,
  OutstandingRow,
  PaymentMethod,
  PaymentRow,
} from '@/types/database'

export type InvoiceWithCustomer = InvoiceRow & {
  customers: Pick<CustomerRow, 'id' | 'full_name' | 'mobile' | 'customer_code' | 'whatsapp_number'> | null
}

export interface InvoiceListParams {
  search?: string
  status?: InvoiceStatus
  from?: string
  to?: string
  unpaidOnly?: boolean
  page: number
  pageSize: number
}

export async function listInvoices({
  search,
  status,
  from,
  to,
  page,
  pageSize,
}: InvoiceListParams) {
  let query = supabase
    .from('invoices')
    .select('*, customers(id, full_name, mobile, customer_code, whatsapp_number)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status) query = query.eq('status', status)
  if (from) query = query.gte('invoice_date', from)
  if (to) query = query.lte('invoice_date', to)
  if (search && search.trim().length >= 2) query = query.ilike('invoice_no', `%${search.trim()}%`)

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as InvoiceWithCustomer[], total: count ?? 0 }
}

export interface InvoiceDetail {
  invoice: InvoiceWithCustomer
  items: InvoiceItemRow[]
  payments: PaymentRow[]
}

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail> {
  const [invoiceRes, itemsRes, paymentsRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('*, customers(id, full_name, mobile, customer_code, whatsapp_number)')
      .eq('id', id)
      .single(),
    supabase.from('invoice_items').select('*').eq('invoice_id', id).order('created_at'),
    supabase.from('payments').select('*').eq('invoice_id', id).order('paid_at', { ascending: false }),
  ])
  for (const res of [invoiceRes, itemsRes, paymentsRes]) {
    if (res.error) throw res.error
  }
  return {
    invoice: invoiceRes.data as InvoiceWithCustomer,
    items: (itemsRes.data ?? []) as InvoiceItemRow[],
    payments: (paymentsRes.data ?? []) as PaymentRow[],
  }
}

/** Draft from an existing order (the normal path). */
export async function createInvoiceFromOrder(customerId: string, orderId: string): Promise<InvoiceRow> {
  const { data, error } = await supabase.rpc('rpc_create_invoice', {
    p_customer_id: customerId,
    p_order_id: orderId,
    p_items: null,
  })
  if (error) throw error
  return data as InvoiceRow
}

/** Draft for a walk-in counter sale with no order behind it. */
export async function createCounterInvoice(
  customerId: string,
  items: NewOrderItemInput[],
): Promise<InvoiceRow> {
  const { data, error } = await supabase.rpc('rpc_create_invoice', {
    p_customer_id: customerId,
    p_order_id: null,
    p_items: items,
  })
  if (error) throw error
  return data as InvoiceRow
}

export async function issueInvoice(invoiceId: string, invoiceDate?: string): Promise<InvoiceRow> {
  const { data, error } = await supabase.rpc('rpc_issue_invoice', {
    p_invoice_id: invoiceId,
    p_invoice_date: invoiceDate ?? new Date().toISOString().slice(0, 10),
  })
  if (error) throw error
  return data as InvoiceRow
}

export async function cancelInvoice(invoiceId: string, reason: string): Promise<InvoiceRow> {
  const { data, error } = await supabase.rpc('rpc_cancel_invoice', {
    p_invoice_id: invoiceId,
    p_reason: reason,
  })
  if (error) throw error
  return data as InvoiceRow
}

// ── Payments ────────────────────────────────────────────────────────────────

export async function recordPayment(params: {
  invoiceId: string
  amount: number
  method: PaymentMethod
  referenceNo?: string
  notes?: string
  allowAdvance?: boolean
}): Promise<PaymentRow> {
  const { data, error } = await supabase.rpc('rpc_record_payment', {
    p_invoice_id: params.invoiceId,
    p_amount: params.amount,
    p_method: params.method,
    p_reference_no: params.referenceNo ?? null,
    p_notes: params.notes ?? null,
    p_allow_advance: params.allowAdvance ?? false,
  })
  if (error) throw error
  return data as PaymentRow
}

export async function refundPayment(params: {
  paymentId: string
  amount: number
  method: PaymentMethod
  reason: string
}): Promise<PaymentRow> {
  const { data, error } = await supabase.rpc('rpc_refund_payment', {
    p_payment_id: params.paymentId,
    p_amount: params.amount,
    p_method: params.method,
    p_reason: params.reason,
  })
  if (error) throw error
  return data as PaymentRow
}

export type PaymentWithContext = PaymentRow & {
  customers: Pick<CustomerRow, 'id' | 'full_name' | 'mobile'> | null
  invoices: Pick<InvoiceRow, 'id' | 'invoice_no'> | null
}

export async function listPayments(params: {
  from?: string
  to?: string
  method?: PaymentMethod
  page: number
  pageSize: number
}) {
  let query = supabase
    .from('payments')
    .select('*, customers(id, full_name, mobile), invoices(id, invoice_no)', { count: 'exact' })
    .order('paid_at', { ascending: false })
    .range(params.page * params.pageSize, (params.page + 1) * params.pageSize - 1)

  if (params.from) query = query.gte('paid_at', `${params.from}T00:00:00`)
  if (params.to) query = query.lte('paid_at', `${params.to}T23:59:59.999`)
  if (params.method) query = query.eq('method', params.method)

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as PaymentWithContext[], total: count ?? 0 }
}

export async function listOutstanding(): Promise<OutstandingRow[]> {
  const { data, error } = await supabase
    .from('v_outstanding')
    .select('*')
    .order('days_outstanding', { ascending: false })
  if (error) throw error
  return (data ?? []) as OutstandingRow[]
}
