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
