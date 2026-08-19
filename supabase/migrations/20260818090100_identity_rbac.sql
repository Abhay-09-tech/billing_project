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
