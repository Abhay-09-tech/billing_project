# Perfect Optical Vision — Handover

**Version:** 1.0 · **Date:** 19 Aug 2026
**Repository:** https://github.com/Abhay-09-tech/billing_project

Read alongside:
- [GETTING-STARTED.md](GETTING-STARTED.md) — non-technical setup, step by step
- [ARCHITECTURE.md](ARCHITECTURE.md) — why the system is built this way

---

## 1. Application access

> **The application is not yet deployed to a public URL, and I could not deploy it
> for you.** Doing so requires signing into your Supabase account and a hosting
> account, which only you can do. Section 8 has the exact commands; it takes about
> 30 minutes and costs ₹0 to start.

**Right now** the application runs on this laptop:

```bash
cd c:\Users\QHT-LT-01\PyCharmMiscProject\perfect-optical-vision
npm run dev
```

Then open **http://localhost:5173**. The terminal also prints a **Network**
address (e.g. `http://192.168.1.5:5173`) which works on any phone connected to
the same shop Wi-Fi.

**After deployment** the URL will be whatever you choose — for example
`https://billing.perfectoptical.in` or the free
`https://perfect-optical-vision.pages.dev`. Once deployed, record it here.

### Login

| | |
|---|---|
| **Where** | The application URL. There is no separate login page — if you are not signed in, the sign-in screen is all you see. |
| **Admin** | Full access: settings, users, prices, cancelling invoices, refunds, exports. |
| **Staff** | Day-to-day counter work: customers, prescriptions, orders, lab, billing, payments. Cannot change settings, prices, users, or cancel financial records. |
| **Creating users** | Settings → Users → "Add a user" shows the exact two steps. Step 1 is in the Supabase dashboard (deliberately — see §3). |
| **Password reset** | Settings → Users → "Send reset email", or the staff member uses "Forgot password" on the sign-in screen. |
| **Removing access** | Settings → Users → Remove. They are signed out immediately; all their past work stays intact and attributed to them. |
| **Log out** | The exit icon — bottom-left on desktop, top-right on mobile. |

---

## 2. Technology

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 19 + TypeScript, Vite 6, Tailwind CSS 4 | Installable PWA; one codebase for desktop and mobile |
| Data access | TanStack Query | Caching, pagination, retries |
| Database | Supabase (PostgreSQL 15) | 33 tables, row-level security on every one |
| Business logic | PostgreSQL functions (`SECURITY DEFINER`) | Money, stock and workflow — un-bypassable by any client |
| Auth | Supabase Auth (email + password) | Public sign-up disabled |
| Files | Supabase Storage, private buckets | Prescription images; short-lived signed URLs only |
| Background jobs | Supabase Edge Functions (Deno) + `pg_cron` | WhatsApp dispatch, delivery webhook |
| PDF | jsPDF + autoTable, generated in the browser | Real text, ~14 KB per invoice |
| WhatsApp (manual) | `wa.me` click-to-chat deep links | Official; opens WhatsApp Web / the app |
| WhatsApp (automated) | Meta WhatsApp Cloud API | Behind a swappable provider adapter |
| Hosting | Not yet chosen — Cloudflare Pages recommended | Free tier permits commercial use |

**There is no separate backend server to run or patch.** Reasoning in
ARCHITECTURE.md §2.3.

---

## 3. Environment & secrets

### Frontend — `.env` (never committed)

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_APP_ENV=production
```

Both are **safe to expose**. The anon key is designed to be public; every table
is protected by row-level security, so on its own it can read nothing.

### Edge Function secrets — never in `.env`, never in the repo

```bash
supabase secrets set \
  WHATSAPP_ACCESS_TOKEN=...      # Meta permanent token
  WHATSAPP_PHONE_NUMBER_ID=...   # Meta phone number id
  WHATSAPP_APP_SECRET=...        # verifies webhook signatures
  WHATSAPP_VERIFY_TOKEN=...      # any string you choose, for the handshake
  DISPATCH_SECRET=...            # any long random string; guards the worker
