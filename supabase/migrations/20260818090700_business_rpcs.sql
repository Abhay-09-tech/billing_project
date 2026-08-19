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
