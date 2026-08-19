/**
 * Database test suite (npm run db:test).
 *
 * Boots an embedded Postgres 17, shims the Supabase-specific surface
 * (auth schema, auth.uid(), anon/authenticated roles, extensions schema),
 * applies every migration in order, then asserts the behaviours that matter:
 * GST arithmetic, gapless numbering, immutability triggers, the order status
 * machine, stock ledger/cache reconciliation, WhatsApp idempotency, and RLS
 * denial per role.
 *
 * Runs anywhere Node runs — no Docker needed — so it is the same command
 * locally and in CI. (The Supabase CLI + Docker stack remains the tool for
 * interactive local development; see docs/RUNBOOK.md.)
 */
import EmbeddedPostgres from 'embedded-postgres';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, '../../supabase/migrations');
const DATA_DIR = path.join(HERE, '.pgdata');

await rm(DATA_DIR, { recursive: true, force: true });

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: 55446,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

const shim = `
  create schema if not exists extensions;
  create schema if not exists auth;
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select from pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end $$;
  grant usage on schema public, extensions to anon, authenticated, service_role;
  alter default privileges in schema public
    grant select, insert, update, delete on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public
    grant usage, select on sequences to anon, authenticated, service_role;

  create table if not exists auth.users (
    id uuid primary key,
    email text unique,
    created_at timestamptz default now()
  );
  -- Supabase-compatible auth.uid(): reads the JWT claims GUC.
  create or replace function auth.uid() returns uuid
  language sql stable as $fn$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  $fn$;
`;