```

`SUPABASE_SERVICE_ROLE_KEY` is injected into Edge Functions automatically — you
never handle it. **It must never appear in any `VITE_*` variable**: it bypasses
all security.

> **Why creating users needs the Supabase dashboard:** creating an auth account
> requires the service-role key. Putting it in the browser would let anyone who
> opens the developer console create admin accounts. The two-step process in
> Settings → Users is the safe alternative, not an oversight.

---

## 4. Database

**Project:** the Supabase project you create in GETTING-STARTED §2.

### Main tables

| Group | Tables |
|---|---|
| Identity | `profiles`, `roles`, `permissions`, `role_permissions`, `branches` |
| Customers | `customers`, `customer_addresses` |
| Clinical | `prescriptions`, `prescription_files` |
| Catalogue | `products`, `product_categories`, `brands`, `suppliers` |
| Stock | `inventory_transactions` (ledger), `product_stock` (cache) |
| Orders | `orders`, `order_items`, `order_statuses`, `order_status_history` |
| Lab | `lab_orders`, `lab_vendors` |
| Billing | `invoices`, `invoice_items`, `credit_notes`, `credit_note_items` |
| Money | `payments`, `document_counters` |
| WhatsApp | `whatsapp_templates`, `whatsapp_automation_rules`, `whatsapp_messages`, `whatsapp_inbound` |
| System | `audit_logs`, `settings` |

### Rules the database enforces (not just convention)

- Issued invoices cannot be edited — corrections are credit notes.
- Payments and stock movements are append-only; reversals are new rows.
- Prescriptions are never overwritten; a correction supersedes and history remains.
- Order status changes only via `rpc_set_order_status`, always with a history row.
- Invoice numbers are gapless per financial year and survive transaction rollbacks.
- One live invoice per order — enforced by a unique index, not just a check.
- A manual WhatsApp message can never be marked delivered or read.

### Migrations

Every schema change is a numbered SQL file in `supabase/migrations/`, in git.
**Never change the schema by clicking in the Supabase dashboard** — the next
`db:push` would fight it.

```bash
npm run db:push     # apply pending migrations
npm run db:test     # verify against a throwaway Postgres first (recommended)
```

### Backups — three layers

1. **Supabase daily backups** — automatic on the **Pro** plan (≈₹2,100/month).
   The free plan has none. Upgrade before your first real bill.
2. **CSV exports** — Settings → Export & backup. Download monthly to a local
   drive. This is the only copy that survives losing the Supabase account.
3. **Point-in-time recovery** — optional Supabase add-on (≈₹850/month), lets you
   rewind to any moment.

---

## 5. WhatsApp

Two completely separate paths. Both are official; neither uses browser
automation or scraping.

### Manual — works today, no setup

Buttons on the invoice, customer profile, order page and outstanding list. Press
one and you get:

1. A choice of number — saved WhatsApp, mobile, or type another.
2. The message pre-written with the real invoice/order figures.
3. "Edit message" if you want to change it.
4. **Open WhatsApp** → WhatsApp Web on desktop, the app on a phone, message
   already typed. **You press send.**

The number is normalised first, so `+91-98765 43210`, `09876543210` and
`9876543210` all produce a working link. Invalid numbers are refused with a
plain message.

Recorded in the history as **"Opened in WhatsApp"** — never as delivered,
because nothing reports back on a manual send. A database rule makes it
impossible to mark such a message delivered.

### Automated — needs Meta setup

Order confirmations, ready notifications, delivery thank-yous, review requests
and payment reminders, sent by the system without staff involvement.

**Flow:** the order/payment RPC writes a row to the `whatsapp_messages` outbox
inside the same transaction → `pg_cron` invokes `whatsapp-dispatch` every minute
→ it claims due rows with `FOR UPDATE SKIP LOCKED` (so overlapping runs can
never double-send) → sends via the Cloud API → `whatsapp-webhook` receives real
delivered/read receipts from Meta.

**Templates:** WhatsApp → Templates. Five are pre-loaded. They must be
registered and approved in Meta's dashboard under the same names.

**Automation rules:** WhatsApp → Automation. Each event has an on/off switch and
an optional delay. All are **off** until you connect the provider.

**Failures:** retried with backoff (1m, 5m, 30m, 2h, 6h), up to 5 attempts.
Permanent errors — invalid number, unapproved template, expired token — fail
immediately rather than burning quota, and appear on the WhatsApp dashboard with
Meta's error message.

**Setup order** (§9 has the blockers):
1. A dedicated SIM never used on WhatsApp or WhatsApp Business.
2. A verified Meta Business account.
3. WhatsApp Business Platform on that number; submit the five templates.
4. `supabase functions deploy whatsapp-dispatch whatsapp-webhook`
5. Set the secrets (§3), point Meta's webhook at the webhook function URL.
6. Schedule the cron jobs — the exact SQL is at the bottom of
   `supabase/migrations/20260819130000_whatsapp_dispatch_support.sql`.
7. Settings → set `whatsapp.provider.enabled = true`, then switch on the rules.

---

## 6. Billing

### The counter workflow

```
Customer → Order → Create bill → Invoice → Print / PDF / WhatsApp
```

1. **Orders → New order.** Search or create the customer, pick the prescription,
   add frame and lenses, apply discount, take the advance.
2. On the order, **Create bill**. This creates and issues the invoice in one
   step and lands on the confirmation screen.
3. **Invoice created successfully** shows the number, total, paid and balance,
   with five actions: **Print Invoice · Download PDF · Send on WhatsApp ·
   Share Invoice · View Invoice**.

### Invoice numbering

`POV/26-27/00001` — 15 characters, financial-year based, resets each April.
Gapless: a rolled-back transaction does not consume a number. The 18-character
format originally requested would have breached the 16-character cap in CGST
Rule 46(b).

### GST

Prices are **MRP-inclusive** (your decision). Per line:
`taxable = net ÷ (1 + rate/100)`, rounded per line then summed — the method that
reconciles with GSTR-1. Intra-state splits CGST/SGST with any odd paisa going to
SGST so the pair always equals the tax exactly.

The arithmetic lives in `compute_gst_line()` in Postgres. The TypeScript copy in
`src/lib/gst.ts` exists only for the live preview while typing, and both are
covered by the same test vectors so they cannot drift.

### Printing

**Print Invoice** opens the browser print dialog showing only the invoice —
no sidebar, navigation or buttons. A4, standard printers. Contains shop details
and GSTIN, customer name/mobile/WhatsApp/ID/address, invoice and order numbers,
per-line HSN, quantity, rate, discount, GST and total, the tax summary, payment
method and status, terms, and a signatory block.

### PDF

**Download PDF** produces a real PDF (~14 KB) with selectable, searchable text —
not a screenshot. Verified automatically by `npm run pdf:test`, which asserts the
customer name, invoice number, GSTIN, product names, HSN codes and amounts are
genuinely in the file's bytes.

> **Honest limitation:** a website cannot attach a file to a WhatsApp chat.
> `wa.me` links carry text only — that is WhatsApp's design, not a gap here.
> **Share Invoice** uses the device's native share sheet, which *can* attach the
> PDF on Android Chrome and iOS Safari. On desktop browsers without that
> support, it downloads the PDF and tells you to attach it. It never pretends
> the file was sent.

### Payments

Record payment defaults to the full balance. Over-payment is blocked unless an
admin explicitly accepts it as an advance. Every payment is permanent — mistakes
are corrected with a refund entry, never a deletion, so the cash book always
reconciles.

---

## 7. User management

| Task | Where |
|---|---|
| Create a staff user | Settings → Users → "Add a user" (two steps, first in Supabase) |
| Change a role | Settings → Users → the Role dropdown |
| Reset a password | Settings → Users → "Send reset email" |
| Remove access | Settings → Users → Remove |
| Add a new role | Insert into `roles` + `role_permissions` — roles are data, no code change |

Guards: you cannot change your own role, and the system refuses to remove or
demote the last active administrator. **Create a second admin on day one.**

---

## 8. Deployment

### First deployment

```bash
# 1. Database
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:push

