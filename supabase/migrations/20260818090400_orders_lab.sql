-- ============================================================================
-- 0005 · Orders & Lab
-- Optical job workflow: orders, items, data-driven status machine, lab orders.
--
-- ARCHITECTURE.md §3.3. Status changes happen ONLY through
-- rpc_set_order_status (migration 0007) so every move is validated and logged.
-- ============================================================================

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- Status machine as data (§15: "configurable from Settings in the future").
-- allowed_next drives transition validation; is_terminal stops the flow.
-- ────────────────────────────────────────────────────────────────────────────

create table public.order_statuses (
  code          text primary key,
  label         text not null,
  sort_order    int  not null,
  is_terminal   boolean not null default false,
  is_cancelled  boolean not null default false,
  allowed_next  text[] not null default '{}',
  wa_event_key  text,                -- automation hook, e.g. 'order.status.ready'
  is_active     boolean not null default true
);

insert into public.order_statuses (code, label, sort_order, is_terminal, is_cancelled, allowed_next, wa_event_key) values
  ('new',                  'New',                   10, false, false, '{prescription_received,frame_selected,cancelled}',      'order.created'),
  ('prescription_received','Prescription Received', 20, false, false, '{frame_selected,lens_ordered,cancelled}',               null),
  ('frame_selected',       'Frame Selected',        30, false, false, '{lens_ordered,in_lab,cancelled}',                       null),
  ('lens_ordered',         'Lens Ordered',          40, false, false, '{in_lab,cancelled}',                                    null),
  ('in_lab',               'In Lab',                50, false, false, '{quality_check,cancelled}',                             null),
  ('quality_check',        'Quality Check',         60, false, false, '{in_lab,ready,cancelled}',                              null),
  ('ready',                'Ready',                 70, false, false, '{customer_notified,delivered,cancelled}',               'order.status.ready'),
  ('customer_notified',    'Customer Notified',     80, false, false, '{delivered,cancelled}',                                 null),
  ('delivered',            'Delivered',             90, false, false, '{completed}',                                           'order.delivered'),
  ('completed',            'Completed',            100, true,  false, '{}',                                                    null),
  ('cancelled',            'Cancelled',            110, true,  true,  '{}',                                                    null);

-- ────────────────────────────────────────────────────────────────────────────
-- Orders
-- ────────────────────────────────────────────────────────────────────────────

create table public.orders (
  id                     uuid primary key default gen_random_uuid(),
  order_code             citext not null unique,      -- POV-O000001 (allocated by RPC)
  customer_id            uuid not null references public.customers (id) on delete restrict,
  prescription_id        uuid references public.prescriptions (id) on delete restrict,
  status                 text not null default 'new' references public.order_statuses (code),
  expected_delivery_date date,
  delivered_at           timestamptz,
  notes                  text,
  cancel_reason          text,

  -- Money summary (computed by RPC from items; cached for lists).
  subtotal        numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_total  numeric(12,2) not null default 0 check (discount_total >= 0),
  tax_total       numeric(12,2) not null default 0 check (tax_total >= 0),
  grand_total     numeric(12,2) not null default 0 check (grand_total >= 0),
  advance_amount  numeric(12,2) not null default 0 check (advance_amount >= 0),

  invoice_id      uuid,          -- FK added in 0006 after invoices exists

  branch_id  uuid not null references public.branches (id) default public.default_branch_id(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_customer_idx  on public.orders (customer_id, created_at desc);
create index orders_status_idx    on public.orders (status, created_at desc);
create index orders_expected_idx  on public.orders (expected_delivery_date)
  where status not in ('completed', 'cancelled', 'delivered');
create index orders_created_idx   on public.orders (created_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create trigger orders_audit
  after insert or update or delete on public.orders
  for each row execute function public.audit_row_change();

-- Status may not be changed by a bare UPDATE — only via rpc_set_order_status,
-- which sets this transaction-local flag before writing.
create or replace function public.orders_guard_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('pov.allow_status_change', true), '') <> 'on' then
    raise exception
      'Order status must be changed through the status action, not by editing the order.'
      using errcode = 'POV02';
  end if;
  return new;
end;
$$;

create trigger orders_guard_status
  before update on public.orders
  for each row execute function public.orders_guard_status();

-- ────────────────────────────────────────────────────────────────────────────
-- Order items.  item_kind:
--   product  — stocked SKU (frame, sunglasses, accessory); deducts stock
--   lens     — made-to-order lens configured in lens_spec; no stock movement
--   service  — fitting, repair
--   custom   — free-text one-off
-- ────────────────────────────────────────────────────────────────────────────

create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  item_kind     text not null check (item_kind in ('product', 'lens', 'service', 'custom')),
  product_id    uuid references public.products (id) on delete restrict,
  description   text not null,
  lens_spec     jsonb,        -- {type,index,material,coating,tint,brand,eye:'both'|'od'|'os'}
  qty           numeric(12,3) not null default 1 check (qty > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  discount_pct  numeric(5,2)  not null default 0 check (discount_pct between 0 and 100),
  discount_amt  numeric(12,2) not null default 0 check (discount_amt >= 0),
  gst_rate_pct  numeric(5,2)  not null default 0 check (gst_rate_pct between 0 and 28),
  line_total    numeric(12,2) not null default 0 check (line_total >= 0),
  created_at    timestamptz not null default now(),

  constraint order_items_product_kind check (
    (item_kind = 'product') = (product_id is not null) or item_kind = 'lens'
  )
);

create index order_items_order_idx   on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Status history — the immutable trail behind the status column.
-- ────────────────────────────────────────────────────────────────────────────

create table public.order_status_history (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  from_status text references public.order_statuses (code),
  to_status   text not null references public.order_statuses (code),
  note        text,
  changed_by  uuid references public.profiles (id),
  changed_at  timestamptz not null default now()
);

create index order_status_history_order_idx
  on public.order_status_history (order_id, changed_at desc);

create trigger order_status_history_immutable
  before update or delete on public.order_status_history
  for each row execute function public.forbid_mutation();

-- ────────────────────────────────────────────────────────────────────────────
-- Lab
-- ────────────────────────────────────────────────────────────────────────────

create table public.lab_vendors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  contact    text,
  phone      text,
  email      citext,
  notes      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger lab_vendors_set_updated_at
  before update on public.lab_vendors
  for each row execute function public.set_updated_at();

create table public.lab_orders (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete restrict,
  lab_vendor_id        uuid references public.lab_vendors (id) on delete restrict,
  status               text not null default 'sent'
                       check (status in ('sent', 'in_process', 'received', 'qc_pending', 'qc_passed', 'qc_failed')),
  lens_details         text,          -- free-text spec sent to the lab
  sent_at              timestamptz not null default now(),
  expected_return_date date,
  received_at          timestamptz,
  qc_by                uuid references public.profiles (id),
  qc_at                timestamptz,
  qc_notes             text,
  remake_of_id         uuid references public.lab_orders (id),   -- QC-failed → remake chain
  branch_id  uuid not null references public.branches (id) default public.default_branch_id(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lab_orders_qc_fields check (
    (status in ('qc_passed', 'qc_failed')) = (qc_at is not null)
  )
);

create index lab_orders_order_idx  on public.lab_orders (order_id);
create index lab_orders_status_idx on public.lab_orders (status, expected_return_date);

create trigger lab_orders_set_updated_at
  before update on public.lab_orders
  for each row execute function public.set_updated_at();

create trigger lab_orders_audit
  after insert or update or delete on public.lab_orders
  for each row execute function public.audit_row_change();
