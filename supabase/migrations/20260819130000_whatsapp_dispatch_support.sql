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