# 2. Frontend
npm run build            # outputs dist/
```

Then either:

**Cloudflare Pages (recommended, free, commercial use allowed)**
Connect the GitHub repo at dash.cloudflare.com → Pages. Build command
`npm run build`, output directory `dist`. Add `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as environment variables. Every push to `main` then
deploys automatically.

**Your existing nginx server**
Copy `dist/` to the web root and serve it, with a fallback to `index.html` for
client-side routing:

```nginx
location / { try_files $uri $uri/ /index.html; }
```

> Vercel's free Hobby tier prohibits commercial use — a shop billing system
> would need a paid plan there, for no benefit over Cloudflare Pages.

### Future updates

`git push` → Cloudflare Pages rebuilds automatically. Run `npm run db:push` when
a release adds migrations. Roll back by redeploying the previous build;
**never** roll back the database with a destructive down-migration — write a
forward fix.

### Logs

| What | Where |
|---|---|
| Database queries and errors | Supabase → Logs → Postgres |
| API requests | Supabase → Logs → API |
| WhatsApp dispatcher / webhook | Supabase → Edge Functions → Logs |
| Frontend errors | Browser console (F12) |
| Business activity | **Settings → Audit log** — who changed what, when |

---

## 9. Testing summary

### Automated — all passing

| Suite | Command | Covers |
|---|---|---|
| Database | `npm run db:test` | **56 assertions** on a real PostgreSQL 17 |
| Unit | `npm test` | **40 tests** — GST arithmetic, money, phone normalisation, message building |
| PDF | `npm run pdf:test` | **18 assertions** that the PDF contains real data |
| Types | `npm run typecheck` | Whole codebase, strict mode |
| Lint | `npm run lint` | Including the architectural boundary rule |
| Build | `npm run build` | Production PWA bundle |

