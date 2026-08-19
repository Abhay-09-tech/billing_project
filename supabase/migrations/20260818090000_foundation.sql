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
