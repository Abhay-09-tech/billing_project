/**
 * Database types, hand-maintained to mirror supabase/migrations.
 *
 * NOTE FOR MAINTAINERS: once you have the Supabase CLI + Docker available,
 * replace this file with the generated one (`npm run db:types`) â€” the shapes
 * below follow the generator's structure exactly so the swap is drop-in.
 * Until then, any migration that changes a table used by the app MUST update
 * the matching type here in the same commit.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// â”€â”€ Row shapes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type CustomerRow = {
  id: string
  customer_code: string
  full_name: string
  mobile: string
  whatsapp_number: string | null
  whatsapp_opt_in: boolean
  whatsapp_opt_in_at: string | null
  alt_phone: string | null
  email: string | null
  dob: string | null
  gender: 'male' | 'female' | 'other' | null
  city: string | null
  notes: string | null
  status: 'active' | 'inactive' | 'blocked'
  first_purchase_at: string | null
  last_visit_at: string | null
  metadata: Json
  branch_id: string
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type CustomerAddressRow = {
  id: string
  customer_id: string
  label: string
  address_line: string
  city: string | null
  state: string | null
  pincode: string | null
  is_primary: boolean
  created_at: string
  updated_at: string
}

export type RxType = 'distance' | 'near' | 'bifocal' | 'progressive' | 'contact_lens'

export type PrescriptionRow = {
  id: string
  customer_id: string
  rx_date: string
  rx_type: RxType
  prescribed_by: string | null
  remarks: string | null
  od_sph: number | null
  od_cyl: number | null
  od_axis: number | null
  od_add: number | null
  od_prism_h: number | null
  od_prism_h_base: 'in' | 'out' | null
  od_prism_v: number | null
  od_prism_v_base: 'up' | 'down' | null
  od_bc: number | null
  od_dia: number | null
  os_sph: number | null
  os_cyl: number | null
  os_axis: number | null
  os_add: number | null
  os_prism_h: number | null
  os_prism_h_base: 'in' | 'out' | null
  os_prism_v: number | null
  os_prism_v_base: 'up' | 'down' | null
  os_bc: number | null
  os_dia: number | null
  pd_right: number | null
  pd_left: number | null
  pd_binocular: number | null
  od_seg_ht: number | null
  os_seg_ht: number | null
  supersedes_id: string | null
  voided_at: string | null
  void_reason: string | null
  branch_id: string
  created_by: string | null
  created_at: string
}

export type PrescriptionFileRow = {
  id: string
  prescription_id: string
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number | null
  uploaded_by: string | null
  created_at: string
}

export type ProductCategoryRow = {
  id: string
  code: string
  name: string
  kind: 'stocked' | 'made_to_order' | 'service'
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type BrandRow = {
  id: string
  name: string
  is_active: boolean
  created_at: string
}

export type SupplierRow = {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  gstin: string | null
  address: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ProductRow = {
  id: string
  sku: string
  barcode: string | null
  name: string
  category_id: string
  brand_id: string | null
  supplier_id: string | null
  model: string | null
  size: string | null
  color: string | null
  purchase_price: number | null
  selling_price: number
  default_discount_pct: number
  gst_rate_pct: number
  hsn_code: string | null
  is_stock_tracked: boolean
  min_stock_level: number
  image_path: string | null
  lens_attributes: Json | null
  is_active: boolean
  branch_id: string
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type ProductStockRow = {
  product_id: string
  branch_id: string
  qty_on_hand: number
  qty_reserved: number
  updated_at: string
}

export type InventoryReason =
  | 'opening_stock'
  | 'purchase_inward'
  | 'sale'
  | 'sale_return'
  | 'adjustment'
  | 'damage'
  | 'transfer_in'
  | 'transfer_out'
  | 'lab_consumption'

export type InventoryTransactionRow = {
  id: number
  product_id: string
  branch_id: string
  qty_delta: number
  reason: InventoryReason
  ref_type: string | null
  ref_id: string | null
  unit_cost: number | null
  note: string | null
  created_by: string | null
  created_at: string
}

export type OrderStatusCode =
  | 'new'
  | 'prescription_received'
  | 'frame_selected'
  | 'lens_ordered'
  | 'in_lab'
  | 'quality_check'
  | 'ready'
  | 'customer_notified'
  | 'delivered'
  | 'completed'
  | 'cancelled'

export type OrderStatusRow = {
  code: OrderStatusCode
  label: string
  sort_order: number
  is_terminal: boolean
  is_cancelled: boolean
  allowed_next: OrderStatusCode[]
  wa_event_key: string | null
  is_active: boolean
}

export type OrderRow = {
  id: string
  order_code: string
  customer_id: string
  prescription_id: string | null
  status: OrderStatusCode
  expected_delivery_date: string | null
  delivered_at: string | null
  notes: string | null
  cancel_reason: string | null
  subtotal: number
  discount_total: number
  tax_total: number
  grand_total: number
  advance_amount: number
  invoice_id: string | null
  branch_id: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export type OrderItemKind = 'product' | 'lens' | 'service' | 'custom'

export type OrderItemRow = {
  id: string
  order_id: string
  item_kind: OrderItemKind
  product_id: string | null
  description: string
  lens_spec: Json | null
  qty: number
  unit_price: number
  discount_pct: number
  discount_amt: number
  gst_rate_pct: number
  line_total: number
  created_at: string
}

export type OrderStatusHistoryRow = {
  id: number
  order_id: string
  from_status: OrderStatusCode | null
  to_status: OrderStatusCode
  note: string | null
  changed_by: string | null
  changed_at: string
}

export type LabVendorRow = {
  id: string
  name: string
  contact: string | null
  phone: string | null
  email: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type LabOrderStatus = 'sent' | 'in_process' | 'received' | 'qc_pending' | 'qc_passed' | 'qc_failed'

export type LabOrderRow = {
  id: string
  order_id: string
  lab_vendor_id: string | null
  status: LabOrderStatus
  lens_details: string | null
  sent_at: string
  expected_return_date: string | null
  received_at: string | null
  qc_by: string | null
  qc_at: string | null
  qc_notes: string | null
  remake_of_id: string | null
  branch_id: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export type InvoiceStatus = 'draft' | 'issued' | 'cancelled'

export type InvoiceRow = {
  id: string
  invoice_no: string | null
  status: InvoiceStatus
  invoice_date: string | null
  customer_id: string
  order_id: string | null
  place_of_supply: string | null
  is_intra_state: boolean
  is_tax_inclusive: boolean
  subtotal: number
  discount_total: number
  taxable_total: number
  cgst_total: number
  sgst_total: number
  igst_total: number
  round_off: number
  grand_total: number
  amount_paid: number
  issued_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  pdf_path: string | null
  branch_id: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export type InvoiceItemRow = {
  id: string
  invoice_id: string
  order_item_id: string | null
  product_id: string | null
  description: string
  hsn_code: string | null
  qty: number
  unit_price: number
  discount_amt: number
  gst_rate_pct: number
  taxable_amt: number
  cgst_amt: number
  sgst_amt: number
  igst_amt: number
  line_total: number
  created_at: string
}

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'other'
export type PaymentEntryType = 'payment' | 'advance' | 'refund' | 'reversal' | 'write_off'

export type PaymentRow = {
  id: string
  payment_code: string
  entry_type: PaymentEntryType
  direction: 1 | -1
  invoice_id: string | null
  order_id: string | null
  customer_id: string
  amount: number
  method: PaymentMethod
  reference_no: string | null
  paid_at: string
  received_by: string | null
  notes: string | null
  reverses_payment_id: string | null
  branch_id: string
  created_at: string
}

export type ProfileRow = {
  id: string
  full_name: string
  phone: string | null
  role_id: string
  branch_id: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type RoleRow = {
  id: string
  code: string
  name: string
  description: string | null
  is_system: boolean
  created_at: string
  updated_at: string
}

export type SettingRow = {
  key: string
  value: Json
  is_secret: boolean
  updated_by: string | null
  updated_at: string
}

export type AuditLogRow = {
  id: number
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string
  before: Json | null
  after: Json | null
  metadata: Json | null
  created_at: string
}

export type WhatsAppMessageStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'cancelled'

export type WhatsAppTemplateRow = {
  id: string
  code: string
  name: string
  provider_template_name: string
  language: string
  category: 'utility' | 'marketing' | 'authentication'
  body_text: string
  variable_map: Json
  approval_status: 'draft' | 'submitted' | 'approved' | 'rejected'
  is_active: boolean
  created_at: string
  updated_at: string
}

export type WhatsAppAutomationRuleRow = {
  id: string
  event_key: string
  template_id: string
  delay_minutes: number
  conditions: Json
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export type WhatsAppMessageRow = {
  id: string
  idempotency_key: string
  customer_id: string | null
  to_msisdn: string
  template_id: string | null
  variables: Json
  rendered_body: string | null
  status: WhatsAppMessageStatus
  provider: string
  provider_message_id: string | null
  error_code: string | null
  error_message: string | null
  attempts: number
  max_attempts: number
  scheduled_at: string
  next_attempt_at: string
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  related_entity_type: string | null
  related_entity_id: string | null
  triggered_by: 'automation' | 'manual'
  created_by: string | null
  created_at: string
  updated_at: string
}

export type BranchRow = {
  id: string
  code: string
  name: string
  address_line: string | null
  city: string | null
  state: string | null
  state_code: string | null
  pincode: string | null
  phone: string | null
  gstin: string | null
  is_default: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

// â”€â”€ Views â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type OutstandingRow = {
  invoice_id: string
  invoice_no: string
  invoice_date: string
  customer_id: string
  full_name: string
  mobile: string
  whatsapp_number: string | null
  grand_total: number
  amount_paid: number
  balance: number
  days_outstanding: number
}

export type LowStockRow = {
  product_id: string
  sku: string
  name: string
  min_stock_level: number
  qty_on_hand: number
  branch_id: string | null
}

// â”€â”€ RPC payloads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type DashboardMetrics = {
  customers_today: number
  new_customers: number
  returning_customers: number
  orders_today: number
  sales_today: number
  payments_today: number
  outstanding_total: number
  pending_orders: number
  ready_for_pickup: number
  delivered_today: number
  low_stock_count: number
  wa_sent_today: number
  wa_failed_today: number
}

export type SalesOverviewRow = {
  day: string
  orders_count: number
  invoices_count: number
  gross_sales: number
  discounts: number
  gst: number
  collected: number
}

export type CustomerSearchHit = {
  id: string
  customer_code: string
  full_name: string
  mobile: string
  city: string | null
  last_visit_at: string | null
  match_via: string
}

export type NewOrderItemInput = {
  item_kind: OrderItemKind
  product_id?: string
  description: string
  lens_spec?: Json
  qty: number
  unit_price: number
  discount_pct?: number
  discount_amt?: number
  gst_rate_pct: number
  hsn_code?: string
}

// â”€â”€ supabase-js Database generic (subset, generator-compatible shape) â”€â”€â”€â”€â”€â”€â”€â”€
//
// Every entry must structurally satisfy supabase-js's GenericTable /
// GenericView / GenericFunction, otherwise the whole schema silently collapses
// to `never` and every query loses its types. Views therefore carry
// `Relationships` too, even though they have none.

type GenericRel = {
  foreignKeyName: string
  columns: string[]
  isOneToOne: boolean
  referencedRelation: string
  referencedColumns: string[]
}

/**
 * One foreign key, in the shape supabase-js uses to resolve embedded selects
 * such as `orders.select('*, customers(...)')`. Declaring these is what makes
 * a join return `CustomerRow | null` instead of a SelectQueryError.
 */
