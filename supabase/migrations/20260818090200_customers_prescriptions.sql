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
