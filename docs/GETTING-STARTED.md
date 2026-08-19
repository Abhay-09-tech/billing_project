# Getting Started — how to actually use this

Written for someone who has never set up Supabase. Follow it top to bottom once;
after that, starting the system is one command.

**Time needed:** about 30 minutes.
**Cost right now:** ₹0 — everything below is on free tiers. You only start paying
when you go live with real bills (see [step 9](#9-before-you-bill-a-real-customer)).

---

## What you are setting up

There are two pieces:

| Piece | What it is | Where it runs |
|---|---|---|
| **The database** | Your customers, prescriptions, orders, bills, payments | Supabase (a hosted Postgres service) |
| **The app** | The screens your staff use | Your laptop for now; a web address later |

The app is useless without the database, so we set that up first.

---

## 1. Get the code onto your machine

Already done on this laptop — the project is at
`c:\Users\QHT-LT-01\PyCharmMiscProject\perfect-optical-vision`.

On any other computer:

```bash
git clone https://github.com/Abhay-09-tech/billing_project.git
cd billing_project
npm install
```

---

## 2. Create a free Supabase project

1. Go to **https://supabase.com** and sign up (GitHub login is easiest).
2. Click **New project**.
3. Fill in:
   - **Name:** `perfect-optical-vision`
   - **Database password:** click Generate, then **save it somewhere safe** —
     you cannot see it again, and you need it for backups and recovery.
   - **Region:** **Mumbai (ap-south-1)** — closest to you, so the app feels fast.
   - **Plan:** Free for now.
4. Wait about two minutes while it provisions.

---

## 3. Connect this project to it

In Supabase, open **Project Settings → General** and copy the **Reference ID**
(a short string like `abcdefghijklmnop`). Then, in the project folder:

```bash
npx supabase login          # opens your browser once
npx supabase link --project-ref PASTE_REFERENCE_ID_HERE
```

It will ask for the database password you saved in step 2.

---

## 4. Create the tables

```bash
npm run db:push
```

This applies all 10 migrations — 33 tables, security rules, the billing and
stock logic, and the starting data (roles, permissions, product categories,
WhatsApp templates, the `POV/26-27/00001` invoice numbering).

Confirm it worked: in Supabase, open **Table Editor**. You should see
`customers`, `orders`, `invoices` and the rest.

> Never create or change tables by clicking in the Supabase dashboard. Every
> change belongs in a migration file, so the schema stays reproducible and
> reviewable. See `docs/ARCHITECTURE.md` §7.1.

---

## 5. Tell the app where the database is

In Supabase: **Project Settings → API**. Copy two values:

- **Project URL** — looks like `https://abcdefghijklmnop.supabase.co`
- **anon public** key — a long string starting `eyJ...`

Create a file called `.env` in the project folder (copy `.env.example` and edit it):

```
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...your-long-key...
```

**The `anon` key is safe to put here.** It is designed to be public — every table
is protected by row-level security, so this key alone can read nothing. The key
you must *never* put in this file is the **`service_role`** key: it bypasses all
security. It belongs only in Edge Function secrets, later, for WhatsApp.

---

## 6. Turn off public sign-up

You do not want strangers creating accounts in your shop's system.

Supabase → **Authentication → Sign In / Providers → Email** → turn
**"Allow new users to sign up"** OFF.

Staff accounts are created by you, in the next step.

---

## 7. Create your admin account

**7a. Create the login.**
Supabase → **Authentication → Users → Add user → Create new user**.
Enter your email and a password. Tick **Auto Confirm User**.
Copy the **UID** it shows (a long id like `a1b2c3d4-...`).

**7b. Give it the Admin role.**
Supabase → **SQL Editor → New query**, paste this, replace the UID and name,
then Run:

```sql
insert into public.profiles (id, full_name, role_id, branch_id)
select
  'PASTE-THE-UID-HERE',
  'Your Name',
  r.id,
  b.id
from public.roles r, public.branches b
where r.code = 'admin' and b.is_default;
```

**7c. Do it again for a second admin.** Genuinely do this. If you lose access to
the only admin account, nobody can add users, change settings or fix prices.
It is the cheapest insurance in this whole system.

To add a **staff** member later, repeat 7a and 7b but change `r.code = 'admin'`
to `r.code = 'staff'`.

---

## 8. Create the two file buckets

Supabase → **Storage → New bucket**. Create both, and leave **Public** switched
**off** for each:

- `prescription-files` — photos of paper prescriptions
- `invoices` — generated invoice PDFs

Private is correct: the app hands out short-lived signed links instead, so
customer prescriptions are never on a public URL.

---

## 9. Start the app

```bash
npm run dev
```

Open the address it prints (usually **http://localhost:5173**) and sign in with
the email and password from step 7a.

You should land on the Dashboard, with every number at zero — because you have
no data yet. That is correct. Nothing in this system is faked.

**Try it end to end:**
1. **Customers → New customer** — type a name and mobile, save.
2. On the customer's page, **Add prescription** — enter the powers.
3. Go back to the Dashboard — "New customers" now reads 1.

That number came from a live database query. There are no hardcoded values
anywhere in the application.

---

## 10. Using it from your phone

While `npm run dev` is running, the terminal also prints a **Network** address
like `http://192.168.1.5:5173`. On a phone connected to the **same Wi-Fi**, open
that address. In Chrome, use **⋮ → Add to Home screen** to install it like an app.

This works for testing today. For the shop to use it properly — from mobile data,
from home, reliably — it needs to be deployed to a real web address. That is
Phase 12, and it takes about an hour.

---

## Before you bill a real customer

The billing screens are still being built, but when they land, do these first —
they affect every invoice you will ever issue:

- [ ] **Settings → Shop profile** — shop name, address, phone, **GSTIN**, state code, logo.
- [ ] **Confirm your GST rates with your CA** and set the rate + HSN code on each
      product. Nothing is hardcoded, so this is a one-time data entry job.
      (Frames and corrective lenses are commonly at one rate and sunglasses at
      another — do not assume, confirm.)
- [ ] **Enter opening stock** for every frame you hold, using
      Inventory → Add stock with reason "Opening stock". This keeps day-one
      quantities auditable rather than magic numbers.
- [ ] **Upgrade Supabase to Pro** (about ₹2,100/month). The free tier has no daily
      backups. For a database holding your shop's financial records, that is not
      an acceptable risk. Do this on the day you issue your first real bill.
- [ ] **Turn on Point-in-Time Recovery** once you have a few months of billing
      (about ₹850/month extra). It lets you rewind the database to any moment.

---

## When you are ready for WhatsApp

You will need, in this order:

1. A **new SIM card** with a number that has never been used on WhatsApp or
   WhatsApp Business (this was your decision — it keeps the shop's existing
   number working normally on the WhatsApp Business app).
2. A **Meta Business account**, verified. Verification can take several days,
   so start it early.
3. **WhatsApp Business Platform** set up on that number, then submit the five
   message templates for approval.
4. Put the credentials into Edge Function secrets — **never** into `.env`:

```bash
npx supabase secrets set WHATSAPP_ACCESS_TOKEN=... \
                         WHATSAPP_PHONE_NUMBER_ID=... \
                         WHATSAPP_APP_SECRET=... \
                         WHATSAPP_VERIFY_TOKEN=...
```

Everything else in the system works without WhatsApp. It is the last piece, not
a prerequisite.

---

## Daily commands

| What you want | Command |
|---|---|
| Start the app | `npm run dev` |
| Stop it | `Ctrl + C` in that terminal |
| Get the latest code | `git pull` then `npm install` |
| Apply new database changes | `npm run db:push` |
| Check nothing is broken | `npm run verify` and `npm run db:test` |

---

## If something goes wrong

**"Missing VITE_SUPABASE_URL"** — the `.env` file is missing, in the wrong folder,
or the dev server was started before you created it. Fix the file, stop the server
with Ctrl+C and run `npm run dev` again.

**You sign in, then get bounced straight back to the login screen** — the auth user
exists but has no `profiles` row, or its `is_active` is false. Redo step 7b.

**Every screen is empty and the dashboard shows zeros for data you know exists** —
the signed-in user's role has no permissions, or the profile row points at the
wrong role. Check `profiles.role_id` matches the role you intended.

**"You do not have permission for this action"** — working as designed: staff cannot
cancel invoices, change settings, manage users or edit prices. Sign in as an admin.

**`npm run db:push` fails** — you are not linked to the project. Rerun step 3.

If you are stuck, `npm run db:test` proves whether the database logic itself is
sound (it runs against a throwaway local Postgres and never touches your real
data). If that passes, the problem is configuration, not code.