`npm run verify` runs typecheck, lint, unit tests and the PDF check together.

**The database suite proves, against a real Postgres:** GST-inclusive maths
(₹8,000 → taxable ₹7,142.86, CGST ₹428.58 + SGST ₹428.56); gapless FY invoice
numbering surviving a rollback; issued invoices, payments, prescriptions and
stock ledger all immutable; order status machine rejecting invalid jumps; stock
deducted once and returned on cancellation; overpayment blocked; **duplicate
invoice, duplicate payment and duplicate order all blocked, with stock deducted
exactly once**; manual WhatsApp recorded as "opened" and *unable* to claim
delivery; dispatcher claiming messages exclusively across concurrent runs; RLS
denying anonymous users everything and staff the admin-only actions.

### Manual testing status — please read

The automated suites above run against a real database and real PDF bytes, and
they pass. **What has not been exercised is the assembled application against a
live Supabase project**, because no Supabase project exists yet — that requires
your account.

So these are verified by construction and type-checking but **not yet clicked
through**: the visual layout on a real phone, the Supabase Storage upload path
for prescription images, the browser print dialog output on your printer, and
the `wa.me` hand-off on your devices.

Work through GETTING-STARTED.md and then the checklist in §10. I expect these to
work; I am telling you plainly which ones I could not prove.

### Known limitations

1. **A website cannot attach files to WhatsApp.** Covered in §6.
2. **Automated WhatsApp is not connected** — needs the SIM and Meta account.
3. **Billing requires internet.** Offline invoice creation with a gapless GST
   series is not safely solvable; the app caches for offline *viewing* and shows
   a clear banner. A mobile hotspot is the practical fallback.
4. **Multi-branch is prepared, not built.** `branch_id` exists everywhere.
5. **Thermal/receipt printers** — the invoice is designed for A4. It will print
   on an 80 mm roll but the layout is not optimised for it.
6. **No Playwright end-to-end tests yet** — they need a live database to run
   against.

---

## 10. Go-live checklist

Before the first real customer bill:

- [ ] Supabase project created, migrations pushed, storage buckets created
- [ ] Public sign-up disabled
- [ ] **Two** admin accounts created
- [ ] Settings → Setup: every "Required" step green
- [ ] Shop name, address, phone, GSTIN, state code entered
- [ ] GST rates and HSN codes confirmed **with your accountant** and set per product
- [ ] Opening stock counted in for every frame
- [ ] A test bill created, printed, PDF downloaded, WhatsApp opened — then cancelled
- [ ] Supabase upgraded to **Pro** (daily backups)
- [ ] Deployed to a real URL; staff have the link on their phones
- [ ] One CSV export downloaded and stored off-site

Then, when you are ready: the dedicated WhatsApp SIM and Meta Business
verification.