async function main() {
  console.log('▶ initialising cluster…');
  await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();

  const fail = (msg) => {
    console.error('✖ ' + msg);
    process.exitCode = 1;
  };
  const ok = (msg) => console.log('✔ ' + msg);

  try {
    await client.query(shim);
    ok('supabase shim installed');

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), 'utf8');
      try {
        await client.query(sql);
        ok(`migration ${f}`);
      } catch (e) {
        fail(`migration ${f}: ${e.message}\n   at: ${e.position ? sql.slice(Math.max(0, e.position - 120), +e.position + 120) : '(no position)'}`);
        throw e;
      }
    }

    // ── Smoke assertions ────────────────────────────────────────────────────
    const q = (sql, params) => client.query(sql, params);
    const one = async (sql, params) => (await q(sql, params)).rows[0];

    // Create a fake admin user + profile so RPCs pass permission checks.
    const admin = '00000000-0000-4000-8000-000000000001';
    await q(`insert into auth.users (id, email) values ($1, 'admin@test')`, [admin]);
    await q(
      `insert into public.profiles (id, full_name, role_id, branch_id)
       select $1, 'Test Admin', r.id, b.id from public.roles r, public.branches b
        where r.code = 'admin' and b.is_default`,
      [admin],
    );
    // Simulate an authenticated session.
    await q(`select set_config('request.jwt.claims', '{"sub":"${admin}"}', false)`);
    ok('admin profile + session');

    // 1. fy_key
    let r = await one(`select public.fy_key(date '2026-08-18') a, public.fy_key(date '2026-03-31') b`);
    if (r.a !== '26-27' || r.b !== '25-26') fail(`fy_key wrong: ${JSON.stringify(r)}`);
    else ok('fy_key: Aug 2026 → 26-27, Mar 2026 → 25-26');

    // 2. Customer creation + code
    r = await one(
      `select * from public.rpc_create_customer('Ramesh Kumar', '9876543210',
         null, null, null, null, 'Mysore', null, '12 MG Road', true)`,
    );
    if (r.customer_code !== 'POV-C000001') fail(`customer code: ${r.customer_code}`);
    else ok(`customer created ${r.customer_code}`);
    const custId = r.id;

    // duplicate mobile rejected
    try {
      await q(`select public.rpc_create_customer('Other Person', '9876543210')`);
      fail('duplicate mobile was accepted');
    } catch {
      ok('duplicate mobile rejected');
    }

    // 3. Prescription + immutability
    r = await one(
      `insert into public.prescriptions
         (customer_id, od_sph, od_cyl, od_axis, os_sph, pd_binocular, created_by)
       values ($1, -2.25, -0.50, 90, -2.00, 62, $2) returning id`,
      [custId, admin],
    );
    const rxId = r.id;
    try {
      await q(`update public.prescriptions set od_sph = -3 where id = $1`, [rxId]);
      fail('prescription clinical update was allowed');
    } catch {
      ok('prescription is immutable');
    }
    // axis-without-cyl constraint
    try {
      await q(
        `insert into public.prescriptions (customer_id, od_sph, od_cyl, created_by)
         values ($1, -1.00, -0.75, $2)`,
        [custId, admin],
      );
      fail('CYL without AXIS was accepted');
    } catch {
      ok('CYL without AXIS rejected');
    }

    // 4. Product + opening stock
    r = await one(
      `insert into public.products (sku, name, category_id, selling_price, gst_rate_pct, is_stock_tracked)
       select 'POV-P000001', 'Ray-Ban RB5154', id, 5000, 12, true
         from public.product_categories where code = 'frames' returning id`,
    );
    const frameId = r.id;
    await q(`select public.rpc_adjust_stock($1, 10, 'opening_stock', 'go-live count', 2200)`, [frameId]);
    r = await one(`select qty_on_hand from public.product_stock where product_id = $1`, [frameId]);
    if (Number(r.qty_on_hand) !== 10) fail(`opening stock: ${r.qty_on_hand}`);
    else ok('opening stock = 10');

    // ledger immutability
    try {
      await q(`update public.inventory_transactions set qty_delta = 99 where product_id = $1`, [frameId]);
      fail('inventory ledger update was allowed');
    } catch {
      ok('inventory ledger is immutable');
    }

    // 5. Order with frame + lens, advance ₹1000
    r = await one(
      `select * from public.rpc_create_order($1,
        '[{"item_kind":"product","product_id":"${frameId}","description":"Ray-Ban RB5154","qty":1,"unit_price":5000,"gst_rate_pct":12},
          {"item_kind":"lens","description":"1.56 Blue-cut single vision","qty":1,"unit_price":3000,"gst_rate_pct":12,
           "lens_spec":{"type":"single_vision","index":"1.56","coating":"blue_cut"}}]'::jsonb,
        $2, current_date + 5, null, 1000, 'upi')`,
      [custId, rxId],
    );
    const orderId = r.id;
    if (r.order_code !== 'POV-O000001') fail(`order code: ${r.order_code}`);
    if (Number(r.grand_total) !== 8000) fail(`order total: ${r.grand_total} (inclusive pricing should keep 8000)`);
    else ok(`order ${r.order_code}, total ₹${r.grand_total}, advance recorded`);

    r = await one(`select qty_on_hand from public.product_stock where product_id = $1`, [frameId]);
    if (Number(r.qty_on_hand) !== 9) fail(`stock after sale: ${r.qty_on_hand}`);
    else ok('stock deducted to 9 by order');

    // 6. Status machine: invalid jump rejected, valid path works
    try {
      await q(`select public.rpc_set_order_status($1, 'delivered')`, [orderId]);
      fail('new → delivered was allowed');
    } catch {
      ok('invalid status jump rejected');
    }
    for (const s of ['prescription_received', 'frame_selected', 'lens_ordered', 'in_lab', 'quality_check', 'ready']) {
      await q(`select public.rpc_set_order_status($1, $2)`, [orderId, s]);
    }
    r = await one(`select count(*)::int n from public.order_status_history where order_id = $1`, [orderId]);
    if (r.n !== 6) fail(`status history rows: ${r.n}`);
    else ok('status walked new→ready with full history');

    // direct status edit blocked
    try {
      await q(`update public.orders set status = 'delivered' where id = $1`, [orderId]);
      fail('direct status edit was allowed');
    } catch {
      ok('direct status edit blocked');
    }

    // 7. Invoice from order: GST-inclusive math
    r = await one(`select * from public.rpc_create_invoice($1, $2, null)`, [custId, orderId]);
    const invId = r.id;
    // 8000 inclusive @12% → taxable 7142.86, tax 857.14
    if (Number(r.taxable_total) !== 7142.86) fail(`taxable_total: ${r.taxable_total}`);
    if (Number(r.grand_total) !== 8000) fail(`grand_total: ${r.grand_total}`);
    if (Number(r.cgst_total) + Number(r.sgst_total) !== 857.14)
      fail(`gst split: ${r.cgst_total} + ${r.sgst_total}`);
    else ok(`invoice draft: taxable ₹${r.taxable_total}, CGST ₹${r.cgst_total} + SGST ₹${r.sgst_total}`);

    r = await one(`select * from public.rpc_issue_invoice($1, date '2026-08-18')`, [invId]);
    if (r.invoice_no !== 'POV/26-27/00001') fail(`invoice no: ${r.invoice_no}`);
    else ok(`issued ${r.invoice_no}`);
    if (Number(r.amount_paid) !== 1000) fail(`advance not counted: amount_paid=${r.amount_paid}`);
    else ok('order advance ₹1000 reflected on invoice');

    // issued invoice immutable
    try {
      await q(`update public.invoices set grand_total = 1 where id = $1`, [invId]);
      fail('issued invoice edit was allowed');
    } catch {
      ok('issued invoice is immutable');
    }

    // 8. Payment: overpay blocked, exact settle works
    try {
      await q(`select public.rpc_record_payment($1, 99999, 'cash')`, [invId]);
      fail('overpayment was accepted');
    } catch {
      ok('overpayment rejected');
    }
    await q(`select public.rpc_record_payment($1, 7000, 'upi', 'UPI123')`, [invId]);
    r = await one(`select amount_paid, grand_total from public.invoices where id = $1`, [invId]);
    if (Number(r.amount_paid) !== 8000) fail(`amount_paid after settle: ${r.amount_paid}`);
    else ok('invoice fully settled (1000 advance + 7000)');

    r = await one(`select count(*)::int n from public.v_outstanding`);
    if (r.n !== 0) fail(`outstanding rows: ${r.n}`);
    else ok('outstanding view empty after settlement');

    // payment ledger immutable
    try {
      await q(`delete from public.payments`);
      fail('payment delete was allowed');
    } catch {
      ok('payments are immutable');
    }

    // 9. Gapless numbering across rollback
    await q('begin');
    await q(`select public.generate_doc_number('invoice', date '2026-08-18')`);
    await q('rollback');
    r = await one(`select public.generate_doc_number('invoice', date '2026-08-18') n`);
    if (r.n !== 'POV/26-27/00002') fail(`gap after rollback: ${r.n}`);
    else ok('numbering gapless across rollback: ' + r.n);
    // FY reset
    r = await one(`select public.generate_doc_number('invoice', date '2027-04-01') n`);
    if (r.n !== 'POV/27-28/00001') fail(`FY reset: ${r.n}`);
    else ok('FY reset works: ' + r.n);

    // 10. WhatsApp enqueue idempotency (enable a rule first)
    await q(`update public.whatsapp_automation_rules set is_enabled = true`);
    const n1 = await one(
      `select public.wa_enqueue_for_event('order.status.ready', $1, '["Ramesh","POV-O000001"]'::jsonb,
        'order_ready:${orderId}', 'order', $2) n`, [custId, orderId]);
    const n2 = await one(
      `select public.wa_enqueue_for_event('order.status.ready', $1, '["Ramesh","POV-O000001"]'::jsonb,
        'order_ready:${orderId}', 'order', $2) n`, [custId, orderId]);
    if (n1.n < 1 || n2.n !== 0) fail(`wa idempotency: first=${n1.n} second=${n2.n}`);
    else ok(`wa enqueue idempotent (first=${n1.n}, repeat=0)`);
    r = await one(`select rendered_body from public.whatsapp_messages limit 1`);
    if (!r.rendered_body.includes('Ramesh')) fail(`template render: ${r.rendered_body}`);
    else ok('template variables rendered: ' + r.rendered_body.slice(0, 60) + '…');

    // 11. RLS: anonymous sees nothing, staff cannot touch settings
    // An anonymous request carries no JWT sub — clear the claims like PostgREST would.
    await q(`select set_config('request.jwt.claims', '', false)`);
    await q(`set role anon`);
    r = await one(`select count(*)::int n from public.customers`);
    // anon has no permission rows → auth_has false → RLS filters all
    if (r.n !== 0) fail(`anon can see ${r.n} customers`);
    else ok('RLS: anon sees zero customers');
    await q(`reset role`);

    // staff user
    const staff = '00000000-0000-4000-8000-000000000002';
    await q(`insert into auth.users (id, email) values ($1, 'staff@test')`, [staff]);
    await q(
      `insert into public.profiles (id, full_name, role_id, branch_id)
       select $1, 'Test Staff', r.id, b.id from public.roles r, public.branches b
        where r.code = 'staff' and b.is_default`, [staff]);
    await q(`select set_config('request.jwt.claims', '{"sub":"${staff}"}', false)`);
    await q(`set role authenticated`);
    r = await one(`select count(*)::int n from public.customers`);
    if (r.n !== 1) fail(`staff should see 1 customer, sees ${r.n}`);
    else ok('RLS: staff sees customers');
    r = await one(`select count(*)::int n from public.settings`);
    // staff can read non-secret settings? staff has no settings perm but settings_select needs only active staff
    try {
      await q(`update public.settings set value = '{}' where key = 'billing.gst'`);
      r = await one(`select value from public.settings where key = 'billing.gst'`);
      if (JSON.stringify(r.value) === '{}') fail('staff modified settings');
      else ok('RLS: staff settings update silently filtered (0 rows)');
    } catch {
      ok('RLS: staff cannot modify settings');
    }
    // staff cannot cancel invoice (permission gate in RPC)
    try {
      await q(`select public.rpc_cancel_invoice($1, 'testing')`, [invId]);
      fail('staff cancelled an invoice');
    } catch {
      ok('staff cannot cancel invoices');
    }
    await q(`reset role`);

    // 12. Stock reconciliation clean
    r = await one(`select count(*)::int n from public.v_stock_reconciliation`);
    if (r.n !== 0) fail(`stock drift rows: ${r.n}`);
    else ok('stock ledger reconciles with cache');

    // ── 13. Duplicate prevention (brief §15) ────────────────────────────────

    // 13a. A second invoice for the same order is refused by the unique index,
    //      not merely by the RPC's own check.
    try {
      await q(`select public.rpc_create_invoice($1, $2, null)`, [custId, orderId]);
      fail('a second invoice was created for the same order');
    } catch {
      ok('duplicate invoice for an order blocked');
    }

    // 13b. Same request_id on a payment returns the original, not a second one.
    const beforePayments = (await one(`select count(*)::int n from public.payments`)).n;
    const payReq = '11111111-2222-4333-8444-555555555555';
    // Create a second order + invoice with a balance to pay against.
    const order2 = await one(
      `select * from public.rpc_create_order($1,
        '[{"item_kind":"lens","description":"Test lens","qty":1,"unit_price":1000,"gst_rate_pct":12}]'::jsonb,
        null, null, null, 0, 'cash')`, [custId]);
    const inv2 = await one(`select * from public.rpc_create_invoice($1, $2, null)`, [custId, order2.id]);
    await q(`select public.rpc_issue_invoice($1, date '2026-08-19')`, [inv2.id]);

    const p1 = await one(
      `select * from public.rpc_record_payment($1, 500, 'cash', null, null, false, $2)`,
      [inv2.id, payReq]);
    const p2 = await one(
      `select * from public.rpc_record_payment($1, 500, 'cash', null, null, false, $2)`,
      [inv2.id, payReq]);
    if (p1.id !== p2.id) fail('same request_id created two payments');
    else ok('duplicate payment blocked by request_id');

    const afterPayments = (await one(`select count(*)::int n from public.payments`)).n;
    if (afterPayments !== beforePayments + 1) {
      fail(`payment count moved by ${afterPayments - beforePayments}, expected 1`);
    } else ok('exactly one payment row written for two identical submits');

    r = await one(`select amount_paid from public.invoices where id = $1`, [inv2.id]);
    if (Number(r.amount_paid) !== 500) fail(`amount_paid double-counted: ${r.amount_paid}`);
    else ok('invoice balance not double-counted');

    // 13c. Same request_id on an order returns the original order.
    const ordReq = '99999999-8888-4777-8666-555555555555';
    const o1 = await one(
      `select * from public.rpc_create_order($1,
        '[{"item_kind":"lens","description":"Dup test","qty":1,"unit_price":100,"gst_rate_pct":12}]'::jsonb,
        null, null, null, 0, 'cash', $2)`, [custId, ordReq]);
    const o2 = await one(
      `select * from public.rpc_create_order($1,
        '[{"item_kind":"lens","description":"Dup test","qty":1,"unit_price":100,"gst_rate_pct":12}]'::jsonb,
        null, null, null, 0, 'cash', $2)`, [custId, ordReq]);
    if (o1.id !== o2.id) fail('same request_id created two orders');
    else ok('duplicate order blocked by request_id');

    // 13d. Stock is deducted once, not twice, by the de-duplicated order.
    const frameBefore = Number(
      (await one(`select qty_on_hand from public.product_stock where product_id = $1`, [frameId])).qty_on_hand);
    const stockReq = '77777777-6666-4555-8444-333333333333';
    for (let i = 0; i < 2; i++) {
      await q(
        `select public.rpc_create_order($1,
          $2::jsonb, null, null, null, 0, 'cash', $3)`,
        [custId,
         JSON.stringify([{ item_kind: 'product', product_id: frameId, description: 'Frame', qty: 1, unit_price: 5000, gst_rate_pct: 12 }]),
         stockReq]);
    }
    const frameAfter = Number(
      (await one(`select qty_on_hand from public.product_stock where product_id = $1`, [frameId])).qty_on_hand);
    if (frameBefore - frameAfter !== 1) {
      fail(`stock moved by ${frameBefore - frameAfter}, expected exactly 1`);
    } else ok('inventory deducted once despite duplicate submit');

    // ── 14. Manual WhatsApp is logged honestly (brief §13) ──────────────────

    const manual = await one(
      `select * from public.rpc_log_manual_whatsapp($1, '919876543210', 'Hello Ramesh', 'invoice', $2)`,
      [custId, invId]);
    if (manual.status !== 'opened' || manual.send_method !== 'manual_link') {
      fail(`manual log wrong: status=${manual.status} method=${manual.send_method}`);
    } else ok('manual WhatsApp recorded as opened / manual_link');

    // A manual message must never be able to claim delivery.
    try {
      await q(`update public.whatsapp_messages set status = 'delivered' where id = $1`, [manual.id]);
      fail('a manual message was marked delivered');
    } catch {
      ok('manual message cannot claim delivery');
    }

    // An invalid number is refused before any link is built.
    try {
      await q(`select public.rpc_log_manual_whatsapp($1, '12345', 'x')`, [custId]);
      fail('invalid msisdn accepted');
    } catch {
      ok('invalid WhatsApp number rejected');
    }

    // ── 15. Dispatcher claim is concurrency-safe ───────────────────────────

    await q(`update public.whatsapp_messages
                set status = 'queued', send_method = 'cloud_api'
              where send_method = 'cloud_api'`);
    const queuedCount = (await one(
      `select count(*)::int n from public.whatsapp_messages where status = 'queued'`)).n;

    const batch1 = await q(`select * from public.claim_whatsapp_batch(100)`);
    const batch2 = await q(`select * from public.claim_whatsapp_batch(100)`);
    if (batch1.rows.length !== queuedCount || batch2.rows.length !== 0) {
      fail(`claim not exclusive: first=${batch1.rows.length} second=${batch2.rows.length} of ${queuedCount}`);
    } else ok(`dispatcher claimed ${batch1.rows.length} messages exclusively (second run got 0)`);

    // Stale 'sending' rows are recovered rather than lost forever.
    // In production updated_at ages by itself after the claim; here we have to
    // suspend the touch-trigger to simulate a worker that died an hour ago.
    await q(`alter table public.whatsapp_messages disable trigger wa_messages_set_updated_at`);
    await q(`update public.whatsapp_messages
                set updated_at = now() - interval '1 hour' where status = 'sending'`);
    await q(`alter table public.whatsapp_messages enable trigger wa_messages_set_updated_at`);

    const requeued = (await one(`select public.requeue_stale_whatsapp() n`)).n;
    if (requeued < 1) fail('stale sending messages were not requeued');
    else ok(`stale dispatcher rows requeued (${requeued})`);

    // …and they are claimable again, so nothing is stranded.
    const reclaim = await q(`select * from public.claim_whatsapp_batch(100)`);
    if (reclaim.rows.length !== requeued) {
      fail(`requeued ${requeued} but only ${reclaim.rows.length} were claimable`);
    } else ok('requeued messages are claimable again');

    console.log(process.exitCode ? '\n✖ FAILURES PRESENT' : '\n✔ ALL CHECKS PASSED');
  } finally {
    await client.end().catch(() => {});
    await pg.stop().catch(() => {});
  }
}

main().catch((e) => {
  console.error('fatal:', e.message);
  process.exitCode = 1;
});
