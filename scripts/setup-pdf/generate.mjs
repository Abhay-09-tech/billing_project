/**
 * Generates the setup & reference PDF handed to the shop owner.
 *
 * Text is drawn as real text (not an image), so every SQL block can be
 * selected and copied straight out of the PDF into the Supabase SQL Editor.
 *
 * jsPDF's built-in fonts are WinAnsi/Latin-1 only: arrows, checkmarks and the
 * rupee sign render as garbage. Everything here stays inside that character
 * set deliberately — the same lesson the invoice generator learned.
 */
import { jsPDF } from 'jspdf'
import { writeFileSync } from 'node:fs'

const PROJECT_REF = process.env.POV_PROJECT_REF ?? 'YOUR-PROJECT-REF'
const PROJECT_URL = process.env.POV_PROJECT_URL ?? 'https://YOUR-PROJECT-REF.supabase.co'
const LAN_URL = process.env.POV_LAN_URL ?? 'http://localhost:5173/'
const OUT = process.env.POV_PDF_OUT ?? 'Perfect-Optical-Vision-Setup-Queries.pdf'

const doc = new jsPDF({ unit: 'mm', format: 'a4' })
const W = doc.internal.pageSize.getWidth()
const H = doc.internal.pageSize.getHeight()
const M = 16
const CONTENT = W - M * 2

const TEAL = [15, 118, 110]
const INK = [17, 24, 39]
const MUTED = [90, 98, 110]
const RULE = [206, 212, 218]
const CODE_BG = [244, 246, 248]
const WARN_BG = [254, 243, 199]
const WARN_INK = [146, 64, 14]

let y = 0
let page = 0

function footer() {
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
  doc.text('Perfect Optical Vision - Setup & Reference', M, H - 8)
  doc.text('Page ' + page, W - M, H - 8, { align: 'right' })
}

function newPage() {
  if (page > 0) footer()
  doc.addPage()
  page++
  y = M
}

function need(mm) {
  if (y + mm > H - 16) newPage()
}

function h1(text) {
  need(16)
  y += 3
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...TEAL)
  doc.text(text, M, y)
  y += 2.5
  doc.setDrawColor(...TEAL).setLineWidth(0.5).line(M, y, M + CONTENT, y)
  y += 6
}

function h2(text) {
  need(12)
  y += 2
  doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...INK)
  doc.text(text, M, y)
  y += 5
}

function para(text, opts = {}) {
  const size = opts.size ?? 9.5
  const color = opts.color ?? MUTED
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal').setFontSize(size).setTextColor(...color)
  for (const line of doc.splitTextToSize(text, CONTENT)) {
    need(5)
    doc.text(line, M, y)
    y += 4.6
  }
  y += 1.5
}

function bullets(items) {
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...MUTED)
  for (const item of items) {
    const lines = doc.splitTextToSize(item, CONTENT - 5)
    lines.forEach((line, i) => {
      need(5)
      if (i === 0) doc.text('-', M, y)
      doc.text(line, M + 4.5, y)
      y += 4.6
    })
  }
  y += 1.5
}

/** Monospace block on a tinted card. Copyable as real text. */
function code(sql) {
  const lines = sql.trim().split('\n')
  const lineH = 4.3
  const padY = 3.5
  const boxH = lines.length * lineH + padY * 2

  // Keep short blocks whole; very long ones may legitimately break pages.
  if (boxH < 70) need(boxH + 3)

  doc.setFillColor(...CODE_BG).setDrawColor(...RULE).setLineWidth(0.2)
  doc.roundedRect(M, y, CONTENT, boxH, 1.5, 1.5, 'FD')

  doc.setFont('courier', 'normal').setFontSize(8.3).setTextColor(...INK)
  let ly = y + padY + 3
  for (const line of lines) {
    doc.text(line, M + 3, ly)
    ly += lineH
  }
  y += boxH + 4
}

function callout(title, body, tone) {
  const bg = tone === 'info' ? CODE_BG : WARN_BG
  const ink = tone === 'info' ? INK : WARN_INK
  doc.setFont('helvetica', 'bold').setFontSize(9.5)
  const bodyLines = doc.splitTextToSize(body, CONTENT - 8)
  const boxH = 6 + bodyLines.length * 4.4 + 5
  need(boxH + 3)

  doc.setFillColor(...bg).setDrawColor(...bg)
  doc.roundedRect(M, y, CONTENT, boxH, 1.5, 1.5, 'F')
  doc.setTextColor(...ink)
  doc.text(title, M + 4, y + 6)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  let ly = y + 11
  for (const line of bodyLines) {
    doc.text(line, M + 4, ly)
    ly += 4.4
  }
  y += boxH + 4
}

