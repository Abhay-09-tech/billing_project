-- ===========================================================================
-- Perfect Optical Vision — complete database schema
--
-- GENERATED FILE — do not edit. Regenerate with: npm run db:bundle
-- Built from 12 migrations in supabase/migrations/
--
-- FIRST-TIME SETUP, ON A FRESH PROJECT:
--   Supabase Dashboard → SQL Editor → New query → paste all of this → Run
--
-- Run this ONCE. Migrations are not written to be re-applied, so the guard
-- below stops a second run with a clear message instead of a confusing
-- "relation already exists" error. Everything is inside one transaction, so
-- a refused or failed run leaves the database completely untouched.
--
-- For changes AFTER setup, use `npm run db:push` — never re-paste this file.
-- ===========================================================================

begin;

-- Refuse to run twice, rather than half-applying over an existing schema.
do $guard$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'branches'
  ) then
    raise exception
      'Perfect Optical Vision is already installed in this project. Nothing was changed. To apply later updates run: npm run db:push';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 20260818090000_foundation.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 0001 · Foundation
-- Extensions, shared trigger helpers, branches, and gapless document numbering.
--
-- See docs/ARCHITECTURE.md §3.1 (conventions) and §3.3 (document_counters).
-- ============================================================================

create extension if not exists "pgcrypto"  with schema extensions;
create extension if not exists "citext"    with schema extensions;
create extension if not exists "pg_trgm"   with schema extensions;

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- Custom SQLSTATEs.
-- The frontend maps these to friendly messages (src/lib/errors.ts) so staff
-- never see a raw Postgres error — ARCHITECTURE.md §37 / brief §37.
--   POV01  configuration missing
--   POV02  invalid state transition
--   POV03  record is immutable
--   POV04  insufficient stock
--   POV05  payment exceeds balance
--   POV06  not permitted
--   POV07  validation failed
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- Shared trigger helpers
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Generic BEFORE UPDATE trigger keeping updated_at honest.';

-- Blocks UPDATE/DELETE outright. Used on append-only ledgers.
create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Rows in % cannot be modified or deleted. Use a reversing entry instead.',
    tg_table_name
    using errcode = 'POV03';
end;
$$;

comment on function public.forbid_mutation is
  'Enforces append-only ledgers (payments, inventory_transactions, audit_logs).';

-- ────────────────────────────────────────────────────────────────────────────
-- Indian financial year key: 1 Apr – 31 Mar.  2026-08-18 -> '26-27'
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.fy_key(p_date date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from p_date) >= 4
      then to_char(p_date, 'YY') || '-' || to_char(p_date + interval '1 year', 'YY')
    else      to_char(p_date - interval '1 year', 'YY') || '-' || to_char(p_date, 'YY')
  end;
$$;

comment on function public.fy_key is
  'Indian financial year label (Apr-Mar) used for invoice series resets.';

-- ────────────────────────────────────────────────────────────────────────────
-- Branches — one row today, but every transactional table carries branch_id so
-- a second shop is a data change rather than a migration.  (brief §40)
-- ────────────────────────────────────────────────────────────────────────────

create table public.branches (
  id           uuid primary key default gen_random_uuid(),
  code         citext not null unique,
  name         text   not null,
  address_line text,
  city         text,
  state        text,
  state_code   text,                       -- GST state code, e.g. '29' Karnataka
  pincode      text,
  phone        text,
  gstin        text,
  is_default   boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint branches_gstin_format
    check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$')
);

-- Exactly one default branch.
create unique index branches_single_default
  on public.branches (is_default)
  where is_default;

create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

create or replace function public.default_branch_id()
returns uuid
language sql
stable
as $$
  select id from public.branches where is_default limit 1;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Gapless document numbering.
--
-- A Postgres sequence is deliberately NOT used: sequences leave gaps when a
-- transaction rolls back, and a gap in a GST invoice series is an audit finding
-- (CGST Rule 46(b) requires a consecutive series). ON CONFLICT DO UPDATE takes
-- a row lock, so a rollback also rolls back the increment.
-- ────────────────────────────────────────────────────────────────────────────

create table public.document_counters (
  scope       text not null,          -- 'invoice' | 'order' | 'customer' | 'payment' | ...
  period_key  text not null default '',
  last_number bigint not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (scope, period_key)
);

