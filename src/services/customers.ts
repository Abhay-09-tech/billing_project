import { supabase } from '@/lib/supabase'
import type {
  CustomerAddressRow,
  CustomerRow,
  CustomerSearchHit,
  InvoiceRow,
  OrderRow,
  PaymentRow,
  PrescriptionRow,
  WhatsAppMessageRow,
} from '@/types/database'

export interface CustomerListParams {
  search?: string
  page: number
  pageSize: number
}

export async function listCustomers({ search, page, pageSize }: CustomerListParams) {
  let query = supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (search && search.trim().length >= 2) {
    const term = search.trim()
    query = query.or(
      `full_name.ilike.%${term}%,mobile.like.%${term}%,customer_code.ilike.%${term}%,whatsapp_number.like.%${term}%`,
    )
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0 }
}

/** Global search across name/mobile/code/invoice/order (brief §8). */
export async function searchCustomers(query: string, limit = 20): Promise<CustomerSearchHit[]> {
  if (query.trim().length < 2) return []
  const { data, error } = await supabase.rpc('rpc_search_customers', {
    p_query: query.trim(),
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []) as CustomerSearchHit[]
}

export async function findDuplicates(mobile: string, fullName?: string): Promise<CustomerRow[]> {
  const { data, error } = await supabase.rpc('rpc_find_customer_duplicates', {
    p_mobile: mobile,
    p_full_name: fullName ?? undefined,
  })
  if (error) throw error
  return (data ?? []) as CustomerRow[]
}

export interface NewCustomerInput {
  fullName: string
  mobile: string
  whatsappNumber?: string
  email?: string
  dob?: string
  gender?: string
  city?: string
  notes?: string
  addressLine?: string
  whatsappOptIn?: boolean
}

export async function createCustomer(input: NewCustomerInput): Promise<CustomerRow> {
  const { data, error } = await supabase.rpc('rpc_create_customer', {
    p_full_name: input.fullName,
    p_mobile: input.mobile,
    p_whatsapp_number: input.whatsappNumber || null,
    p_email: input.email || null,
    p_dob: input.dob || null,
    p_gender: input.gender || null,
    p_city: input.city || null,
    p_notes: input.notes || null,
    p_address_line: input.addressLine || null,
    p_whatsapp_opt_in: input.whatsappOptIn ?? false,
  })
  if (error) throw error
  return data as CustomerRow
}

export async function updateCustomer(id: string, patch: Partial<CustomerRow>): Promise<void> {
  const { error } = await supabase.from('customers').update(patch).eq('id', id)
  if (error) throw error
}

/** Everything the Customer 360 screen needs, fetched in parallel (brief §9). */
export interface Customer360 {
  customer: CustomerRow
  addresses: CustomerAddressRow[]
  prescriptions: PrescriptionRow[]
  orders: OrderRow[]
  invoices: InvoiceRow[]
  payments: PaymentRow[]
  whatsapp: WhatsAppMessageRow[]
  totals: { totalOrders: number; totalPurchases: number; totalPaid: number; outstanding: number }
}

export async function getCustomer360(id: string): Promise<Customer360> {
  const [customerRes, addressesRes, rxRes, ordersRes, invoicesRes, paymentsRes, waRes] =
    await Promise.all([
      supabase.from('customers').select('*').eq('id', id).single(),
      supabase.from('customer_addresses').select('*').eq('customer_id', id).order('is_primary', { ascending: false }),
      supabase
        .from('prescriptions')
        .select('*')
        .eq('customer_id', id)
        .order('rx_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('orders').select('*').eq('customer_id', id).order('created_at', { ascending: false }),
      supabase.from('invoices').select('*').eq('customer_id', id).order('created_at', { ascending: false }),
      supabase.from('payments').select('*').eq('customer_id', id).order('paid_at', { ascending: false }),
      supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

  for (const res of [customerRes, addressesRes, rxRes, ordersRes, invoicesRes, paymentsRes, waRes]) {
    if (res.error) throw res.error
  }

  const invoices = (invoicesRes.data ?? []) as InvoiceRow[]
  const payments = (paymentsRes.data ?? []) as PaymentRow[]
  const issued = invoices.filter((i) => i.status === 'issued')

  return {
    customer: customerRes.data as CustomerRow,
    addresses: (addressesRes.data ?? []) as CustomerAddressRow[],
    prescriptions: (rxRes.data ?? []) as PrescriptionRow[],
    orders: (ordersRes.data ?? []) as OrderRow[],
    invoices,
    payments,
    whatsapp: (waRes.data ?? []) as WhatsAppMessageRow[],
    totals: {
      totalOrders: (ordersRes.data ?? []).length,
      totalPurchases: issued.reduce((s, i) => s + Number(i.grand_total), 0),
      totalPaid: payments.reduce((s, p) => s + Number(p.amount) * p.direction, 0),
      outstanding: issued.reduce((s, i) => s + Math.max(0, Number(i.grand_total) - Number(i.amount_paid)), 0),
    },
  }
}