function kv(rows) {
  doc.setFontSize(9.5)
  for (const [k, v] of rows) {
    need(5.2)
    doc.setFont('helvetica', 'bold').setTextColor(...INK)
    doc.text(k, M, y)
    doc.setFont('helvetica', 'normal').setTextColor(...MUTED)
    doc.text(String(v), M + 52, y)
    y += 5.2
  }
  y += 2
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------
page = 1
y = M

doc.setFillColor(...TEAL).rect(0, 0, W, 42, 'F')
doc.setFont('helvetica', 'bold').setFontSize(21).setTextColor(255)
doc.text('Perfect Optical Vision', M, 20)
doc.setFont('helvetica', 'normal').setFontSize(11)
doc.text('Setup & Reference - Database Queries', M, 29)
doc.setFontSize(8.5)
doc.text('Optical retail management, billing and WhatsApp', M, 36)
y = 52

para(
  'Everything needed to finish setting up the system and to manage it afterwards. ' +
    'Every SQL block below can be selected and copied straight out of this PDF and ' +
    'pasted into the Supabase SQL Editor.',
  { color: INK },
)

h2('Your project')
kv([
  ['Project URL', PROJECT_URL],
  ['Project reference', PROJECT_REF],
  ['Supabase dashboard', 'https://supabase.com/dashboard'],
  ['App (this laptop)', 'http://localhost:5173/'],
  ['App (phone, same Wi-Fi)', LAN_URL],
])

h2('Already installed and verified')
bullets([
  '33 tables, 41 functions, 58 row-level security policies',
  'Security enabled on every single table - no table is left open',
  'Roles (Admin, Staff) and 33 permissions',
  '11 order statuses covering the full optical workflow',
  '5 WhatsApp message templates',
  'Invoice series POV/26-27/00001, resetting each financial year',
  'GST configured as: regular registration, prices include GST, 12% default',
])

callout(
  'Do this first: reset your database password',
  'The database password was shared in chat, so it must be treated as exposed. Go to ' +
    'Project Settings > Database > Reset database password. Nothing in the application ' +
    'uses that password - it is only for direct database access - so resetting it ' +
    'breaks nothing.',
)

// ---------------------------------------------------------------------------
newPage()
h1('1. Create your admin login')

para(
  'This is the account you sign in to the shop system with. Two parts: create the ' +
    'login, then give it Admin rights.',
)

h2('Step 1a - Create the user')
bullets([
  'Supabase dashboard > Authentication > Users',
  'Click "Add user" then "Create new user"',
  'Enter your email address and a password',
  'Tick "Auto Confirm User" - without this you cannot sign in yet',
  'Click Create user',
])

h2('Step 1b - Give it Admin rights')
para('Open SQL Editor > New query. Replace the two values in capitals, then Run:')
code(
  "insert into public.profiles (id, full_name, role_id, branch_id)\n" +
    "select u.id, 'YOUR NAME', r.id, b.id\n" +
    "from auth.users u, public.roles r, public.branches b\n" +
    "where u.email = 'YOUR-EMAIL-HERE'\n" +
    "  and r.code = 'admin'\n" +
    "  and b.is_default\n" +
    'on conflict (id) do update\n' +
    '  set role_id = excluded.role_id, is_active = true;',
)

para(
  'Safe to run more than once. If the profile already exists it is updated rather ' +
    'than duplicated.',
)

callout(
  'Create a second admin account',
  'Repeat steps 1a and 1b with a different email address. If you lose access to the ' +
    'only admin account, nobody can add staff, change prices or edit settings. This is ' +
    'the cheapest insurance in the whole system.',
)

h2('Check it worked')
code(
  'select p.full_name, u.email, r.name as role, p.is_active\n' +
    'from public.profiles p\n' +
    'join auth.users u on u.id = p.id\n' +
    'join public.roles r on r.id = p.role_id\n' +
    'order by p.created_at;',
)

// ---------------------------------------------------------------------------
newPage()
h1('2. Managing staff')

h2('Add a staff member')
para(
  'Create the user in Authentication > Users exactly as above, then run this. Note ' +
    'that r.code is "staff" here, not "admin":',
)
code(
  "insert into public.profiles (id, full_name, role_id, branch_id)\n" +
    "select u.id, 'STAFF NAME', r.id, b.id\n" +
    "from auth.users u, public.roles r, public.branches b\n" +
    "where u.email = 'STAFF-EMAIL-HERE'\n" +
    "  and r.code = 'staff'\n" +
    "  and b.is_default\n" +
    'on conflict (id) do update\n' +
    '  set role_id = excluded.role_id, is_active = true;',
)

h2('What Staff can and cannot do')
bullets([
  'CAN: create customers, prescriptions, orders and bills; record payments; update order status; send WhatsApp',
  'CANNOT: cancel invoices, issue refunds, edit product prices, change settings, manage users, export data',
])

h2('Remove access for someone who has left')
para(
  'Never delete the row. Deactivating keeps their name on the orders and bills they ' +
    'created, which you need for your records:',
)
code(
  'update public.profiles\n' +
    '   set is_active = false\n' +
    " where id = (select id from auth.users where email = 'THEIR-EMAIL');",
)

h2('Change someone from Staff to Admin, or back')
code(
  'update public.profiles\n' +
    "   set role_id = (select id from public.roles where code = 'admin')\n" +
    " where id = (select id from auth.users where email = 'THEIR-EMAIL');",
)

h2('Reset a forgotten password')
bullets([
  'Supabase dashboard > Authentication > Users',
  'Find the person and click the three dots at the end of their row',
  'Choose "Reset password" to email them a link, or "Update password" to set one directly',
])

// ---------------------------------------------------------------------------
newPage()
h1('3. Before you bill a real customer')

para('These affect every invoice you will ever issue, so set them before the first real bill.')

bullets([
  'Settings > Shop: shop name, address, phone, WhatsApp, email, GSTIN, state code',
  'Confirm your GST rates with your accountant, then set the rate and HSN code on each product. Nothing is hardcoded.',
  'Enter opening stock for every frame you hold: Inventory > Update stock > reason "Opening stock"',
  'Upgrade Supabase to Pro (about Rs. 2,100/month) for daily backups. The free tier has none.',
])

callout(
  'Why backups matter more than they sound',
  'The free plan keeps no daily backup of your database. If something goes wrong after ' +
    'you have months of billing history, there is nothing to restore from. Upgrade on ' +
    'the day you issue your first real bill, not later.',
)

h1('4. Useful checks')

h2('Is anything wrong with stock?')
para(
  'Compares the stock ledger against the cached quantity. Any row returned means a ' +
    'mismatch worth investigating:',
)
code(
  'select p.name, p.sku, ps.qty_on_hand as cached,\n' +
    '       coalesce(sum(it.qty_delta), 0) as from_ledger\n' +
    'from public.products p\n' +
    'join public.product_stock ps on ps.product_id = p.id\n' +
    'left join public.inventory_transactions it on it.product_id = p.id\n' +
    'where p.is_stock_tracked\n' +
    'group by p.name, p.sku, ps.qty_on_hand\n' +
    'having ps.qty_on_hand <> coalesce(sum(it.qty_delta), 0);',
)

h2('Today at a glance')
code(
  'select\n' +
    '  (select count(*) from public.orders\n' +
    '     where created_at::date = current_date) as orders_today,\n' +
    '  (select coalesce(sum(grand_total), 0) from public.invoices\n' +
    "     where invoice_date = current_date and status = 'issued') as sales_today,\n" +
    '  (select coalesce(sum(amount * direction), 0) from public.payments\n' +
    '     where paid_at::date = current_date) as collected_today;',
)

h2('Who owes money')
code(
  'select c.full_name, c.mobile, i.invoice_no,\n' +
    '       i.grand_total - i.amount_paid as balance,\n' +
    '       current_date - i.invoice_date as days\n' +
    'from public.invoices i\n' +
    'join public.customers c on c.id = i.customer_id\n' +
    "where i.status = 'issued'\n" +
    '  and i.amount_paid < i.grand_total\n' +
    'order by days desc;',
)

// ---------------------------------------------------------------------------
newPage()
h1('5. Keeping it safe')

h2('The two kinds of key')
bullets([
  'Publishable key (sb_publishable_...): safe to put in the app and in this document. Every table is protected by row-level security, so this key alone can read nothing. Signing in is still required.',
  'Secret key (sb_secret_...): bypasses ALL security. Never put it in the app, a browser, a screenshot or a chat. It belongs only in server-side settings.',
])

callout(
  'The app refuses secret keys on purpose',
  'If a secret key is ever pasted into the Connect screen, it is detected and rejected ' +
    'with an explanation. This covers both the current sb_secret_ format and the older ' +
    'service_role keys.',
  'info',
)

h2('What protects your customer data')
bullets([
  'Row-level security on all 33 tables - the database itself refuses unauthorised reads, not just the app',
  'Permissions are data, not code, so roles can change without a developer',
  'Issued invoices cannot be edited; corrections are credit notes',
  'Payments and stock movements are append-only; mistakes are reversed, never deleted',
  'Prescriptions are versioned and never overwritten',
  'Every important action is written to an audit log with who did it and when',
])

h1('6. Applying future updates')

para('The migrations folder is the source of truth for the schema. To apply later changes:')
code('npx supabase login\nnpx supabase link --project-ref ' + PROJECT_REF + '\nnpm run db:push')

para(
  'Do not re-paste the full schema file after the first install. It is written to ' +
    'refuse a second run so it cannot half-apply over your live data.',
)

h2('Running the app')
code(
  'npm run dev -- --host    # start, reachable from your phone\n' +
    'npm run verify           # typecheck, lint and tests\n' +
    'npm run db:test          # 56 checks against a throwaway database',
)

footer()
writeFileSync(OUT, Buffer.from(doc.output('arraybuffer')))
console.log('Written: ' + OUT + ' (' + page + ' pages)')