create or replace function public.next_document_number(
  p_scope      text,
  p_period_key text default ''
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_number bigint;
begin
  insert into public.document_counters (scope, period_key, last_number)
       values (p_scope, p_period_key, 1)
  on conflict (scope, period_key)
    do update set last_number = public.document_counters.last_number + 1,
                  updated_at  = now()
    returning last_number into v_number;

  return v_number;
end;
$$;

comment on function public.next_document_number is
  'Allocates the next number in a series under a row lock. Gapless across rollbacks.';

-- Builds the human-facing code from settings, so Settings > Billing can change
-- the invoice format without a deployment. (brief §39)
create or replace function public.generate_doc_number(
  p_doc_type text,
  p_date     date default current_date
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg     jsonb;
  v_prefix  text;
  v_pattern text;
  v_pad     int;
  v_reset   text;
  v_period  text;
  v_seq     bigint;
begin
  select value into v_cfg
    from public.settings
   where key = 'numbering.' || p_doc_type;

  if v_cfg is null then
    raise exception 'No numbering configuration found for document type "%".', p_doc_type
      using errcode = 'POV01';
  end if;

  v_prefix  := coalesce(v_cfg ->> 'prefix',  'POV');
  v_pattern := coalesce(v_cfg ->> 'pattern', '{prefix}-{seq}');
  v_pad     := coalesce((v_cfg ->> 'pad')::int, 5);
  v_reset   := coalesce(v_cfg ->> 'reset', 'never');

  v_period := case v_reset
                when 'fy'    then public.fy_key(p_date)
                when 'year'  then to_char(p_date, 'YYYY')
                when 'month' then to_char(p_date, 'YYYYMM')
                else ''
              end;

  v_seq := public.next_document_number(p_doc_type, v_period);

  return replace(
           replace(
             replace(
               replace(v_pattern, '{prefix}', v_prefix),
               '{fy}',     v_period),
             '{period}',   v_period),
           '{seq}',        lpad(v_seq::text, v_pad, '0'));
end;
$$;

comment on function public.generate_doc_number is
  'Formats the next document code using the settings row numbering.<doc_type>.';

-- ---------------------------------------------------------------------------
-- 20260818090100_identity_rbac.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 0002 · Identity & RBAC
-- profiles (1:1 auth.users), roles, permissions, role_permissions, settings,
-- audit_logs, and the auth_has() helper every RLS policy uses.
--
-- ARCHITECTURE.md §4. Roles are DATA: adding "cashier" later is an INSERT,
-- not a deployment.
-- ============================================================================

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- RBAC tables
-- ────────────────────────────────────────────────────────────────────────────

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  code        citext not null unique,           -- 'admin', 'staff'
  name        text not null,
  description text,
  is_system   boolean not null default false,   -- seeded roles cannot be deleted
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create table public.permissions (
  code        citext primary key,               -- 'customers.create'
  module      text not null,                    -- 'customers'
  description text not null
);

create table public.role_permissions (
  role_id         uuid   not null references public.roles (id) on delete cascade,
  permission_code citext not null references public.permissions (code) on delete cascade,
  primary key (role_id, permission_code)
);

create index role_permissions_permission_idx
  on public.role_permissions (permission_code);

-- ────────────────────────────────────────────────────────────────────────────
-- Profiles — app-level identity, 1:1 with auth.users.
-- Deactivating a profile revokes all access instantly without deleting the
-- auth user (which would orphan created_by references everywhere).
-- ────────────────────────────────────────────────────────────────────────────

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  phone      text,
  role_id    uuid not null references public.roles (id) on delete restrict,
  branch_id  uuid not null references public.branches (id) on delete restrict,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx   on public.profiles (role_id);
create index profiles_branch_idx on public.profiles (branch_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- Permission check used by every RLS policy.
--
--  · SECURITY DEFINER: reads profiles without tripping profiles' own RLS.
--  · STABLE: evaluated once per statement, not per row, when called as
--    (select auth_has(...)) — the InitPlan optimisation.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.auth_has(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.profiles p
      join public.role_permissions rp on rp.role_id = p.role_id
     where p.id = (select auth.uid())
       and p.is_active
       and rp.permission_code = p_permission
  );
$$;

create or replace function public.auth_is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.is_active
  );
$$;

-- Convenience for RPCs that must name the acting user.
create or replace function public.current_profile_id()
returns uuid
language sql
stable
as $$
  select (select auth.uid());
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Settings — key/value with jsonb payloads.
-- is_secret rows are filtered out by RLS (clients never see them); genuinely
-- dangerous secrets (API tokens) live only in Edge Function env, not here.
-- ────────────────────────────────────────────────────────────────────────────

create table public.settings (
  key        citext primary key,
  value      jsonb not null,
  is_secret  boolean not null default false,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- Audit log — insert-only, written by the generic trigger below.
-- Attaching auditing to a new table is one line in its migration:
--   create trigger x_audit after insert or update or delete on x
--     for each row execute function audit_row_change();
-- ────────────────────────────────────────────────────────────────────────────

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,                                -- null for system/cron actions
  action      text not null,                       -- 'insert' | 'update' | 'delete' | custom
  entity_type text not null,
  entity_id   text not null,
  before      jsonb,
  after       jsonb,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index audit_logs_entity_idx  on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx   on public.audit_logs (actor_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.forbid_mutation();

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity_id text;
begin
  v_entity_id := coalesce(
    case when tg_op = 'DELETE' then (to_jsonb(old) ->> 'id')
         else (to_jsonb(new) ->> 'id') end,
    '?');

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_entity_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Manual audit events from RPCs (e.g. 'invoice.cancelled' with a reason).
create or replace function public.audit_event(
  p_action      text,
  p_entity_type text,
  p_entity_id   text,
  p_metadata    jsonb default null
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata);
$$;

-- Audit the identity tables themselves.
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();

create trigger settings_audit
  after insert or update or delete on public.settings
  for each row execute function public.audit_row_change();

create trigger roles_audit
  after insert or update or delete on public.roles
  for each row execute function public.audit_row_change();

create trigger role_permissions_audit
  after insert or update or delete on public.role_permissions
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- 20260818090200_customers_prescriptions.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 0003 · Customers & Prescriptions
-- CRM core + append-only clinical prescription history.
--
-- ARCHITECTURE.md §3.3. Prescriptions are NEVER updated in place: corrections
-- create a new row pointing at the one they supersede.
-- ============================================================================

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- Customers
-- ────────────────────────────────────────────────────────────────────────────

create table public.customers (
  id                uuid primary key default gen_random_uuid(),
  customer_code     citext not null unique,          -- POV-C000001 (allocated by RPC)
  full_name         text not null check (length(trim(full_name)) >= 2),
  mobile            citext not null,
  whatsapp_number   citext,                          -- defaults to mobile in the UI
  whatsapp_opt_in   boolean not null default false,  -- marketing consent (Meta requirement)
  whatsapp_opt_in_at timestamptz,
  alt_phone         citext,
  email             citext,
  dob               date check (dob is null or dob between date '1900-01-01' and current_date),
  gender            text check (gender is null or gender in ('male', 'female', 'other')),
  city              text,
  notes             text,
  status            text not null default 'active'
                    check (status in ('active', 'inactive', 'blocked')),
  first_purchase_at timestamptz,
  last_visit_at     timestamptz,
  metadata          jsonb not null default '{}'::jsonb,  -- future: loyalty, tags
  branch_id         uuid not null references public.branches (id) default public.default_branch_id(),
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,                     -- soft delete; financial links survive
  constraint customers_mobile_format
    check (mobile ~ '^[0-9]{10}$'),
  constraint customers_whatsapp_format
    check (whatsapp_number is null or whatsapp_number ~ '^[0-9]{10,15}$'),
  constraint customers_email_format
    check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- Duplicate guard: same mobile can only belong to one *live* customer.
-- Families sharing a phone are handled in the UI ("link to existing / create
-- anyway") by storing the shared number in alt_phone instead.
create unique index customers_mobile_live_uniq
  on public.customers (mobile)
  where deleted_at is null;

-- Search: trigram indexes make  '%9876%'  and fuzzy-name matches indexable.
create index customers_name_trgm_idx
  on public.customers using gin (full_name gin_trgm_ops);
create index customers_mobile_trgm_idx
  on public.customers using gin ((mobile::text) gin_trgm_ops);
create index customers_last_visit_idx
  on public.customers (last_visit_at desc nulls last);
create index customers_created_idx
  on public.customers (created_at desc);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create trigger customers_audit
  after insert or update or delete on public.customers
  for each row execute function public.audit_row_change();

-- Multiple addresses per customer (home / office / delivery).
create table public.customer_addresses (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers (id) on delete cascade,
  label        text not null default 'home',
  address_line text not null,
  city         text,
  state        text,
  pincode      text check (pincode is null or pincode ~ '^[0-9]{6}$'),
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index customer_addresses_customer_idx
  on public.customer_addresses (customer_id);

create unique index customer_addresses_one_primary
  on public.customer_addresses (customer_id)
  where is_primary;

create trigger customer_addresses_set_updated_at
  before update on public.customer_addresses
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- Prescriptions — append-only clinical history.
--
-- Sign conventions and ranges follow standard optometric practice:
--   SPH  -30.00 … +30.00, steps of 0.25
--   CYL  -10.00 … +10.00 (minus-cylinder convention typical in India)
--   AXIS 1…180, REQUIRED when CYL ≠ 0, meaningless otherwise
--   ADD  +0.25 … +4.00, only for near/bifocal/progressive
--   PD stored monocular (right + left); binocular derived or entered directly
-- ────────────────────────────────────────────────────────────────────────────

create table public.prescriptions (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers (id) on delete restrict,
  rx_date        date not null default current_date
                 check (rx_date <= current_date),
  rx_type        text not null default 'distance'
                 check (rx_type in ('distance', 'near', 'bifocal', 'progressive', 'contact_lens')),
  prescribed_by  text,                              -- doctor / optometrist name
  remarks        text,

  -- Right eye (OD)
  od_sph      numeric(5,2) check (od_sph  between -30 and 30),
  od_cyl      numeric(5,2) check (od_cyl  between -10 and 10),
  od_axis     smallint     check (od_axis between 1 and 180),
  od_add      numeric(4,2) check (od_add  between 0.25 and 4),
  od_prism_h  numeric(4,2) check (od_prism_h between 0.25 and 10),
  od_prism_h_base text     check (od_prism_h_base in ('in', 'out')),
  od_prism_v  numeric(4,2) check (od_prism_v between 0.25 and 10),
  od_prism_v_base text     check (od_prism_v_base in ('up', 'down')),
  od_bc       numeric(4,2),                         -- contact lens base curve
  od_dia      numeric(4,1),                         -- contact lens diameter

  -- Left eye (OS)
  os_sph      numeric(5,2) check (os_sph  between -30 and 30),
  os_cyl      numeric(5,2) check (os_cyl  between -10 and 10),
  os_axis     smallint     check (os_axis between 1 and 180),
  os_add      numeric(4,2) check (os_add  between 0.25 and 4),
  os_prism_h  numeric(4,2) check (os_prism_h between 0.25 and 10),
  os_prism_h_base text     check (os_prism_h_base in ('in', 'out')),
  os_prism_v  numeric(4,2) check (os_prism_v between 0.25 and 10),
  os_prism_v_base text     check (os_prism_v_base in ('up', 'down')),
  os_bc       numeric(4,2),
  os_dia      numeric(4,1),

  -- Centration
  pd_right     numeric(4,1) check (pd_right between 20 and 45),
  pd_left      numeric(4,1) check (pd_left  between 20 and 45),
  pd_binocular numeric(4,1) check (pd_binocular between 40 and 90),
  od_seg_ht    numeric(4,1) check (od_seg_ht between 8 and 40),
  os_seg_ht    numeric(4,1) check (os_seg_ht between 8 and 40),

  -- Lifecycle (append-only)
  supersedes_id uuid references public.prescriptions (id),
  voided_at     timestamptz,
  void_reason   text,

  branch_id  uuid not null references public.branches (id) default public.default_branch_id(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),

  -- Axis is required exactly when there is cylinder power.
  constraint prescriptions_od_axis_with_cyl check (
    (od_cyl is null or od_cyl = 0) = (od_axis is null)
  ),
  constraint prescriptions_os_axis_with_cyl check (
    (os_cyl is null or os_cyl = 0) = (os_axis is null)
  ),
  -- Prism base direction accompanies prism power.
  constraint prescriptions_od_prism_h_base check ((od_prism_h is null) = (od_prism_h_base is null)),
  constraint prescriptions_od_prism_v_base check ((od_prism_v is null) = (od_prism_v_base is null)),
  constraint prescriptions_os_prism_h_base check ((os_prism_h is null) = (os_prism_h_base is null)),
  constraint prescriptions_os_prism_v_base check ((os_prism_v is null) = (os_prism_v_base is null)),
  -- A prescription must say something about at least one eye.
  constraint prescriptions_not_empty check (
    od_sph is not null or os_sph is not null or
    od_cyl is not null or os_cyl is not null or
    rx_type = 'contact_lens'
  ),
  -- Void needs a reason.
  constraint prescriptions_void_reason check ((voided_at is null) = (void_reason is null))
);

create index prescriptions_customer_idx
  on public.prescriptions (customer_id, rx_date desc, created_at desc);

create trigger prescriptions_audit
  after insert or update or delete on public.prescriptions
  for each row execute function public.audit_row_change();

-- Clinical values are immutable. The ONLY permitted UPDATE is voiding
-- (setting voided_at/void_reason once) — everything else must be a new row.
create or replace function public.prescriptions_guard_update()
returns trigger
language plpgsql
as $$
begin
  if to_jsonb(new) - 'voided_at' - 'void_reason' is distinct from
     to_jsonb(old) - 'voided_at' - 'void_reason' then
    raise exception
      'Prescriptions are read-only. Create a new prescription that supersedes this one.'
      using errcode = 'POV03';
  end if;
  if old.voided_at is not null then
    raise exception 'This prescription is already voided.' using errcode = 'POV03';
  end if;
  return new;
end;
$$;

create trigger prescriptions_guard_update
  before update on public.prescriptions
  for each row execute function public.prescriptions_guard_update();

create trigger prescriptions_no_delete
  before delete on public.prescriptions
  for each row execute function public.forbid_mutation();

-- Uploaded scans/photos of the physical prescription (Storage paths).
create table public.prescription_files (
  id              uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions (id) on delete restrict,
  storage_path    text not null,           -- {customer_id}/{prescription_id}/{uuid}.jpg
  file_name       text not null,
  mime_type       text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes      integer check (size_bytes > 0 and size_bytes <= 10 * 1024 * 1024),
  uploaded_by     uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);

create index prescription_files_rx_idx
  on public.prescription_files (prescription_id);

-- ---------------------------------------------------------------------------
-- 20260818090300_catalog_inventory.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 20260818090400_orders_lab.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 20260818090500_billing_payments.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 0006 · Billing & Payments
-- Invoices (immutable once issued), credit notes, append-only payments ledger.
--
-- ARCHITECTURE.md §3.3 / §5:
--  · issued invoices never change; corrections are credit notes
--  · cancellation keeps the number (GST: consecutive, never reused)
--  · amount_paid is a trigger-maintained cache of the payments ledger
-- ============================================================================

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- Invoices
-- ────────────────────────────────────────────────────────────────────────────

create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  invoice_no       citext unique,           -- allocated at issue: POV/26-27/00001
  status           text not null default 'draft'
                   check (status in ('draft', 'issued', 'cancelled')),
  invoice_date     date,
  customer_id      uuid not null references public.customers (id) on delete restrict,
  order_id         uuid references public.orders (id) on delete restrict,

  place_of_supply  text,                    -- GST state code of the customer
  is_intra_state   boolean not null default true,
  is_tax_inclusive boolean not null default true,   -- snapshot of the setting at issue

  subtotal       numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  taxable_total  numeric(12,2) not null default 0 check (taxable_total >= 0),
  cgst_total     numeric(12,2) not null default 0 check (cgst_total >= 0),
  sgst_total     numeric(12,2) not null default 0 check (sgst_total >= 0),
  igst_total     numeric(12,2) not null default 0 check (igst_total >= 0),
  round_off      numeric(4,2)  not null default 0,
  grand_total    numeric(12,2) not null default 0 check (grand_total >= 0),

  amount_paid    numeric(12,2) not null default 0,   -- ledger cache (trigger)

  issued_at      timestamptz,
  cancelled_at   timestamptz,
  cancel_reason  text,
  pdf_path       text,                     -- Storage path once rendered

  branch_id  uuid not null references public.branches (id) default public.default_branch_id(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_issued_fields check (
    status = 'draft' or (invoice_no is not null and invoice_date is not null and issued_at is not null)
  ),
  constraint invoices_cancel_fields check (
    (status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null)
  ),
  constraint invoices_tax_split check (
    (is_intra_state and igst_total = 0) or (not is_intra_state and cgst_total = 0 and sgst_total = 0)
  )
);

create index invoices_customer_idx on public.invoices (customer_id, created_at desc);
create index invoices_order_idx    on public.invoices (order_id);
create index invoices_date_idx     on public.invoices (invoice_date desc);
create index invoices_status_idx   on public.invoices (status);
-- Outstanding lookups: issued, not fully paid.
create index invoices_outstanding_idx
  on public.invoices (customer_id)
  where status = 'issued';

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create trigger invoices_audit
  after insert or update or delete on public.invoices
  for each row execute function public.audit_row_change();

-- Immutability: once issued, monetary and identity columns are frozen.
-- amount_paid, pdf_path, status→cancelled (with reason) remain writable.
create or replace function public.invoices_guard_update()
returns trigger
language plpgsql
as $$
declare
  frozen_old jsonb;
  frozen_new jsonb;
begin
  if old.status = 'draft' then
    return new;   -- drafts are freely editable
  end if;

  frozen_old := to_jsonb(old) - 'amount_paid' - 'pdf_path' - 'updated_at'
                - 'status' - 'cancelled_at' - 'cancel_reason';
  frozen_new := to_jsonb(new) - 'amount_paid' - 'pdf_path' - 'updated_at'
                - 'status' - 'cancelled_at' - 'cancel_reason';

  if frozen_new is distinct from frozen_old then
    raise exception
      'An issued invoice cannot be edited. Cancel it or raise a credit note.'
      using errcode = 'POV03';
  end if;

  if old.status = 'cancelled' and new.status is distinct from old.status then
    raise exception 'A cancelled invoice cannot change status.' using errcode = 'POV03';
  end if;

  if old.status = 'issued' and new.status = 'draft' then
    raise exception 'An issued invoice cannot return to draft.' using errcode = 'POV03';
  end if;

  return new;
end;
$$;

create trigger invoices_guard_update
  before update on public.invoices
  for each row execute function public.invoices_guard_update();

create or replace function public.invoices_guard_delete()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' then
    raise exception 'Invoices are permanent records; only drafts can be deleted.'
      using errcode = 'POV03';
  end if;
  return old;
end;
$$;

create trigger invoices_guard_delete
  before delete on public.invoices
  for each row execute function public.invoices_guard_delete();

-- Orders ↔ invoices link (deferred FK from 0005).
alter table public.orders
  add constraint orders_invoice_fk
  foreign key (invoice_id) references public.invoices (id) on delete set null;

-- ────────────────────────────────────────────────────────────────────────────
-- Invoice items — GST per line (rounding per line, then summed: this is the
-- method that reconciles with GSTR-1; ARCHITECTURE.md §5).
-- ────────────────────────────────────────────────────────────────────────────

create table public.invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices (id) on delete cascade,
  order_item_id uuid references public.order_items (id) on delete set null,
  product_id    uuid references public.products (id) on delete restrict,
  description   text not null,
  hsn_code      text,
  qty           numeric(12,3) not null check (qty > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  discount_amt  numeric(12,2) not null default 0 check (discount_amt >= 0),
  gst_rate_pct  numeric(5,2)  not null check (gst_rate_pct between 0 and 28),
  taxable_amt   numeric(12,2) not null check (taxable_amt >= 0),
  cgst_amt      numeric(12,2) not null default 0 check (cgst_amt >= 0),
  sgst_amt      numeric(12,2) not null default 0 check (sgst_amt >= 0),
  igst_amt      numeric(12,2) not null default 0 check (igst_amt >= 0),
  line_total    numeric(12,2) not null check (line_total >= 0),
  created_at    timestamptz not null default now()
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index invoice_items_product_idx on public.invoice_items (product_id);

-- Items of an issued invoice are frozen too.
create or replace function public.invoice_items_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_invoice_id uuid;
begin
  v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
  select status into v_status from public.invoices where id = v_invoice_id;

  if v_status is distinct from 'draft'
     and coalesce(current_setting('pov.allow_invoice_write', true), '') <> 'on' then
    raise exception 'Lines of an issued invoice cannot be changed.' using errcode = 'POV03';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger invoice_items_guard
  before insert or update or delete on public.invoice_items
  for each row execute function public.invoice_items_guard();

-- ────────────────────────────────────────────────────────────────────────────
-- Credit notes — the lawful way to correct an issued invoice.
-- ────────────────────────────────────────────────────────────────────────────

create table public.credit_notes (
  id             uuid primary key default gen_random_uuid(),
  credit_note_no citext not null unique,
  invoice_id     uuid not null references public.invoices (id) on delete restrict,
  customer_id    uuid not null references public.customers (id) on delete restrict,
  note_date      date not null default current_date,
  reason         text not null,
  taxable_total  numeric(12,2) not null default 0,
  cgst_total     numeric(12,2) not null default 0,
  sgst_total     numeric(12,2) not null default 0,
  igst_total     numeric(12,2) not null default 0,
  grand_total    numeric(12,2) not null check (grand_total > 0),
  branch_id  uuid not null references public.branches (id) default public.default_branch_id(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index credit_notes_invoice_idx on public.credit_notes (invoice_id);

create table public.credit_note_items (
  id              uuid primary key default gen_random_uuid(),
  credit_note_id  uuid not null references public.credit_notes (id) on delete cascade,
  invoice_item_id uuid references public.invoice_items (id) on delete set null,
  description     text not null,
  qty             numeric(12,3) not null check (qty > 0),
  taxable_amt     numeric(12,2) not null check (taxable_amt >= 0),
  tax_amt         numeric(12,2) not null default 0,
  line_total      numeric(12,2) not null check (line_total >= 0)
);

create trigger credit_notes_immutable
  before update or delete on public.credit_notes
  for each row execute function public.forbid_mutation();

create trigger credit_notes_audit
  after insert on public.credit_notes
  for each row execute function public.audit_row_change();

-- ────────────────────────────────────────────────────────────────────────────
-- Payments — append-only signed ledger.
-- direction +1 money in (payment/advance), −1 money out (refund) or a
-- correction (reversal). SUM(amount × direction) is the truth.
-- ────────────────────────────────────────────────────────────────────────────

create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  payment_code   citext not null unique,          -- POV-R000001 (receipt number)
  entry_type     text not null
                 check (entry_type in ('payment', 'advance', 'refund', 'reversal', 'write_off')),
  direction      smallint not null check (direction in (-1, 1)),
  invoice_id     uuid references public.invoices (id) on delete restrict,
  order_id       uuid references public.orders (id) on delete restrict,
  customer_id    uuid not null references public.customers (id) on delete restrict,
  amount         numeric(12,2) not null check (amount > 0),
  method         text not null
                 check (method in ('cash', 'upi', 'card', 'bank_transfer', 'other')),
  reference_no   text,                            -- UPI ref / card slip / cheque no
  paid_at        timestamptz not null default now(),
  received_by    uuid references public.profiles (id),
  notes          text,
  reverses_payment_id uuid references public.payments (id),
  branch_id  uuid not null references public.branches (id) default public.default_branch_id(),
  created_at timestamptz not null default now(),

  constraint payments_direction_sanity check (
    (entry_type in ('payment', 'advance')             and direction = 1) or
    (entry_type in ('refund', 'reversal', 'write_off') and direction = -1)
  ),
  constraint payments_reversal_target check (
    (entry_type = 'reversal') = (reverses_payment_id is not null)
  ),
  constraint payments_anchor check (
    invoice_id is not null or order_id is not null or entry_type = 'advance'
  )
);

create index payments_invoice_idx  on public.payments (invoice_id);
create index payments_customer_idx on public.payments (customer_id, paid_at desc);
create index payments_paid_at_idx  on public.payments (paid_at desc);
create index payments_method_idx   on public.payments (method, paid_at desc);

create trigger payments_immutable
  before update or delete on public.payments
  for each row execute function public.forbid_mutation();

create trigger payments_audit
  after insert on public.payments
  for each row execute function public.audit_row_change();

-- Keep invoices.amount_paid in sync with the ledger.
-- The formula counts payments anchored to the invoice PLUS advances that were
-- anchored to its order before the invoice existed — one formula, used both
-- here and in rpc_issue_invoice, so the two can never disagree.
create or replace function public.recompute_invoice_paid(p_invoice_id uuid)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update public.invoices i
     set amount_paid = (
           select coalesce(sum(p.amount * p.direction), 0)
             from public.payments p
            where p.invoice_id = i.id
               or (p.invoice_id is null and p.order_id is not null and p.order_id = i.order_id)
         )
   where i.id = p_invoice_id;
$$;

create or replace function public.payments_apply_to_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invoice_id uuid;
begin
  v_invoice_id := new.invoice_id;

  -- An advance anchored only to an order still affects that order's invoice.
  if v_invoice_id is null and new.order_id is not null then
    select id into v_invoice_id
      from public.invoices
     where order_id = new.order_id and status <> 'cancelled'
     limit 1;
  end if;

  if v_invoice_id is not null then
    perform public.recompute_invoice_paid(v_invoice_id);
  end if;
  return new;
end;
$$;

create trigger payments_apply_to_invoice
  after insert on public.payments
  for each row execute function public.payments_apply_to_invoice();

-- ────────────────────────────────────────────────────────────────────────────
-- Outstanding view (§19) — derived, never hand-edited.
-- ────────────────────────────────────────────────────────────────────────────

create or replace view public.v_outstanding
with (security_invoker = true)
as
select
  i.id            as invoice_id,
  i.invoice_no,
  i.invoice_date,
  i.customer_id,
  c.full_name,
  c.mobile,
  c.whatsapp_number,
  i.grand_total,
  i.amount_paid,
  i.grand_total - i.amount_paid          as balance,
  (current_date - i.invoice_date)        as days_outstanding
from public.invoices i
join public.customers c on c.id = i.customer_id
where i.status = 'issued'
  and i.grand_total - i.amount_paid > 0;

-- ---------------------------------------------------------------------------
-- 20260818090600_whatsapp.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 0007 · WhatsApp
-- Templates, automation rules, outbox (whatsapp_messages), inbound log.
--
-- ARCHITECTURE.md §6. The application only ever INSERTS into the outbox;
-- the Edge Function worker (whatsapp-dispatch) is the sole sender. The
-- idempotency_key makes double-sends structurally impossible.
-- ============================================================================

set search_path = public, extensions;

create table public.whatsapp_templates (
  id                     uuid primary key default gen_random_uuid(),
  code                   citext not null unique,     -- 'order_confirmation'
  name                   text not null,
  provider_template_name text not null,              -- name registered with Meta
  language               text not null default 'en',
  category               text not null default 'utility'
                         check (category in ('utility', 'marketing', 'authentication')),
  body_text              text not null,              -- local preview with {{placeholders}}
  variable_map           jsonb not null default '[]'::jsonb,
  -- ordered list of variable sources, e.g.
  -- ["customer_name","order_number","total_amount"] — rendered in ordinal order
  approval_status        text not null default 'draft'
                         check (approval_status in ('draft', 'submitted', 'approved', 'rejected')),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger whatsapp_templates_set_updated_at
  before update on public.whatsapp_templates
  for each row execute function public.set_updated_at();

create trigger whatsapp_templates_audit
  after insert or update or delete on public.whatsapp_templates
  for each row execute function public.audit_row_change();

create table public.whatsapp_automation_rules (
  id            uuid primary key default gen_random_uuid(),
  event_key     text not null,        -- 'order.created' | 'order.status.ready' | ...
  template_id   uuid not null references public.whatsapp_templates (id) on delete restrict,
  delay_minutes int not null default 0 check (delay_minutes between 0 and 43200),
  conditions    jsonb not null default '{}'::jsonb,   -- future: min amount, category...
  is_enabled    boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (event_key, template_id)
);

create index wa_rules_event_idx
  on public.whatsapp_automation_rules (event_key) where is_enabled;

create trigger wa_rules_set_updated_at
  before update on public.whatsapp_automation_rules
  for each row execute function public.set_updated_at();

create trigger wa_rules_audit
  after insert or update or delete on public.whatsapp_automation_rules
  for each row execute function public.audit_row_change();

-- ────────────────────────────────────────────────────────────────────────────
-- Outbox + full message history.
-- ────────────────────────────────────────────────────────────────────────────

create table public.whatsapp_messages (
  id                  uuid primary key default gen_random_uuid(),
  idempotency_key     text not null unique,   -- e.g. 'order_ready:{order_id}'
  customer_id         uuid references public.customers (id) on delete set null,
  to_msisdn           text not null check (to_msisdn ~ '^[0-9]{10,15}$'),
  template_id         uuid references public.whatsapp_templates (id) on delete set null,
  variables           jsonb not null default '[]'::jsonb,   -- ordered values
  rendered_body       text,                   -- what we believe was sent (for the timeline)
  status              text not null default 'queued'
                      check (status in ('queued', 'sending', 'sent', 'delivered',
                                        'read', 'failed', 'cancelled')),
  provider            text not null default 'meta_cloud',
  provider_message_id text,
  error_code          text,
  error_message       text,
  attempts            int not null default 0,
  max_attempts        int not null default 5,
  scheduled_at        timestamptz not null default now(),   -- honours rule delay
  next_attempt_at     timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  related_entity_type text,                   -- 'order' | 'invoice' | ...
  related_entity_id   uuid,
  triggered_by        text not null default 'automation'
                      check (triggered_by in ('automation', 'manual')),
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index wa_messages_due_idx
  on public.whatsapp_messages (next_attempt_at)
  where status in ('queued', 'sending');
create index wa_messages_customer_idx
  on public.whatsapp_messages (customer_id, created_at desc);
create index wa_messages_provider_idx
  on public.whatsapp_messages (provider_message_id)
  where provider_message_id is not null;
create index wa_messages_status_day_idx
  on public.whatsapp_messages (status, created_at desc);

create trigger wa_messages_set_updated_at
  before update on public.whatsapp_messages
  for each row execute function public.set_updated_at();

-- Inbound replies (webhook writes here) — enables the 24h service window.
create table public.whatsapp_inbound (
  id                  uuid primary key default gen_random_uuid(),
  from_msisdn         text not null,
  customer_id         uuid references public.customers (id) on delete set null,
  provider_message_id text unique,
  message_type        text,          -- text | image | button | ...
  body                text,
  raw                 jsonb,
  received_at         timestamptz not null default now()
);

create index wa_inbound_customer_idx
  on public.whatsapp_inbound (customer_id, received_at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- Enqueue helper — called by rpc_set_order_status / rpc_issue_invoice etc.
-- INSIDE their transaction. Never performs network I/O.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_enqueue_for_event(
  p_event_key       text,
  p_customer_id     uuid,
  p_variables       jsonb,               -- ordered array of values
  p_idempotency_key text,
  p_entity_type     text default null,
  p_entity_id       uuid default null
)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rule   record;
  v_to     text;
  v_count  int := 0;
  v_body   text;
  v_i      int;
  v_vars   text[];
begin
  select coalesce(whatsapp_number, mobile) into v_to
    from public.customers
   where id = p_customer_id and deleted_at is null;

  if v_to is null then
    return 0;   -- no reachable number; nothing to queue (surfaced in UI as "no number")
  end if;

  for v_rule in
    select r.id as rule_id, r.template_id, r.delay_minutes, t.body_text, t.category
      from public.whatsapp_automation_rules r
      join public.whatsapp_templates t on t.id = r.template_id
     where r.event_key = p_event_key
       and r.is_enabled
       and t.is_active
  loop
    -- Marketing messages require explicit opt-in (Meta policy).
    if v_rule.category = 'marketing' and not exists (
      select 1 from public.customers
       where id = p_customer_id and whatsapp_opt_in
    ) then
      continue;
    end if;

    -- Render a local preview body ({{1}}, {{2}}… replaced in order).
    v_body := v_rule.body_text;
    select array_agg(value order by ordinality)
      into v_vars
      from jsonb_array_elements_text(coalesce(p_variables, '[]'::jsonb)) with ordinality;
    if v_vars is not null then
      for v_i in 1 .. array_length(v_vars, 1) loop
        v_body := replace(v_body, '{{' || v_i || '}}', v_vars[v_i]);
      end loop;
    end if;

    insert into public.whatsapp_messages
      (idempotency_key, customer_id, to_msisdn, template_id, variables,
       rendered_body, scheduled_at, next_attempt_at,
       related_entity_type, related_entity_id, triggered_by)
    values
      (p_idempotency_key || ':' || v_rule.rule_id,
       p_customer_id, v_to, v_rule.template_id, coalesce(p_variables, '[]'::jsonb),
       v_body,
       now() + make_interval(mins => v_rule.delay_minutes),
       now() + make_interval(mins => v_rule.delay_minutes),
       p_entity_type, p_entity_id, 'automation')
    on conflict (idempotency_key) do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.wa_enqueue_for_event is
  'Queues WhatsApp messages for every enabled rule of an event. Transactional, idempotent, no network I/O.';

-- ---------------------------------------------------------------------------
-- 20260818090700_business_rpcs.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 0008 · Business RPCs
-- The only write paths for anything involving money, stock or workflow state.
-- All are SECURITY DEFINER with explicit permission checks (RLS still guards
-- the underlying tables for direct access; these functions are the "front
-- door" that guarantees atomicity + numbering + audit + WhatsApp enqueue).
--
-- GST arithmetic notes (ARCHITECTURE.md §5, decision: prices are MRP-inclusive):
--   inclusive:  taxable = round(net / (1 + rate/100), 2); tax = net − taxable
--   exclusive:  taxable = net; tax = round(net × rate/100, 2)
--   Rounded PER LINE, then summed — reconciles with GSTR-1.
-- ============================================================================

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- Guard helper: raise POV06 unless the caller holds a permission.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.assert_permission(p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.auth_has(p_permission) then
    raise exception 'You do not have permission to perform this action (%).', p_permission
      using errcode = 'POV06';
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Customers
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_create_customer(
  p_full_name       text,
  p_mobile          text,
  p_whatsapp_number text default null,
  p_email           text default null,
  p_dob             date default null,
  p_gender          text default null,
  p_city            text default null,
  p_notes           text default null,
  p_address_line    text default null,
  p_whatsapp_opt_in boolean default false
)
returns public.customers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_customer public.customers;
  v_code     text;
begin
  perform public.assert_permission('customers.create');

  v_code := public.generate_doc_number('customer');

  insert into public.customers
    (customer_code, full_name, mobile, whatsapp_number, email, dob, gender,
     city, notes, whatsapp_opt_in, whatsapp_opt_in_at, created_by)
  values
    (v_code, trim(p_full_name), p_mobile,
     coalesce(p_whatsapp_number, p_mobile),
     nullif(trim(coalesce(p_email, '')), ''),
     p_dob, p_gender, p_city, p_notes,
     p_whatsapp_opt_in,
     case when p_whatsapp_opt_in then now() end,
     auth.uid())
  returning * into v_customer;

  if p_address_line is not null and length(trim(p_address_line)) > 0 then
    insert into public.customer_addresses (customer_id, address_line, city, is_primary)
    values (v_customer.id, trim(p_address_line), p_city, true);
  end if;

  return v_customer;
exception
  when unique_violation then
    raise exception 'A customer with this mobile number already exists.'
      using errcode = 'POV07';
end;
$$;

-- Fast duplicate probe used by the "create customer" form before submitting.
create or replace function public.rpc_find_customer_duplicates(
  p_mobile    text,
  p_full_name text default null
)
returns setof public.customers
language sql
stable
security definer
set search_path = public, extensions
as $$
  select c.*
    from public.customers c
   where c.deleted_at is null
     and public.auth_has('customers.read')
     and (
       c.mobile = p_mobile
       or c.alt_phone = p_mobile
       or (p_full_name is not null
           and similarity(c.full_name, p_full_name) > 0.55)
     )
   order by c.mobile = p_mobile desc, c.last_visit_at desc nulls last
   limit 5;
$$;

-- Unified search (§8): name / mobile / whatsapp / customer code / invoice no /
-- order no, partial everywhere, ranked.
create or replace function public.rpc_search_customers(
  p_query text,
  p_limit int default 20
)
returns table (
  id            uuid,
  customer_code citext,
  full_name     text,
  mobile        citext,
  city          text,
  last_visit_at timestamptz,
  match_via     text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (select trim(p_query) as term)
  select hits.id, hits.customer_code, hits.full_name, hits.mobile,
         hits.city, hits.last_visit_at, hits.match_via
  from (
    select c.id, c.customer_code, c.full_name, c.mobile, c.city, c.last_visit_at,
           'customer'::text as match_via,
           greatest(similarity(c.full_name, (select term from q)),
                    case when c.mobile   like '%' || (select term from q) || '%' then 1 else 0 end,
                    case when c.customer_code::text ilike '%' || (select term from q) || '%' then 0.9 else 0 end
           ) as rank
      from public.customers c
     where public.auth_has('customers.read')
       and c.deleted_at is null
       and (
         c.full_name ilike '%' || (select term from q) || '%'
         or similarity(c.full_name, (select term from q)) > 0.3
         or c.mobile          like '%' || (select term from q) || '%'
         or c.whatsapp_number like '%' || (select term from q) || '%'
         or c.alt_phone       like '%' || (select term from q) || '%'
         or c.customer_code::text ilike '%' || (select term from q) || '%'
       )
    union all
    select c.id, c.customer_code, c.full_name, c.mobile, c.city, c.last_visit_at,
           'invoice ' || i.invoice_no, 1.0
      from public.invoices i
      join public.customers c on c.id = i.customer_id
     where public.auth_has('customers.read')
       and i.invoice_no::text ilike '%' || (select term from q) || '%'
    union all
    select c.id, c.customer_code, c.full_name, c.mobile, c.city, c.last_visit_at,
           'order ' || o.order_code, 1.0
      from public.orders o
      join public.customers c on c.id = o.customer_id
     where public.auth_has('customers.read')
       and o.order_code::text ilike '%' || (select term from q) || '%'
  ) hits
  order by hits.rank desc, hits.last_visit_at desc nulls last
  limit p_limit;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- GST line computation — single source of truth, used by order + invoice RPCs.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.compute_gst_line(
  p_qty            numeric,
  p_unit_price     numeric,
  p_discount_amt   numeric,
  p_gst_rate_pct   numeric,
  p_tax_inclusive  boolean,
  p_intra_state    boolean,
  out taxable_amt  numeric,
  out cgst_amt     numeric,
  out sgst_amt     numeric,
  out igst_amt     numeric,
  out line_total   numeric
)
language plpgsql
immutable
as $$
declare
  v_net numeric;
  v_tax numeric;
begin
  v_net := round(p_qty * p_unit_price, 2) - coalesce(p_discount_amt, 0);
  if v_net < 0 then
    raise exception 'Discount cannot exceed the line amount.' using errcode = 'POV07';
  end if;

  if p_tax_inclusive then
    taxable_amt := round(v_net / (1 + p_gst_rate_pct / 100.0), 2);
    v_tax       := v_net - taxable_amt;
    line_total  := v_net;
  else
    taxable_amt := v_net;
    v_tax       := round(v_net * p_gst_rate_pct / 100.0, 2);
    line_total  := v_net + v_tax;
  end if;

  if p_intra_state then
    cgst_amt := round(v_tax / 2, 2);
    sgst_amt := v_tax - cgst_amt;      -- odd paisa goes to SGST; total always exact
    igst_amt := 0;
  else
    cgst_amt := 0;
    sgst_amt := 0;
    igst_amt := v_tax;
  end if;
end;
$$;

comment on function public.compute_gst_line is
  'Authoritative GST arithmetic. The TypeScript mirror in src/lib/gst.ts exists only for live preview; both share test vectors.';

-- ────────────────────────────────────────────────────────────────────────────
-- Orders
-- Items arrive as jsonb:
-- [{item_kind, product_id?, description, lens_spec?, qty, unit_price,
--   discount_pct?, discount_amt?, gst_rate_pct}]
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_create_order(
  p_customer_id            uuid,
  p_items                  jsonb,
  p_prescription_id        uuid default null,
  p_expected_delivery_date date default null,
  p_notes                  text default null,
  p_advance_amount         numeric default 0,
  p_advance_method         text default 'cash'
)
returns public.orders
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order          public.orders;
  v_item           jsonb;
  v_tax_inclusive  boolean;
  v_qty            numeric; v_price numeric; v_disc numeric; v_rate numeric;
  v_line           record;
  v_subtotal       numeric := 0;
  v_discount_total numeric := 0;
  v_tax_total      numeric := 0;
  v_grand_total    numeric := 0;
  v_kind           text;
  v_product_id     uuid;
begin
  perform public.assert_permission('orders.create');

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item.' using errcode = 'POV07';
  end if;

  if p_prescription_id is not null and not exists (
    select 1 from public.prescriptions
     where id = p_prescription_id and customer_id = p_customer_id and voided_at is null
  ) then
    raise exception 'The selected prescription does not belong to this customer.'
      using errcode = 'POV07';
  end if;

  select coalesce((value ->> 'tax_inclusive')::boolean, true)
    into v_tax_inclusive
    from public.settings where key = 'billing.gst';
  v_tax_inclusive := coalesce(v_tax_inclusive, true);

  insert into public.orders
    (order_code, customer_id, prescription_id, expected_delivery_date, notes, created_by)
  values
    (public.generate_doc_number('order'),
     p_customer_id, p_prescription_id, p_expected_delivery_date, p_notes, auth.uid())
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_kind       := v_item ->> 'item_kind';
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_qty        := coalesce((v_item ->> 'qty')::numeric, 1);
    v_price      := (v_item ->> 'unit_price')::numeric;
    v_rate       := coalesce((v_item ->> 'gst_rate_pct')::numeric, 0);
    v_disc       := coalesce((v_item ->> 'discount_amt')::numeric,
                     round(v_qty * v_price * coalesce((v_item ->> 'discount_pct')::numeric, 0) / 100.0, 2));

    if v_price is null or v_price < 0 then
      raise exception 'Every item needs a valid price.' using errcode = 'POV07';
    end if;

    select * into v_line
      from public.compute_gst_line(v_qty, v_price, v_disc, v_rate, v_tax_inclusive, true);

    insert into public.order_items
      (order_id, item_kind, product_id, description, lens_spec, qty, unit_price,
       discount_pct, discount_amt, gst_rate_pct, line_total)
    values
      (v_order.id, v_kind, v_product_id,
       v_item ->> 'description',
       v_item -> 'lens_spec',
       v_qty, v_price,
       coalesce((v_item ->> 'discount_pct')::numeric, 0),
       v_disc, v_rate, v_line.line_total);

    -- Stocked products are deducted immediately (the frame leaves the shelf
    -- when the job starts). Lenses/services never touch stock.
    if v_kind = 'product' and v_product_id is not null and exists (
      select 1 from public.products where id = v_product_id and is_stock_tracked
    ) then
      insert into public.inventory_transactions
        (product_id, qty_delta, reason, ref_type, ref_id, created_by)
      values
        (v_product_id, -v_qty, 'sale', 'order', v_order.id, auth.uid());
    end if;

    v_subtotal       := v_subtotal + round(v_qty * v_price, 2);
    v_discount_total := v_discount_total + v_disc;
    v_tax_total      := v_tax_total + v_line.cgst_amt + v_line.sgst_amt + v_line.igst_amt;
    v_grand_total    := v_grand_total + v_line.line_total;
  end loop;

  update public.orders
     set subtotal       = v_subtotal,
         discount_total = v_discount_total,
         tax_total      = v_tax_total,
         grand_total    = v_grand_total,
         advance_amount = coalesce(p_advance_amount, 0)
   where id = v_order.id
   returning * into v_order;

  -- Advance received with the order → payments ledger.
  if coalesce(p_advance_amount, 0) > 0 then
    insert into public.payments
      (payment_code, entry_type, direction, order_id, customer_id, amount,
       method, received_by, notes)
    values
      (public.generate_doc_number('payment'), 'advance', 1, v_order.id, p_customer_id,
       p_advance_amount, coalesce(p_advance_method, 'cash'), auth.uid(),
       'Advance with order ' || v_order.order_code);
  end if;

  update public.customers
     set last_visit_at = now(),
         first_purchase_at = coalesce(first_purchase_at, now())
   where id = p_customer_id;

  -- Automation: order.created
  perform public.wa_enqueue_for_event(
    'order.created', p_customer_id,
    jsonb_build_array(
      (select full_name from public.customers where id = p_customer_id),
      v_order.order_code::text,
      to_char(v_order.grand_total, 'FM9999999990.00')),
    'order_created:' || v_order.id,
    'order', v_order.id);

  return v_order;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Order status transitions — the ONLY path that changes orders.status.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_set_order_status(
  p_order_id   uuid,
  p_new_status text,
  p_note       text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order  public.orders;
  v_from   public.order_statuses;
  v_to     public.order_statuses;
begin
  perform public.assert_permission('orders.update_status');

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'POV07';
  end if;

  select * into v_from from public.order_statuses where code = v_order.status;
  select * into v_to   from public.order_statuses where code = p_new_status and is_active;
  if v_to is null then
    raise exception 'Unknown order status "%".', p_new_status using errcode = 'POV02';
  end if;

  if not (p_new_status = any (v_from.allowed_next)) then
    raise exception 'An order in "%" cannot move to "%".', v_from.label, v_to.label
      using errcode = 'POV02';
  end if;

  if v_to.is_cancelled and (p_note is null or length(trim(p_note)) < 3) then
    raise exception 'Cancelling an order requires a reason.' using errcode = 'POV07';
  end if;

  -- Cancellation returns stocked items to the shelf.
  if v_to.is_cancelled then
    insert into public.inventory_transactions
      (product_id, qty_delta, reason, ref_type, ref_id, created_by, note)
    select oi.product_id, oi.qty, 'sale_return', 'order', v_order.id, auth.uid(),
           'Order ' || v_order.order_code || ' cancelled'
      from public.order_items oi
      join public.products p on p.id = oi.product_id
     where oi.order_id = v_order.id
       and oi.item_kind = 'product'
       and p.is_stock_tracked;
  end if;

  perform set_config('pov.allow_status_change', 'on', true);
  update public.orders
     set status        = p_new_status,
         cancel_reason = case when v_to.is_cancelled then p_note else cancel_reason end,
         delivered_at  = case when p_new_status = 'delivered' then now() else delivered_at end
   where id = p_order_id
   returning * into v_order;
  perform set_config('pov.allow_status_change', '', true);

  insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (p_order_id, v_from.code, p_new_status, p_note, auth.uid());

  -- Automation hook for this status, if configured.
  if v_to.wa_event_key is not null then
    perform public.wa_enqueue_for_event(
      v_to.wa_event_key,
      v_order.customer_id,
      jsonb_build_array(
        (select full_name from public.customers where id = v_order.customer_id),
        v_order.order_code::text),
      'order_' || p_new_status || ':' || v_order.id,
      'order', v_order.id);
  end if;

  return v_order;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Invoices
-- ────────────────────────────────────────────────────────────────────────────

-- Build a draft invoice from an order (1 click in the billing screen), or
-- issue a walk-in counter sale directly with p_items.
create or replace function public.rpc_create_invoice(
  p_customer_id uuid,
  p_order_id    uuid default null,
  p_items       jsonb default null    -- same shape as rpc_create_order items
)
returns public.invoices
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invoice        public.invoices;
  v_tax_inclusive  boolean;
  v_item           jsonb;
  v_line           record;
  v_qty numeric; v_price numeric; v_disc numeric; v_rate numeric;
  v_subtotal numeric := 0; v_discount numeric := 0; v_taxable numeric := 0;
  v_cgst numeric := 0; v_sgst numeric := 0; v_igst numeric := 0;
  v_total numeric := 0;
begin
  perform public.assert_permission('invoices.create');

  select coalesce((value ->> 'tax_inclusive')::boolean, true)
    into v_tax_inclusive
    from public.settings where key = 'billing.gst';
  v_tax_inclusive := coalesce(v_tax_inclusive, true);

  if p_order_id is not null and exists (
    select 1 from public.invoices
     where order_id = p_order_id and status <> 'cancelled'
  ) then
    raise exception 'This order already has an invoice.' using errcode = 'POV07';
  end if;

  insert into public.invoices
    (customer_id, order_id, is_tax_inclusive, created_by)
  values
    (p_customer_id, p_order_id, v_tax_inclusive, auth.uid())
  returning * into v_invoice;

  perform set_config('pov.allow_invoice_write', 'on', true);

  if p_order_id is not null then
    -- Copy lines from the order.
    insert into public.invoice_items
      (invoice_id, order_item_id, product_id, description, hsn_code, qty,
       unit_price, discount_amt, gst_rate_pct, taxable_amt, cgst_amt, sgst_amt,
       igst_amt, line_total)
    select v_invoice.id, oi.id, oi.product_id, oi.description, p.hsn_code,
           oi.qty, oi.unit_price, oi.discount_amt, oi.gst_rate_pct,
           l.taxable_amt, l.cgst_amt, l.sgst_amt, l.igst_amt, l.line_total
      from public.order_items oi
      left join public.products p on p.id = oi.product_id
      cross join lateral public.compute_gst_line(
        oi.qty, oi.unit_price, oi.discount_amt, oi.gst_rate_pct,
        v_tax_inclusive, true) l
     where oi.order_id = p_order_id;
  elsif p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_qty   := coalesce((v_item ->> 'qty')::numeric, 1);
      v_price := (v_item ->> 'unit_price')::numeric;
      v_rate  := coalesce((v_item ->> 'gst_rate_pct')::numeric, 0);
      v_disc  := coalesce((v_item ->> 'discount_amt')::numeric,
                  round(v_qty * v_price * coalesce((v_item ->> 'discount_pct')::numeric, 0) / 100.0, 2));

      select * into v_line
        from public.compute_gst_line(v_qty, v_price, v_disc, v_rate, v_tax_inclusive, true);

      insert into public.invoice_items
        (invoice_id, product_id, description, hsn_code, qty, unit_price,
         discount_amt, gst_rate_pct, taxable_amt, cgst_amt, sgst_amt, igst_amt, line_total)
      values
        (v_invoice.id, nullif(v_item ->> 'product_id', '')::uuid,
         v_item ->> 'description',
         v_item ->> 'hsn_code',
         v_qty, v_price, v_disc, v_rate,
         v_line.taxable_amt, v_line.cgst_amt, v_line.sgst_amt, v_line.igst_amt,
         v_line.line_total);

      -- Counter sale of a stocked product deducts stock at invoice time.
      if nullif(v_item ->> 'product_id', '') is not null and exists (
        select 1 from public.products
         where id = (v_item ->> 'product_id')::uuid and is_stock_tracked
      ) and p_order_id is null then
        insert into public.inventory_transactions
          (product_id, qty_delta, reason, ref_type, ref_id, created_by)
        values
          ((v_item ->> 'product_id')::uuid, -v_qty, 'sale', 'invoice', v_invoice.id, auth.uid());
      end if;
    end loop;
  else
    raise exception 'An invoice needs an order or at least one item.' using errcode = 'POV07';
  end if;

  select coalesce(sum(round(qty * unit_price, 2)), 0),
         coalesce(sum(discount_amt), 0),
         coalesce(sum(taxable_amt), 0),
         coalesce(sum(cgst_amt), 0),
         coalesce(sum(sgst_amt), 0),
         coalesce(sum(igst_amt), 0),
         coalesce(sum(line_total), 0)
    into v_subtotal, v_discount, v_taxable, v_cgst, v_sgst, v_igst, v_total
    from public.invoice_items
   where invoice_id = v_invoice.id;

  update public.invoices
     set subtotal       = v_subtotal,
         discount_total = v_discount,
         taxable_total  = v_taxable,
         cgst_total     = v_cgst,
         sgst_total     = v_sgst,
         igst_total     = v_igst,
         round_off      = round(v_total) - v_total,
         grand_total    = round(v_total)
   where id = v_invoice.id
   returning * into v_invoice;

  perform set_config('pov.allow_invoice_write', '', true);

  return v_invoice;
end;
$$;

-- Issue: allocate the gapless number and freeze the invoice.
create or replace function public.rpc_issue_invoice(
  p_invoice_id uuid,
  p_invoice_date date default current_date
)
returns public.invoices
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invoice public.invoices;
begin
  perform public.assert_permission('invoices.create');

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'POV07';
  end if;
  if v_invoice.status <> 'draft' then
    raise exception 'Only a draft invoice can be issued.' using errcode = 'POV02';
  end if;
  if v_invoice.grand_total <= 0 then
    raise exception 'An invoice must have a positive total.' using errcode = 'POV07';
  end if;

  update public.invoices
     set status       = 'issued',
         invoice_no   = public.generate_doc_number('invoice', p_invoice_date),
         invoice_date = p_invoice_date,
         issued_at    = now()
   where id = p_invoice_id
   returning * into v_invoice;

  -- Attach the invoice to its order. Advances recorded against the order stay
  -- as their own immutable ledger rows; recompute_invoice_paid counts them, so
  -- the outstanding balance is correct from the first second.
  if v_invoice.order_id is not null then
    update public.orders set invoice_id = v_invoice.id where id = v_invoice.order_id;
    perform public.recompute_invoice_paid(v_invoice.id);
    select * into v_invoice from public.invoices where id = v_invoice.id;
  end if;

  perform public.audit_event('invoice.issued', 'invoices', v_invoice.id::text,
    jsonb_build_object('invoice_no', v_invoice.invoice_no, 'grand_total', v_invoice.grand_total));

  return v_invoice;
end;
$$;

-- Cancel an issued invoice (number stays allocated — GST series stays dense).
create or replace function public.rpc_cancel_invoice(
  p_invoice_id uuid,
  p_reason     text
)
returns public.invoices
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invoice public.invoices;
begin
  perform public.assert_permission('invoices.cancel');

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Cancelling an invoice requires a reason.' using errcode = 'POV07';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'POV07';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'Only an issued invoice can be cancelled.' using errcode = 'POV02';
  end if;
  if v_invoice.amount_paid > 0 then
    raise exception 'Refund the payments on this invoice before cancelling it.'
      using errcode = 'POV02';
  end if;

  -- Return stock that was deducted by this invoice (counter sales).
  insert into public.inventory_transactions
    (product_id, qty_delta, reason, ref_type, ref_id, created_by, note)
  select ii.product_id, ii.qty, 'sale_return', 'invoice', v_invoice.id, auth.uid(),
         'Invoice ' || v_invoice.invoice_no || ' cancelled'
    from public.invoice_items ii
    join public.products p on p.id = ii.product_id
   where ii.invoice_id = v_invoice.id
     and ii.product_id is not null
     and p.is_stock_tracked
     and v_invoice.order_id is null;   -- order-linked stock returns via order cancel

  update public.invoices
     set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason)
   where id = p_invoice_id
   returning * into v_invoice;

  perform public.audit_event('invoice.cancelled', 'invoices', v_invoice.id::text,
    jsonb_build_object('invoice_no', v_invoice.invoice_no, 'reason', p_reason));

  return v_invoice;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Payments
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_record_payment(
  p_invoice_id   uuid,
  p_amount       numeric,
  p_method       text,
  p_reference_no text default null,
  p_notes        text default null,
  p_allow_advance boolean default false
)
returns public.payments
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invoice public.invoices;
  v_payment public.payments;
  v_balance numeric;
begin
  perform public.assert_permission('payments.create');

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = 'POV07';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'POV07';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'Payments can only be recorded against an issued invoice.'
      using errcode = 'POV02';
  end if;

  v_balance := v_invoice.grand_total - v_invoice.amount_paid;

  -- §38: block overpayment unless explicitly allowed AND permitted.
  if p_amount > v_balance and not (p_allow_advance and public.auth_has('payments.allow_overpay')) then
    raise exception 'Payment (₹%) exceeds the outstanding balance (₹%).', p_amount, v_balance
      using errcode = 'POV05';
  end if;

  insert into public.payments
    (payment_code, entry_type, direction, invoice_id, order_id, customer_id,
     amount, method, reference_no, received_by, notes)
  values
    (public.generate_doc_number('payment'), 'payment', 1,
     p_invoice_id, v_invoice.order_id, v_invoice.customer_id,
     p_amount, p_method, p_reference_no, auth.uid(), p_notes)
  returning * into v_payment;

  -- Fully paid → nudge automation (payment thank-you / receipt), optional rule.
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice.amount_paid >= v_invoice.grand_total then
    perform public.wa_enqueue_for_event(
      'invoice.paid', v_invoice.customer_id,
      jsonb_build_array(
        (select full_name from public.customers where id = v_invoice.customer_id),
        v_invoice.invoice_no::text),
      'invoice_paid:' || v_invoice.id,
      'invoice', v_invoice.id);
  end if;

  return v_payment;
end;
$$;

create or replace function public.rpc_refund_payment(
  p_payment_id uuid,
  p_amount     numeric,
  p_method     text,
  p_reason     text
)
returns public.payments
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_original public.payments;
  v_refund   public.payments;
begin
  perform public.assert_permission('payments.refund');

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A refund requires a reason.' using errcode = 'POV07';
  end if;

  select * into v_original from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Original payment not found.' using errcode = 'POV07';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > v_original.amount then
    raise exception 'Refund amount must be between 0 and the original payment.'
      using errcode = 'POV07';
  end if;

  insert into public.payments
    (payment_code, entry_type, direction, invoice_id, order_id, customer_id,
     amount, method, received_by, notes, reverses_payment_id)
  values
    (public.generate_doc_number('payment'), 'refund', -1,
     v_original.invoice_id, v_original.order_id, v_original.customer_id,
     p_amount, p_method, auth.uid(),
     'Refund of ' || v_original.payment_code || ': ' || trim(p_reason),
     null)
  returning * into v_refund;

  return v_refund;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Inventory adjustments (manual, always with a reason — §13)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_adjust_stock(
  p_product_id uuid,
  p_qty_delta  numeric,
  p_reason     text,          -- 'purchase_inward' | 'adjustment' | 'damage' | 'opening_stock'
  p_note       text default null,
  p_unit_cost  numeric default null
)
returns public.inventory_transactions
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tx public.inventory_transactions;
begin
  perform public.assert_permission('inventory.adjust');

  if p_reason not in ('purchase_inward', 'adjustment', 'damage', 'opening_stock') then
    raise exception 'Invalid manual stock reason "%".', p_reason using errcode = 'POV07';
  end if;

  insert into public.inventory_transactions
    (product_id, qty_delta, reason, ref_type, unit_cost, note, created_by)
  values
    (p_product_id, p_qty_delta, p_reason, 'manual', p_unit_cost, p_note, auth.uid())
  returning * into v_tx;

  return v_tx;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Products (SKU allocation)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_next_sku()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_permission('products.create');
  return public.generate_doc_number('product');
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Dashboard — every №  on the dashboard comes from this one query (§6, §44).
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_dashboard_metrics(
  p_day date default current_date
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case when not public.auth_has('dashboard.read') then
    jsonb_build_object('error', 'forbidden')
  else jsonb_build_object(
    'customers_today', (
      select count(distinct o.customer_id) from public.orders o
       where o.created_at::date = p_day),
    'new_customers', (
      select count(*) from public.customers c
       where c.created_at::date = p_day and c.deleted_at is null),
    'returning_customers', (
      select count(distinct o.customer_id) from public.orders o
        join public.customers c on c.id = o.customer_id
       where o.created_at::date = p_day
         and c.created_at::date < p_day),
    'orders_today', (
      select count(*) from public.orders o where o.created_at::date = p_day),
    'sales_today', (
      select coalesce(sum(i.grand_total), 0) from public.invoices i
       where i.status = 'issued' and i.invoice_date = p_day),
    'payments_today', (
      select coalesce(sum(p.amount * p.direction), 0) from public.payments p
       where p.paid_at::date = p_day),
    'outstanding_total', (
      select coalesce(sum(i.grand_total - i.amount_paid), 0) from public.invoices i
       where i.status = 'issued' and i.grand_total > i.amount_paid),
    'pending_orders', (
      select count(*) from public.orders o
       where o.status not in ('delivered', 'completed', 'cancelled')),
    'ready_for_pickup', (
      select count(*) from public.orders o
       where o.status in ('ready', 'customer_notified')),
    'delivered_today', (
      select count(*) from public.orders o
       where o.delivered_at::date = p_day),
    'low_stock_count', (
      select count(*) from public.v_low_stock),
    'wa_sent_today', (
      select count(*) from public.whatsapp_messages m
       where m.sent_at::date = p_day and m.status in ('sent', 'delivered', 'read')),
    'wa_failed_today', (
      select count(*) from public.whatsapp_messages m
       where m.updated_at::date = p_day and m.status = 'failed')
  ) end;
$$;

-- Sales overview for a date range (§6 Sales Overview + §24 Daily Sales report).
create or replace function public.rpc_sales_overview(
  p_from date,
  p_to   date
)
returns table (
  day            date,
  orders_count   bigint,
  invoices_count bigint,
  gross_sales    numeric,
  discounts      numeric,
  gst            numeric,
  collected      numeric
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select d.day::date,
         (select count(*) from public.orders o  where o.created_at::date = d.day),
         (select count(*) from public.invoices i where i.status = 'issued' and i.invoice_date = d.day),
         coalesce((select sum(i.grand_total)    from public.invoices i where i.status = 'issued' and i.invoice_date = d.day), 0),
         coalesce((select sum(i.discount_total) from public.invoices i where i.status = 'issued' and i.invoice_date = d.day), 0),
         coalesce((select sum(i.cgst_total + i.sgst_total + i.igst_total)
                     from public.invoices i where i.status = 'issued' and i.invoice_date = d.day), 0),
         coalesce((select sum(p.amount * p.direction) from public.payments p where p.paid_at::date = d.day), 0)
    from generate_series(p_from, p_to, interval '1 day') d(day)
   where public.auth_has('reports.read')
   order by d.day;
$$;

-- ---------------------------------------------------------------------------
-- 20260818090800_rls.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 20260818090900_seed.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 0010 · Seed — reference data every environment needs.
-- (Business data — customers, products — is NEVER seeded here; decision: the
-- system starts empty. Demo data lives only in supabase/seed.sql for local dev.)
-- ============================================================================

set search_path = public, extensions;

-- ── Branch ──────────────────────────────────────────────────────────────────

insert into public.branches (code, name, is_default)
values ('MAIN', 'Perfect Optical Vision', true);

-- ── Roles & permissions (ARCHITECTURE.md §4.3) ──────────────────────────────

insert into public.roles (code, name, description, is_system) values
  ('admin', 'Admin', 'Full access to everything including settings, users and financial corrections.', true),
  ('staff', 'Staff', 'Day-to-day counter operations: customers, prescriptions, orders, billing.', true);

insert into public.permissions (code, module, description) values
  ('dashboard.read',        'dashboard',     'View the dashboard'),
  ('customers.read',        'customers',     'View customers'),
  ('customers.create',      'customers',     'Create customers'),
  ('customers.update',      'customers',     'Edit customers'),
  ('prescriptions.read',    'prescriptions', 'View prescriptions'),
  ('prescriptions.create',  'prescriptions', 'Add prescriptions'),
  ('prescriptions.void',    'prescriptions', 'Void an incorrect prescription'),
  ('products.read',         'products',      'View products and prices'),
  ('products.create',       'products',      'Add products'),
  ('products.manage',       'products',      'Edit products, prices, categories, brands, suppliers'),
  ('inventory.read',        'inventory',     'View stock levels and history'),
  ('inventory.adjust',      'inventory',     'Adjust stock with a reason'),
  ('orders.read',           'orders',        'View orders'),
  ('orders.create',         'orders',        'Create orders'),
  ('orders.update',         'orders',        'Edit order details'),
  ('orders.update_status',  'orders',        'Move orders through the workflow'),
  ('lab.read',              'lab',           'View lab orders'),
  ('lab.manage',            'lab',           'Manage lab orders and vendors'),
  ('invoices.read',         'billing',       'View invoices'),
  ('invoices.create',       'billing',       'Create and issue invoices'),
  ('invoices.cancel',       'billing',       'Cancel invoices / delete drafts'),
  ('payments.read',         'payments',      'View payments'),
  ('payments.create',       'payments',      'Record payments'),
  ('payments.refund',       'payments',      'Record refunds'),
  ('payments.allow_overpay','payments',      'Accept payment above the outstanding balance (advance)'),
  ('reports.read',          'reports',       'View reports'),
  ('whatsapp.read',         'whatsapp',      'View WhatsApp history and dashboard'),
  ('whatsapp.send',         'whatsapp',      'Send manual WhatsApp messages'),
  ('whatsapp.manage',       'whatsapp',      'Edit templates and automation rules'),
  ('audit.read',            'audit',         'View the audit log'),
  ('users.manage',          'settings',      'Manage users and roles'),
  ('settings.manage',       'settings',      'Change system settings'),
  ('exports.run',           'settings',      'Export data / run backups');

-- Admin: everything.
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
  from public.roles r cross join public.permissions p
 where r.code = 'admin';

-- Staff: operational set (§26 — no settings, users, financial deletion).
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
  from public.roles r cross join public.permissions p
 where r.code = 'staff'
   and p.code in (
     'dashboard.read',
     'customers.read', 'customers.create', 'customers.update',
     'prescriptions.read', 'prescriptions.create',
     'products.read',
     'inventory.read', 'inventory.adjust',
     'orders.read', 'orders.create', 'orders.update', 'orders.update_status',
     'lab.read', 'lab.manage',
     'invoices.read', 'invoices.create',
     'payments.read', 'payments.create',
     'reports.read',
     'whatsapp.read', 'whatsapp.send'
   );

-- ── Numbering & billing settings (decisions of 18 Aug 2026) ────────────────
-- Invoice: POV/26-27/00001 — 15 chars, FY series (CGST Rule 46(b) ≤16 chars).

insert into public.settings (key, value) values
  ('shop.profile', jsonb_build_object(
     'name',    'Perfect Optical Vision',
     'address', '',
     'phone',   '',
     'whatsapp','',
     'email',   '',
     'gstin',   '',
     'state_code', '',
     'logo_path', null)),
  ('billing.gst', jsonb_build_object(
     'registration', 'regular',
     'tax_inclusive', true,
     'default_gst_rate', 12)),
  ('numbering.invoice',  jsonb_build_object('prefix','POV','pattern','{prefix}/{fy}/{seq}','pad',5,'reset','fy')),
  ('numbering.customer', jsonb_build_object('prefix','POV-C','pattern','{prefix}{seq}','pad',6,'reset','never')),
  ('numbering.order',    jsonb_build_object('prefix','POV-O','pattern','{prefix}{seq}','pad',6,'reset','never')),
  ('numbering.payment',  jsonb_build_object('prefix','POV-R','pattern','{prefix}{seq}','pad',6,'reset','never')),
  ('numbering.product',  jsonb_build_object('prefix','POV-P','pattern','{prefix}{seq}','pad',6,'reset','never')),
  ('numbering.credit_note', jsonb_build_object('prefix','POV-CN','pattern','{prefix}/{fy}/{seq}','pad',4,'reset','fy')),
  ('notifications.low_stock', jsonb_build_object('enabled', true)),
  ('whatsapp.provider', jsonb_build_object(
     'provider', 'meta_cloud',
     'phone_number_display', '',
     'enabled', false));

-- ── Product categories (§12) ────────────────────────────────────────────────

insert into public.product_categories (code, name, kind, sort_order) values
  ('frames',         'Frames',                'stocked',       10),
  ('sunglasses',     'Sunglasses',            'stocked',       20),
  ('lenses',         'Spectacle Lenses',      'made_to_order', 30),
  ('contact_lenses', 'Contact Lenses',        'stocked',       40),
  ('accessories',    'Accessories',           'stocked',       50),
  ('services',       'Services & Repairs',    'service',       60),
  ('other',          'Other Optical Products','stocked',       70);

-- ── WhatsApp templates (§21) — bodies use ordinal {{n}} placeholders as the
--    Cloud API requires; variable_map documents what each ordinal means. ─────

insert into public.whatsapp_templates
  (code, name, provider_template_name, category, body_text, variable_map, approval_status) values
  ('order_confirmation', 'Order Confirmation', 'pov_order_confirmation', 'utility',
   'Hello {{1}}, your order {{2}} has been successfully placed at Perfect Optical Vision. Total amount: ₹{{3}}.',
   '["customer_name","order_number","total_amount"]', 'draft'),
  ('order_ready', 'Order Ready', 'pov_order_ready', 'utility',
   'Hello {{1}}, your spectacles for order {{2}} are ready for pickup at Perfect Optical Vision.',
   '["customer_name","order_number"]', 'draft'),
  ('payment_reminder', 'Payment Reminder', 'pov_payment_reminder', 'utility',
   'Hello {{1}}, your pending balance for invoice {{2}} is ₹{{3}}.',
   '["customer_name","invoice_number","balance"]', 'draft'),
  ('delivery_confirmation', 'Delivery Confirmation', 'pov_delivery_confirmation', 'utility',
   'Thank you for choosing Perfect Optical Vision, {{1}}. Your order {{2}} has been delivered successfully.',
   '["customer_name","order_number"]', 'draft'),
  ('review_request', 'Review Request', 'pov_review_request', 'marketing',
   'Thank you for visiting Perfect Optical Vision, {{1}}. We hope you are happy with your new spectacles. We would appreciate your feedback.',
   '["customer_name"]', 'draft');

-- ── Automation rules (§22) — disabled until the provider is connected. ─────

insert into public.whatsapp_automation_rules (event_key, template_id, delay_minutes, is_enabled)
select 'order.created',      id, 0,    false from public.whatsapp_templates where code = 'order_confirmation'
union all
select 'order.status.ready', id, 0,    false from public.whatsapp_templates where code = 'order_ready'
union all
select 'order.delivered',    id, 0,    false from public.whatsapp_templates where code = 'delivery_confirmation'
union all
select 'order.delivered',    id, 2880, false from public.whatsapp_templates where code = 'review_request'   -- +2 days
union all
select 'invoice.overdue',    id, 0,    false from public.whatsapp_templates where code = 'payment_reminder';

-- ---------------------------------------------------------------------------
-- 20260819120000_manual_whatsapp_and_idempotency.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 0011 · Manual WhatsApp tracking + duplicate prevention
--
-- Two concerns, both about telling the truth:
--
--  1. A message the staff opened in WhatsApp Web is NOT "delivered". We add an
--     'opened' status and a send_method so manual and API-sent messages are
--     never confused in the history. (brief §13)
--
--  2. Double-clicking "Generate invoice" or "Record payment" must not be able
--     to create two records. Client-side disabling is not a guarantee — two
--     tabs, a retried request or a flaky network defeat it. These are real
--     database constraints. (brief §15)
-- ============================================================================

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- 1 · Manual WhatsApp
-- ────────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_status_check;

alter table public.whatsapp_messages
  add constraint whatsapp_messages_status_check
  check (status in ('queued', 'sending', 'sent', 'delivered', 'read',
                    'failed', 'cancelled', 'opened'));

-- How the message left the building.
--   cloud_api   → sent by the dispatcher through the WhatsApp Cloud API
--   manual_link → staff opened wa.me / WhatsApp Desktop and sent it themselves
alter table public.whatsapp_messages
  add column if not exists send_method text not null default 'cloud_api'
  check (send_method in ('cloud_api', 'manual_link'));

comment on column public.whatsapp_messages.send_method is
  'cloud_api = sent by the dispatcher; manual_link = staff opened WhatsApp and sent it. Manual messages never claim delivery.';

-- A manual send is a deliberate staff action and may legitimately repeat
-- (a customer asks for the bill again), so its idempotency key is unique per
-- click. Automated messages keep their event-derived key, which is what makes
-- them un-duplicatable.
alter table public.whatsapp_messages
  add constraint whatsapp_manual_no_delivery_claim
  check (
    send_method <> 'manual_link'
    or status in ('opened', 'failed', 'cancelled')
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 2 · One live invoice per order — enforced, not merely checked
--
-- rpc_create_invoice already raises a friendly error, but two concurrent calls
-- could both pass that check before either committed. This index makes the
-- second one fail at the database level, whatever the caller does.
-- ────────────────────────────────────────────────────────────────────────────

create unique index if not exists invoices_one_live_per_order
  on public.invoices (order_id)
  where order_id is not null and status <> 'cancelled';

-- ────────────────────────────────────────────────────────────────────────────
-- 3 · Request de-duplication for orders and payments
--
-- The client generates a UUID once per form submission. A retry, a double
-- click or a second tab sends the same id, and the unique index turns the
-- duplicate into a no-op that returns the original record.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.orders   add column if not exists request_id uuid;
alter table public.payments add column if not exists request_id uuid;

create unique index if not exists orders_request_id_uniq
  on public.orders (request_id) where request_id is not null;
create unique index if not exists payments_request_id_uniq
  on public.payments (request_id) where request_id is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 4 · RPCs accepting the request id.
-- Old signatures are dropped so there is exactly one version of each.
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists public.rpc_create_order(uuid, jsonb, uuid, date, text, numeric, text);

create or replace function public.rpc_create_order(
  p_customer_id            uuid,
  p_items                  jsonb,
  p_prescription_id        uuid default null,
  p_expected_delivery_date date default null,
  p_notes                  text default null,
  p_advance_amount         numeric default 0,
  p_advance_method         text default 'cash',
  p_request_id             uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order          public.orders;
  v_item           jsonb;
  v_tax_inclusive  boolean;
  v_qty            numeric; v_price numeric; v_disc numeric; v_rate numeric;
  v_line           record;
  v_subtotal       numeric := 0;
  v_discount_total numeric := 0;
  v_tax_total      numeric := 0;
  v_grand_total    numeric := 0;
  v_kind           text;
  v_product_id     uuid;
begin
  perform public.assert_permission('orders.create');

  -- Idempotency: the same submission returns the order it already created.
  if p_request_id is not null then
    select * into v_order from public.orders where request_id = p_request_id;
    if found then
      return v_order;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item.' using errcode = 'POV07';
  end if;

  if p_prescription_id is not null and not exists (
    select 1 from public.prescriptions
     where id = p_prescription_id and customer_id = p_customer_id and voided_at is null
  ) then
    raise exception 'The selected prescription does not belong to this customer.'
      using errcode = 'POV07';
  end if;

  select coalesce((value ->> 'tax_inclusive')::boolean, true)
    into v_tax_inclusive
    from public.settings where key = 'billing.gst';
  v_tax_inclusive := coalesce(v_tax_inclusive, true);

  insert into public.orders
    (order_code, customer_id, prescription_id, expected_delivery_date, notes,
     created_by, request_id)
  values
    (public.generate_doc_number('order'),
     p_customer_id, p_prescription_id, p_expected_delivery_date, p_notes,
     auth.uid(), p_request_id)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_kind       := v_item ->> 'item_kind';
    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_qty        := coalesce((v_item ->> 'qty')::numeric, 1);
    v_price      := (v_item ->> 'unit_price')::numeric;
    v_rate       := coalesce((v_item ->> 'gst_rate_pct')::numeric, 0);
    v_disc       := coalesce((v_item ->> 'discount_amt')::numeric,
                     round(v_qty * v_price * coalesce((v_item ->> 'discount_pct')::numeric, 0) / 100.0, 2));

    if v_price is null or v_price < 0 then
      raise exception 'Every item needs a valid price.' using errcode = 'POV07';
    end if;

    select * into v_line
      from public.compute_gst_line(v_qty, v_price, v_disc, v_rate, v_tax_inclusive, true);

    insert into public.order_items
      (order_id, item_kind, product_id, description, lens_spec, qty, unit_price,
       discount_pct, discount_amt, gst_rate_pct, line_total)
    values
      (v_order.id, v_kind, v_product_id,
       v_item ->> 'description',
       v_item -> 'lens_spec',
       v_qty, v_price,
       coalesce((v_item ->> 'discount_pct')::numeric, 0),
       v_disc, v_rate, v_line.line_total);

    if v_kind = 'product' and v_product_id is not null and exists (
      select 1 from public.products where id = v_product_id and is_stock_tracked
    ) then
      insert into public.inventory_transactions
        (product_id, qty_delta, reason, ref_type, ref_id, created_by)
      values
        (v_product_id, -v_qty, 'sale', 'order', v_order.id, auth.uid());
    end if;

    v_subtotal       := v_subtotal + round(v_qty * v_price, 2);
    v_discount_total := v_discount_total + v_disc;
    v_tax_total      := v_tax_total + v_line.cgst_amt + v_line.sgst_amt + v_line.igst_amt;
    v_grand_total    := v_grand_total + v_line.line_total;
  end loop;

  update public.orders
     set subtotal       = v_subtotal,
         discount_total = v_discount_total,
         tax_total      = v_tax_total,
         grand_total    = v_grand_total,
         advance_amount = coalesce(p_advance_amount, 0)
   where id = v_order.id
   returning * into v_order;

  if coalesce(p_advance_amount, 0) > 0 then
    insert into public.payments
      (payment_code, entry_type, direction, order_id, customer_id, amount,
       method, received_by, notes)
    values
      (public.generate_doc_number('payment'), 'advance', 1, v_order.id, p_customer_id,
       p_advance_amount, coalesce(p_advance_method, 'cash'), auth.uid(),
       'Advance with order ' || v_order.order_code);
  end if;

  update public.customers
     set last_visit_at = now(),
         first_purchase_at = coalesce(first_purchase_at, now())
   where id = p_customer_id;

  perform public.wa_enqueue_for_event(
    'order.created', p_customer_id,
    jsonb_build_array(
      (select full_name from public.customers where id = p_customer_id),
      v_order.order_code::text,
      to_char(v_order.grand_total, 'FM9999999990.00')),
    'order_created:' || v_order.id,
    'order', v_order.id);

  return v_order;
end;
$$;

drop function if exists public.rpc_record_payment(uuid, numeric, text, text, text, boolean);

create or replace function public.rpc_record_payment(
  p_invoice_id    uuid,
  p_amount        numeric,
  p_method        text,
  p_reference_no  text default null,
  p_notes         text default null,
  p_allow_advance boolean default false,
  p_request_id    uuid default null
)
returns public.payments
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invoice public.invoices;
  v_payment public.payments;
  v_balance numeric;
begin
  perform public.assert_permission('payments.create');

  -- Idempotency: a retried submission returns the payment already recorded.
  if p_request_id is not null then
    select * into v_payment from public.payments where request_id = p_request_id;
    if found then
      return v_payment;
    end if;
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = 'POV07';
  end if;

  -- FOR UPDATE serialises concurrent payments against the same invoice, so two
  -- simultaneous part-payments cannot both pass the balance check.
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'POV07';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'Payments can only be recorded against an issued invoice.'
      using errcode = 'POV02';
  end if;

  v_balance := v_invoice.grand_total - v_invoice.amount_paid;

  if p_amount > v_balance and not (p_allow_advance and public.auth_has('payments.allow_overpay')) then
    raise exception 'Payment (%) exceeds the outstanding balance (%).',
      to_char(p_amount, 'FM9999999990.00'), to_char(v_balance, 'FM9999999990.00')
      using errcode = 'POV05';
  end if;

  insert into public.payments
    (payment_code, entry_type, direction, invoice_id, order_id, customer_id,
     amount, method, reference_no, received_by, notes, request_id)
  values
    (public.generate_doc_number('payment'), 'payment', 1,
     p_invoice_id, v_invoice.order_id, v_invoice.customer_id,
     p_amount, p_method, p_reference_no, auth.uid(), p_notes, p_request_id)
  returning * into v_payment;

  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice.amount_paid >= v_invoice.grand_total then
    perform public.wa_enqueue_for_event(
      'invoice.paid', v_invoice.customer_id,
      jsonb_build_array(
        (select full_name from public.customers where id = v_invoice.customer_id),
        v_invoice.invoice_no::text),
      'invoice_paid:' || v_invoice.id,
      'invoice', v_invoice.id);
  end if;

  return v_payment;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5 · Log a manual WhatsApp hand-off.
-- Records exactly what happened: staff opened WhatsApp with this message for
-- this number. It never claims the customer received anything.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_log_manual_whatsapp(
  p_customer_id  uuid,
  p_to_msisdn    text,
  p_body         text,
  p_entity_type  text default null,
  p_entity_id    uuid default null
)
returns public.whatsapp_messages
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_message public.whatsapp_messages;
begin
  perform public.assert_permission('whatsapp.send');

  if p_to_msisdn !~ '^[0-9]{10,15}$' then
    raise exception 'That WhatsApp number is not valid.' using errcode = 'POV07';
  end if;

  insert into public.whatsapp_messages
    (idempotency_key, customer_id, to_msisdn, variables, rendered_body,
     status, send_method, triggered_by, related_entity_type, related_entity_id,
     created_by, sent_at)
  values
    ('manual:' || gen_random_uuid(),
     p_customer_id, p_to_msisdn, '[]'::jsonb, p_body,
     'opened', 'manual_link', 'manual', p_entity_type, p_entity_id,
     auth.uid(), now())
  returning * into v_message;

  return v_message;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6 · Re-apply execute grants for the rebuilt functions.
-- ────────────────────────────────────────────────────────────────────────────

revoke execute on function public.rpc_create_order(uuid, jsonb, uuid, date, text, numeric, text, uuid) from anon;
revoke execute on function public.rpc_record_payment(uuid, numeric, text, text, text, boolean, uuid) from anon;
revoke execute on function public.rpc_log_manual_whatsapp(uuid, text, text, text, uuid) from anon;

-- ---------------------------------------------------------------------------
-- 20260819130000_whatsapp_dispatch_support.sql
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 0012 · WhatsApp dispatcher support
--
-- claim_whatsapp_batch is the concurrency-safe hand-off between the outbox and
-- the Edge Function worker. FOR UPDATE SKIP LOCKED means two overlapping cron
-- runs each get a different set of rows instead of both sending the same
-- message — the classic double-send bug in queue workers. (brief §15)
-- ============================================================================

set search_path = public, extensions;

create or replace function public.claim_whatsapp_batch(p_limit int default 20)
returns table (
  id           uuid,
  to_msisdn    text,
  variables    jsonb,
  attempts     int,
  max_attempts int,
  template     jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  with claimed as (
    select m.id
      from public.whatsapp_messages m
     where m.status = 'queued'
       and m.send_method = 'cloud_api'
       and m.next_attempt_at <= now()
       and m.scheduled_at <= now()
       and m.attempts < m.max_attempts
     order by m.scheduled_at
     limit p_limit
       for update skip locked
  )
  update public.whatsapp_messages m
     set status = 'sending', updated_at = now()
    from claimed c
   where m.id = c.id
  returning
    m.id,
    m.to_msisdn,
    m.variables,
    m.attempts,
    m.max_attempts,
    (
      select jsonb_build_object(
               'provider_template_name', t.provider_template_name,
               'language', t.language)
        from public.whatsapp_templates t
       where t.id = m.template_id
    );
end;
$$;

comment on function public.claim_whatsapp_batch is
  'Atomically claims due outbox rows for the dispatcher. SKIP LOCKED prevents double sends across concurrent runs.';

revoke execute on function public.claim_whatsapp_batch(int) from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Recover messages stuck in 'sending' — the worker crashed or timed out after
-- claiming them. Without this they would sit unsent forever.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.requeue_stale_whatsapp(p_older_than interval default '15 minutes')
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count int;
begin
  update public.whatsapp_messages
     set status = 'queued',
         next_attempt_at = now()
   where status = 'sending'
     and updated_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.requeue_stale_whatsapp(interval) from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Overdue-invoice reminders.
-- Queues one payment reminder per unpaid invoice older than the configured
-- number of days. The idempotency key includes the date, so a customer gets at
-- most one reminder per invoice per day however often this runs.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.queue_overdue_reminders(p_after_days int default 7)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row   record;
  v_total int := 0;
begin
  for v_row in
    select o.invoice_id, o.customer_id, o.invoice_no, o.full_name, o.balance
      from public.v_outstanding o
     where o.days_outstanding >= p_after_days
  loop
    v_total := v_total + public.wa_enqueue_for_event(
      'invoice.overdue',
      v_row.customer_id,
      jsonb_build_array(
        v_row.full_name,
        v_row.invoice_no::text,
        to_char(v_row.balance, 'FM9999999990.00')),
      'invoice_overdue:' || v_row.invoice_id || ':' || to_char(current_date, 'YYYY-MM-DD'),
      'invoice', v_row.invoice_id);
  end loop;

  return v_total;
end;
$$;

revoke execute on function public.queue_overdue_reminders(int) from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Scheduling (run these once, after deploying the Edge Functions).
--
-- pg_cron and pg_net are enabled from the Supabase dashboard
-- (Database → Extensions), then:
--
--   select cron.schedule('whatsapp-dispatch', '* * * * *', $$
--     select net.http_post(
--       url     := 'https://<project-ref>.supabase.co/functions/v1/whatsapp-dispatch',
--       headers := jsonb_build_object('x-dispatch-secret', '<DISPATCH_SECRET>'),
--       body    := '{}'::jsonb);
--   $$);
--
--   select cron.schedule('whatsapp-requeue', '*/15 * * * *',
--     $$ select public.requeue_stale_whatsapp(); $$);
--
--   select cron.schedule('overdue-reminders', '30 4 * * *',   -- 10:00 IST
--     $$ select public.queue_overdue_reminders(7); $$);
--
-- Kept as documentation rather than executed here: a migration that schedules
-- jobs would fire them in every environment, including local test runs.
-- ────────────────────────────────────────────────────────────────────────────

commit;
