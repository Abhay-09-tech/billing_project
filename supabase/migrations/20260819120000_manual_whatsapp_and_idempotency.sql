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
