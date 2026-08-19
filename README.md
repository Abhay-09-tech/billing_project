# Perfect Optical Vision

Optical retail management, billing and WhatsApp automation for **Perfect Optical Vision**.

React + TypeScript PWA on Supabase (Postgres + Auth + Storage + Edge Functions).
Design decisions and reasoning live in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — read that first.

---

## Quick start

```bash
npm install
cp .env.example .env          # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Verify everything before committing:

```bash
npm run verify                # typecheck + lint + unit tests
npm run db:test               # applies all migrations to a throwaway Postgres and asserts behaviour
```

`db:test` needs no Docker and no cloud project — it boots an embedded Postgres 17,
shims the Supabase surface (`auth.uid()`, `anon`/`authenticated` roles), applies every
migration in order and asserts the rules that matter.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build (PWA included) |
| `npm run verify` | `typecheck` + `lint` + `test` |
| `npm test` | Vitest unit tests |
| `npm run db:test` | **Migrations + business-rule assertions on a real Postgres** |
| `npm run db:push` | Apply migrations to the linked Supabase project |
| `npm run db:types` | Regenerate `src/types/database.ts` from the live schema |

---

## Layout

```
docs/ARCHITECTURE.md      design, ERD, security, deployment, cost, risks
supabase/migrations/      the schema — source of truth, in git, never edited via the dashboard
scripts/db-test/          database test suite (embedded Postgres)
src/
  app/                    routing, auth provider, responsive shell, navigation
  features/<module>/      screens, dialogs, per-feature hooks and Zod schemas
  services/               data access — the ONLY code allowed to import supabase-js
  components/ui/          design-system primitives
  lib/                    money, GST, dates, error translation, permissions
  types/database.ts       database types (regenerate with npm run db:types)
```

### The one architectural rule

**UI code never imports `supabase-js` or `@/lib/supabase`.** It calls a function in
`src/services/`. An ESLint rule fails the build otherwise. This is what keeps a future
move to a separate API a one-folder change instead of a rewrite.

### The one business rule

**Anything that touches money, stock or workflow state happens in a Postgres function,
not in React.** `rpc_create_order`, `rpc_create_invoice`, `rpc_issue_invoice`,
`rpc_record_payment`, `rpc_set_order_status`, `rpc_adjust_stock`. They run in one
transaction, enforce permissions server-side, allocate gapless document numbers, write
the audit trail and queue WhatsApp messages. The browser cannot bypass them, and neither
can a future mobile app or integration.

---

## Non-negotiables baked into the database

These are enforced by triggers and constraints, not by convention:

- Issued invoices cannot be edited — corrections are credit notes.
- Payments and stock movements are append-only — reversals are new rows.
- Prescriptions are never overwritten — a correction supersedes, and history remains.
- Order status changes only through `rpc_set_order_status`, always with a history row.
- Invoice numbers are gapless per financial year (`POV/26-27/00001`) and survive rollbacks.
- Cached values (`invoices.amount_paid`, `product_stock.qty_on_hand`) are trigger-maintained;
  `v_stock_reconciliation` surfaces any drift instead of hiding it.

Every one of these has a test in `npm run db:test`.

---

## Current state

| Phase | Status |
|---|---|
| Architecture, ERD, security, deployment plan | ✅ Done — `docs/ARCHITECTURE.md` |
| Database: 33 tables, RLS, RPCs, seed | ✅ Done and verified |
| Database test suite (40 assertions) | ✅ Passing |
| Auth, RBAC, responsive shell, navigation | ✅ Done |
| Service layer for every module | ✅ Done |
| Dashboard (live metrics, order queue, sales overview) | ✅ Done |
| Customers: list, search, progressive create, Customer 360 | ✅ Done |
| Prescriptions: entry, history, image upload | ✅ Done |
| Products, Inventory | ⏳ Phase 5 — backend done, screens pending |
| Orders, Lab | ⏳ Phase 6 — backend done, screens pending |
| Billing, Payments, Outstanding, PDF | ⏳ Phase 7 — backend done, screens pending |
| Reports, Settings | ⏳ Phase 8 |
| WhatsApp dispatcher, webhook, automation UI | ⏳ Phase 9–10 |
| PWA polish, E2E tests, security + performance review | ⏳ Phase 11–12 |

Screens not yet built show exactly what already works underneath and what the screen
will add — they never display invented numbers.

---

## Setting up a Supabase project

1. Create the project, then `npx supabase link --project-ref <ref>`.
2. `npm run db:push` to apply migrations.
3. Create the two private storage buckets: `prescription-files`, `invoices`.
4. Disable public sign-up in Auth settings — staff accounts are created by an admin.
5. Create the first admin: add the auth user, then insert a `profiles` row with the
   `admin` role. Create a **second** admin immediately (see the lockout risk in
   `docs/ARCHITECTURE.md` §11).
6. Fill in Settings → shop profile, GSTIN and per-product GST rates before issuing bills.

WhatsApp secrets go in Edge Function secrets only, never in `.env`:

```bash
supabase secrets set WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... \
                     WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=...
```
