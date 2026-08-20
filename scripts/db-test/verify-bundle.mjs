/**
 * Proves supabase/setup/full-schema.sql can be pasted into the Supabase SQL
 * Editor and will work — before anyone actually does it.
 *
 * Applies the bundle TWICE against a throwaway Postgres. The second pass is
 * the important one: setup files get re-run by accident, and a bundle that
 * explodes the second time is a trap.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.resolve(HERE, '../../supabase/setup/full-schema.sql');
const DATA_DIR = path.join(HERE, '.pgdata-bundle');

await rm(DATA_DIR, { recursive: true, force: true });

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: 55447,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

// Same Supabase shim the main harness uses: hosted Supabase already provides
// these, a bare Postgres does not.
const shim = `
  create schema if not exists extensions;
  create schema if not exists auth;
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  grant usage on schema public, extensions to anon, authenticated, service_role;
  create table if not exists auth.users (
    id uuid primary key, email text unique, created_at timestamptz default now()
  );
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  $fn$;
`;

let failures = 0;
const ok = (m) => console.log('\u2714 ' + m);
const fail = (m) => { console.error('\u2716 ' + m); failures++; };

await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();

try {
  await client.query(shim);
  const sql = await readFile(BUNDLE, 'utf8');
  ok(`bundle loaded (${sql.split('\n').length} lines)`);

  try {
    await client.query(sql);
    ok('first apply succeeded');
  } catch (e) {
    const near = e.position ? sql.slice(Math.max(0, e.position - 200), Number(e.position) + 200) : '(no position)';
    fail(`first apply failed: ${e.message}
--- near ---
${near}
------------`);
    try { await client.query('rollback'); } catch { /* nothing to roll back */ }
  }

  // The paste is worthless if it did not actually build the system.
  const counts = await client.query(`
    select
      (select count(*) from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
      (select count(*) from information_schema.routines
        where routine_schema = 'public') as functions,
      (select count(*) from pg_policies where schemaname = 'public') as policies,
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as rls_tables
  `);
  const { tables, functions, policies, rls_tables } = counts.rows[0];
  console.log(`   tables=${tables} functions=${functions} policies=${policies} rls_enabled=${rls_tables}`);

  if (Number(tables) < 30) fail(`expected 30+ tables, got ${tables}`); else ok(`${tables} tables created`);
  if (Number(policies) < 30) fail(`expected 30+ RLS policies, got ${policies}`); else ok(`${policies} RLS policies active`);
  if (Number(rls_tables) < Number(tables) - 2) {
    fail(`only ${rls_tables}/${tables} tables have RLS enabled`);
  } else ok(`RLS enabled on ${rls_tables}/${tables} tables`);

  // Seed data must survive a double apply without duplicating.
  const seeds = await client.query(`
    select
      (select count(*) from roles) as roles,
      (select count(*) from permissions) as perms,
      (select count(*) from branches) as branches,
      (select count(*) from order_statuses) as statuses,
      (select count(*) from whatsapp_templates) as templates,
      (select count(*) from settings) as settings
  `);
  const s = seeds.rows[0];
  console.log(`   roles=${s.roles} permissions=${s.perms} branches=${s.branches} statuses=${s.statuses} templates=${s.templates} settings=${s.settings}`);
  if (Number(s.branches) !== 1) fail(`branches should be exactly 1 after two applies, got ${s.branches}`);
  else ok('seed data did not duplicate on re-apply');
  if (Number(s.roles) < 2) fail('roles not seeded'); else ok('roles seeded');
  if (Number(s.statuses) < 10) fail('order statuses not seeded'); else ok('order workflow seeded');

  // The invoice series must be the FY format that was agreed.
  const numbering = await client.query(`select value from settings where key = 'numbering.invoice'`);
  const pattern = JSON.stringify(numbering.rows[0]?.value ?? {});
  if (pattern.includes('{fy}') || pattern.includes('26-27')) ok(`invoice numbering is FY-based: ${pattern}`);
  else fail(`unexpected invoice numbering config: ${pattern}`);
  // Re-running setup must be REFUSED with a clear message, not a cryptic
  // "relation already exists" — and must leave the schema untouched.
  try {
    await client.query(sql);
    fail('re-applying the bundle was allowed; the guard did not fire');
  } catch (e) {
    try { await client.query('rollback'); } catch { /* already rolled back */ }
    if (/already installed/i.test(e.message)) {
      ok('re-running is refused with a clear, human-readable message');
    } else {
      fail(`re-run failed with a confusing error instead of the guard: ${e.message}`);
    }
  }

  const after = await client.query(`select count(*) as n from branches`);
  if (Number(after.rows[0].n) === 1) ok('refused re-run left the data untouched');
  else fail(`refused re-run altered data: branches=${after.rows[0].n}`);

} catch (e) {
  fail(`unexpected: ${e.message}`);
} finally {
  await client.end();
  await pg.stop();
  await rm(DATA_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n\u2714 BUNDLE IS SAFE TO PASTE' : `\n\u2716 ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
