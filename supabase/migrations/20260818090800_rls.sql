-- ============================================================================
-- 0009 · Row Level Security
-- RLS is the ACTUAL authorization boundary; UI checks are convenience only.
--
-- Pattern per table:
--   select  → auth_has('<module>.read')
--   insert  → auth_has('<module>.create')
--   update  → auth_has('<module>.update')
--   delete  → usually nothing (append-only tables also carry BEFORE triggers)
-- All policies use (select ...) so the permission scan runs once per query.
-- Financial/RPC-only tables have NO insert/update policy: the SECURITY DEFINER
-- RPCs are their only write path.
-- ============================================================================

set search_path = public, extensions;

-- Enable RLS everywhere. Default deny.
alter table public.branches                  enable row level security;
alter table public.document_counters        enable row level security;
alter table public.roles                     enable row level security;
alter table public.permissions               enable row level security;
alter table public.role_permissions          enable row level security;
alter table public.profiles                  enable row level security;
alter table public.settings                  enable row level security;
alter table public.audit_logs                enable row level security;
alter table public.customers                 enable row level security;
alter table public.customer_addresses        enable row level security;
alter table public.prescriptions             enable row level security;
alter table public.prescription_files        enable row level security;
alter table public.product_categories        enable row level security;
alter table public.brands                    enable row level security;
alter table public.suppliers                 enable row level security;
alter table public.products                  enable row level security;
alter table public.product_stock             enable row level security;
alter table public.inventory_transactions    enable row level security;
alter table public.order_statuses            enable row level security;
alter table public.orders                    enable row level security;
alter table public.order_items               enable row level security;
alter table public.order_status_history      enable row level security;
alter table public.lab_vendors               enable row level security;
alter table public.lab_orders                enable row level security;
alter table public.invoices                  enable row level security;
alter table public.invoice_items             enable row level security;
alter table public.credit_notes              enable row level security;
alter table public.credit_note_items         enable row level security;
alter table public.payments                  enable row level security;
alter table public.whatsapp_templates        enable row level security;
alter table public.whatsapp_automation_rules enable row level security;
alter table public.whatsapp_messages         enable row level security;
alter table public.whatsapp_inbound          enable row level security;

-- ── Identity ────────────────────────────────────────────────────────────────

create policy profiles_select on public.profiles
  for select using ((select public.auth_is_active_staff()));
create policy profiles_insert on public.profiles
  for insert with check ((select public.auth_has('users.manage')));
create policy profiles_update on public.profiles
  for update using ((select public.auth_has('users.manage')));

create policy roles_select on public.roles
  for select using ((select public.auth_is_active_staff()));
create policy roles_write on public.roles
  for all using ((select public.auth_has('users.manage')));

create policy permissions_select on public.permissions
  for select using ((select public.auth_is_active_staff()));

create policy role_permissions_select on public.role_permissions
  for select using ((select public.auth_is_active_staff()));
create policy role_permissions_write on public.role_permissions
  for all using ((select public.auth_has('users.manage')));

create policy branches_select on public.branches
  for select using ((select public.auth_is_active_staff()));
create policy branches_write on public.branches
  for all using ((select public.auth_has('settings.manage')));

-- Settings: secrets never leave the database via the API.
create policy settings_select on public.settings
  for select using ((select public.auth_is_active_staff()) and not is_secret);
create policy settings_write on public.settings
  for all using ((select public.auth_has('settings.manage')))
  with check ((select public.auth_has('settings.manage')));

-- Audit: admins read; nobody inserts directly (SECURITY DEFINER triggers do).
create policy audit_logs_select on public.audit_logs
  for select using ((select public.auth_has('audit.read')));

-- document_counters: no client access at all (RPC-only). No policies = deny.

-- ── CRM ─────────────────────────────────────────────────────────────────────

create policy customers_select on public.customers
  for select using ((select public.auth_has('customers.read')));
create policy customers_insert on public.customers
  for insert with check ((select public.auth_has('customers.create')));
create policy customers_update on public.customers
  for update using ((select public.auth_has('customers.update')));

create policy customer_addresses_select on public.customer_addresses
  for select using ((select public.auth_has('customers.read')));
create policy customer_addresses_write on public.customer_addresses
  for all using ((select public.auth_has('customers.update')))
  with check ((select public.auth_has('customers.update')));

create policy prescriptions_select on public.prescriptions
  for select using ((select public.auth_has('prescriptions.read')));
create policy prescriptions_insert on public.prescriptions
  for insert with check ((select public.auth_has('prescriptions.create')));
-- update allowed only for voiding; the table trigger enforces which columns.
create policy prescriptions_void on public.prescriptions
  for update using ((select public.auth_has('prescriptions.void')));

create policy prescription_files_select on public.prescription_files
  for select using ((select public.auth_has('prescriptions.read')));
create policy prescription_files_insert on public.prescription_files
  for insert with check ((select public.auth_has('prescriptions.create')));

-- ── Catalogue & stock ───────────────────────────────────────────────────────

create policy product_categories_select on public.product_categories
  for select using ((select public.auth_is_active_staff()));
create policy product_categories_write on public.product_categories
  for all using ((select public.auth_has('products.manage')));

create policy brands_select on public.brands
  for select using ((select public.auth_is_active_staff()));
create policy brands_write on public.brands
  for all using ((select public.auth_has('products.manage')));

create policy suppliers_select on public.suppliers
  for select using ((select public.auth_has('products.read')));
create policy suppliers_write on public.suppliers
  for all using ((select public.auth_has('products.manage')));

create policy products_select on public.products
  for select using ((select public.auth_has('products.read')));
