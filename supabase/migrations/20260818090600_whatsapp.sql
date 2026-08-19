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
