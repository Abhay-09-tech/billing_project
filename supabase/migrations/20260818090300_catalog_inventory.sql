-- ============================================================================
-- 0004 · Catalogue & Inventory
-- Categories, brands, suppliers, products, and the append-only stock ledger
-- with its trigger-maintained cache.
--
-- ARCHITECTURE.md §3.3:
--  · stock truth = SUM(inventory_transactions.qty_delta); product_stock is a
--    cache kept by trigger, direct writes revoked.
--  · made-to-order lenses have is_stock_tracked = false.
-- ============================================================================

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- Reference tables
-- ────────────────────────────────────────────────────────────────────────────

create table public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  code       citext not null unique,     -- 'frames', 'sunglasses', 'lenses', ...
  name       text not null,
  kind       text not null default 'stocked'
             check (kind in ('stocked', 'made_to_order', 'service')),
  sort_order int not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

create table public.brands (
  id         uuid primary key default gen_random_uuid(),
  name       citext not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text,
  phone         text,
  email         citext,
  gstin         text,
  address       text,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- Products
-- ────────────────────────────────────────────────────────────────────────────

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  sku                 citext not null unique,          -- POV-P000001 or supplier SKU
  barcode             citext unique,
  name                text not null check (length(trim(name)) >= 2),
  category_id         uuid not null references public.product_categories (id) on delete restrict,
  brand_id            uuid references public.brands (id) on delete restrict,
  supplier_id         uuid references public.suppliers (id) on delete restrict,
  model               text,
  size                text,                            -- e.g. 52-18-140 for frames
  color               text,
  purchase_price      numeric(12,2) check (purchase_price is null or purchase_price >= 0),
  selling_price       numeric(12,2) not null check (selling_price >= 0),
  default_discount_pct numeric(5,2) not null default 0
                      check (default_discount_pct between 0 and 100),
  gst_rate_pct        numeric(5,2) not null check (gst_rate_pct between 0 and 28),
  hsn_code            text,
  is_stock_tracked    boolean not null default true,
  min_stock_level     numeric(12,3) not null default 0 check (min_stock_level >= 0),
  image_path          text,
  lens_attributes     jsonb,     -- for lens catalogue rows: {type,index,material,coatings[]}
  is_active           boolean not null default true,
  branch_id           uuid not null references public.branches (id) default public.default_branch_id(),
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index products_category_idx on public.products (category_id) where deleted_at is null;
create index products_brand_idx    on public.products (brand_id)    where deleted_at is null;
create index products_supplier_idx on public.products (supplier_id);
create index products_name_trgm_idx on public.products using gin (name gin_trgm_ops);
create index products_active_idx   on public.products (is_active, category_id) where deleted_at is null;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create trigger products_audit
  after insert or update or delete on public.products
  for each row execute function public.audit_row_change();

-- ────────────────────────────────────────────────────────────────────────────
-- Inventory ledger (append-only) + cached on-hand quantities
-- ────────────────────────────────────────────────────────────────────────────

create table public.inventory_transactions (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products (id) on delete restrict,
  branch_id   uuid not null references public.branches (id) default public.default_branch_id(),
  qty_delta   numeric(12,3) not null check (qty_delta <> 0),
  reason      text not null check (reason in (
                'opening_stock', 'purchase_inward', 'sale', 'sale_return',
                'adjustment', 'damage', 'transfer_in', 'transfer_out',
                'lab_consumption'
              )),
  ref_type    text,             -- 'order' | 'invoice' | 'credit_note' | 'manual' ...
  ref_id      uuid,
  unit_cost   numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  note        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),

  -- §13: never silently modify stock — manual movements must say why.
  constraint inventory_manual_needs_note check (
    reason not in ('adjustment', 'damage')
    or (note is not null and length(trim(note)) >= 3)
  )
);

create index inventory_tx_product_idx
  on public.inventory_transactions (product_id, created_at desc);
create index inventory_tx_ref_idx
  on public.inventory_transactions (ref_type, ref_id);

create trigger inventory_tx_immutable
  before update or delete on public.inventory_transactions
  for each row execute function public.forbid_mutation();

create trigger inventory_tx_audit
  after insert on public.inventory_transactions
  for each row execute function public.audit_row_change();

-- Cache table. All client roles get SELECT only (see RLS migration); the
-- trigger below is the sole writer.
create table public.product_stock (
  product_id   uuid not null references public.products (id) on delete cascade,
  branch_id    uuid not null references public.branches (id),
  qty_on_hand  numeric(12,3) not null default 0,
  qty_reserved numeric(12,3) not null default 0 check (qty_reserved >= 0),
  updated_at   timestamptz not null default now(),
  primary key (product_id, branch_id)
);

create or replace function public.apply_inventory_delta()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tracked boolean;
  v_new_qty numeric(12,3);
begin
  select is_stock_tracked into v_tracked
    from public.products where id = new.product_id;

  if not v_tracked then
    raise exception 'Product is not stock-tracked; ledger entries are not allowed for it.'
      using errcode = 'POV07';
  end if;

  insert into public.product_stock as ps (product_id, branch_id, qty_on_hand)
       values (new.product_id, new.branch_id, new.qty_delta)
  on conflict (product_id, branch_id)
    do update set qty_on_hand = ps.qty_on_hand + new.qty_delta,
                  updated_at  = now()
    returning qty_on_hand into v_new_qty;

  -- Sales may not drive stock negative. Inward/adjustment corrections may
  -- (fixing an over-issue), which is why the check is on the movement type.
  if v_new_qty < 0 and new.reason in ('sale', 'transfer_out', 'lab_consumption') then
    raise exception 'Insufficient stock for this product (would become %).', v_new_qty
      using errcode = 'POV04';
  end if;

  return new;
end;
$$;

create trigger inventory_tx_apply
  before insert on public.inventory_transactions
  for each row execute function public.apply_inventory_delta();

-- ────────────────────────────────────────────────────────────────────────────
-- Reconciliation view: ledger vs cache. Surfaced on the Inventory screen so
-- drift is visible, never silent. Should always return zero rows.
-- ────────────────────────────────────────────────────────────────────────────

create or replace view public.v_stock_reconciliation
with (security_invoker = true)
as
select
  ps.product_id,
  ps.branch_id,
  ps.qty_on_hand                        as cached_qty,
  coalesce(sum(it.qty_delta), 0)        as ledger_qty,
  ps.qty_on_hand - coalesce(sum(it.qty_delta), 0) as drift
from public.product_stock ps
left join public.inventory_transactions it
  on it.product_id = ps.product_id and it.branch_id = ps.branch_id
group by ps.product_id, ps.branch_id, ps.qty_on_hand
having ps.qty_on_hand <> coalesce(sum(it.qty_delta), 0);

-- Low-stock view for dashboard alerts (§13).
create or replace view public.v_low_stock
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.name,
  p.min_stock_level,
  coalesce(ps.qty_on_hand, 0) as qty_on_hand,
  ps.branch_id
from public.products p
left join public.product_stock ps on ps.product_id = p.id
where p.is_active
  and p.deleted_at is null
  and p.is_stock_tracked
  and coalesce(ps.qty_on_hand, 0) <= p.min_stock_level;