create policy products_insert on public.products
  for insert with check ((select public.auth_has('products.create')));
create policy products_update on public.products
  for update using ((select public.auth_has('products.manage')));

create policy product_stock_select on public.product_stock
  for select using ((select public.auth_has('inventory.read')));
-- No insert/update policies: only the ledger trigger (SECURITY DEFINER) writes.

create policy inventory_tx_select on public.inventory_transactions
  for select using ((select public.auth_has('inventory.read')));
-- No direct insert policy: rpc_adjust_stock / order RPCs are the write path.

-- ── Orders & lab ────────────────────────────────────────────────────────────

create policy order_statuses_select on public.order_statuses
  for select using ((select public.auth_is_active_staff()));
create policy order_statuses_write on public.order_statuses
  for all using ((select public.auth_has('settings.manage')));

create policy orders_select on public.orders
  for select using ((select public.auth_has('orders.read')));
create policy orders_update on public.orders
  for update using ((select public.auth_has('orders.update')));
-- insert via rpc_create_order only.

create policy order_items_select on public.order_items
  for select using ((select public.auth_has('orders.read')));

create policy order_status_history_select on public.order_status_history
  for select using ((select public.auth_has('orders.read')));

create policy lab_vendors_select on public.lab_vendors
  for select using ((select public.auth_has('lab.read')));
create policy lab_vendors_write on public.lab_vendors
  for all using ((select public.auth_has('lab.manage')));

create policy lab_orders_select on public.lab_orders
  for select using ((select public.auth_has('lab.read')));
create policy lab_orders_insert on public.lab_orders
  for insert with check ((select public.auth_has('lab.manage')));
create policy lab_orders_update on public.lab_orders
  for update using ((select public.auth_has('lab.manage')));

-- ── Billing ─────────────────────────────────────────────────────────────────

create policy invoices_select on public.invoices
  for select using ((select public.auth_has('invoices.read')));
-- All writes via RPCs (create/issue/cancel). Draft deletion by admins:
create policy invoices_delete_draft on public.invoices
  for delete using (status = 'draft' and (select public.auth_has('invoices.cancel')));

create policy invoice_items_select on public.invoice_items
  for select using ((select public.auth_has('invoices.read')));

create policy credit_notes_select on public.credit_notes
  for select using ((select public.auth_has('invoices.read')));

create policy credit_note_items_select on public.credit_note_items
  for select using ((select public.auth_has('invoices.read')));

create policy payments_select on public.payments
  for select using ((select public.auth_has('payments.read')));
-- Writes via rpc_record_payment / rpc_refund_payment only.

-- ── WhatsApp ────────────────────────────────────────────────────────────────

create policy wa_templates_select on public.whatsapp_templates
  for select using ((select public.auth_has('whatsapp.read')));
create policy wa_templates_write on public.whatsapp_templates
  for all using ((select public.auth_has('whatsapp.manage')))
  with check ((select public.auth_has('whatsapp.manage')));

create policy wa_rules_select on public.whatsapp_automation_rules
  for select using ((select public.auth_has('whatsapp.read')));
create policy wa_rules_write on public.whatsapp_automation_rules
  for all using ((select public.auth_has('whatsapp.manage')))
  with check ((select public.auth_has('whatsapp.manage')));

create policy wa_messages_select on public.whatsapp_messages
  for select using ((select public.auth_has('whatsapp.read')));
-- Manual sends insert directly with a client-built idempotency key.
create policy wa_messages_insert on public.whatsapp_messages
  for insert with check (
    (select public.auth_has('whatsapp.send')) and triggered_by = 'manual'
  );

create policy wa_inbound_select on public.whatsapp_inbound
  for select using ((select public.auth_has('whatsapp.read')));

-- ── Lock down function execution ────────────────────────────────────────────
-- PostgREST exposes functions to anon/authenticated by default; internal
-- helpers must not be callable.

revoke execute on function public.next_document_number(text, text)      from anon, authenticated;
revoke execute on function public.generate_doc_number(text, date)       from anon, authenticated;
revoke execute on function public.wa_enqueue_for_event(text, uuid, jsonb, text, text, uuid) from anon, authenticated;
revoke execute on function public.recompute_invoice_paid(uuid)          from anon, authenticated;
revoke execute on function public.audit_event(text, text, text, jsonb)  from anon, authenticated;

-- Business RPCs: authenticated only (they enforce fine-grained permissions).
revoke execute on function public.rpc_create_customer(text, text, text, text, date, text, text, text, text, boolean) from anon;
revoke execute on function public.rpc_find_customer_duplicates(text, text) from anon;
revoke execute on function public.rpc_search_customers(text, int)          from anon;
revoke execute on function public.rpc_create_order(uuid, jsonb, uuid, date, text, numeric, text) from anon;
revoke execute on function public.rpc_set_order_status(uuid, text, text)   from anon;
revoke execute on function public.rpc_create_invoice(uuid, uuid, jsonb)    from anon;
revoke execute on function public.rpc_issue_invoice(uuid, date)            from anon;
revoke execute on function public.rpc_cancel_invoice(uuid, text)           from anon;
revoke execute on function public.rpc_record_payment(uuid, numeric, text, text, text, boolean) from anon;
revoke execute on function public.rpc_refund_payment(uuid, numeric, text, text) from anon;
revoke execute on function public.rpc_adjust_stock(uuid, numeric, text, text, numeric) from anon;
revoke execute on function public.rpc_next_sku()                           from anon;
revoke execute on function public.rpc_dashboard_metrics(date)              from anon;
revoke execute on function public.rpc_sales_overview(date, date)           from anon;