type FK<Table extends string, Column extends string, Ref extends string> = {
  foreignKeyName: `${Table}_${Column}_fkey`
  columns: [Column]
  isOneToOne: false
  referencedRelation: Ref
  referencedColumns: ['id']
}

type TableDef<Row, Rels extends GenericRel[] = []> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: Rels
}

type ViewDef<Row> = {
  Row: Row
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      branches: TableDef<BranchRow>
      profiles: TableDef<ProfileRow>
      roles: TableDef<RoleRow>
      permissions: TableDef<{ code: string; module: string; description: string }>
      role_permissions: TableDef<{ role_id: string; permission_code: string }>
      settings: TableDef<SettingRow>
      audit_logs: TableDef<AuditLogRow>
      customers: TableDef<CustomerRow>
      customer_addresses: TableDef<
        CustomerAddressRow,
        [FK<'customer_addresses', 'customer_id', 'customers'>]
      >
      prescriptions: TableDef<PrescriptionRow, [FK<'prescriptions', 'customer_id', 'customers'>]>
      prescription_files: TableDef<
        PrescriptionFileRow,
        [FK<'prescription_files', 'prescription_id', 'prescriptions'>]
      >
      product_categories: TableDef<ProductCategoryRow>
      brands: TableDef<BrandRow>
      suppliers: TableDef<SupplierRow>
      products: TableDef<
        ProductRow,
        [
          FK<'products', 'category_id', 'product_categories'>,
          FK<'products', 'brand_id', 'brands'>,
          FK<'products', 'supplier_id', 'suppliers'>,
        ]
      >
      product_stock: TableDef<ProductStockRow, [FK<'product_stock', 'product_id', 'products'>]>
      inventory_transactions: TableDef<
        InventoryTransactionRow,
        [FK<'inventory_transactions', 'product_id', 'products'>]
      >
      order_statuses: TableDef<OrderStatusRow>
      orders: TableDef<
        OrderRow,
        [
          FK<'orders', 'customer_id', 'customers'>,
          FK<'orders', 'prescription_id', 'prescriptions'>,
          FK<'orders', 'invoice_id', 'invoices'>,
        ]
      >
      order_items: TableDef<
        OrderItemRow,
        [FK<'order_items', 'order_id', 'orders'>, FK<'order_items', 'product_id', 'products'>]
      >
      order_status_history: TableDef<
        OrderStatusHistoryRow,
        [FK<'order_status_history', 'order_id', 'orders'>]
      >
      lab_vendors: TableDef<LabVendorRow>
      lab_orders: TableDef<
        LabOrderRow,
        [FK<'lab_orders', 'order_id', 'orders'>, FK<'lab_orders', 'lab_vendor_id', 'lab_vendors'>]
      >
      invoices: TableDef<
        InvoiceRow,
        [FK<'invoices', 'customer_id', 'customers'>, FK<'invoices', 'order_id', 'orders'>]
      >
      invoice_items: TableDef<
        InvoiceItemRow,
        [
          FK<'invoice_items', 'invoice_id', 'invoices'>,
          FK<'invoice_items', 'product_id', 'products'>,
        ]
      >
      payments: TableDef<
        PaymentRow,
        [
          FK<'payments', 'customer_id', 'customers'>,
          FK<'payments', 'invoice_id', 'invoices'>,
          FK<'payments', 'order_id', 'orders'>,
        ]
      >
      whatsapp_templates: TableDef<WhatsAppTemplateRow>
      whatsapp_automation_rules: TableDef<
        WhatsAppAutomationRuleRow,
        [FK<'whatsapp_automation_rules', 'template_id', 'whatsapp_templates'>]
      >
      whatsapp_messages: TableDef<
        WhatsAppMessageRow,
        [
          FK<'whatsapp_messages', 'customer_id', 'customers'>,
          FK<'whatsapp_messages', 'template_id', 'whatsapp_templates'>,
        ]
      >
    }
    Views: {
      v_outstanding: ViewDef<OutstandingRow>
      v_low_stock: ViewDef<LowStockRow>
      v_stock_reconciliation: ViewDef<{
        product_id: string
        branch_id: string
        cached_qty: number
        ledger_qty: number
        drift: number
      }>
    }
    Functions: {
      rpc_create_customer: { Args: Record<string, unknown>; Returns: CustomerRow }
      rpc_find_customer_duplicates: { Args: { p_mobile: string; p_full_name?: string }; Returns: CustomerRow[] }
      rpc_search_customers: { Args: { p_query: string; p_limit?: number }; Returns: CustomerSearchHit[] }
      rpc_create_order: { Args: Record<string, unknown>; Returns: OrderRow }
      rpc_set_order_status: {
        Args: { p_order_id: string; p_new_status: string; p_note?: string }
        Returns: OrderRow
      }
      rpc_create_invoice: {
        Args: { p_customer_id: string; p_order_id?: string | null; p_items?: Json | null }
        Returns: InvoiceRow
      }
      rpc_issue_invoice: { Args: { p_invoice_id: string; p_invoice_date?: string }; Returns: InvoiceRow }
      rpc_cancel_invoice: { Args: { p_invoice_id: string; p_reason: string }; Returns: InvoiceRow }
      rpc_record_payment: { Args: Record<string, unknown>; Returns: PaymentRow }
      rpc_refund_payment: { Args: Record<string, unknown>; Returns: PaymentRow }
      rpc_adjust_stock: { Args: Record<string, unknown>; Returns: InventoryTransactionRow }
      rpc_next_sku: { Args: Record<string, never>; Returns: string }
      rpc_dashboard_metrics: { Args: { p_day?: string }; Returns: DashboardMetrics }
      rpc_sales_overview: { Args: { p_from: string; p_to: string }; Returns: SalesOverviewRow[] }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

