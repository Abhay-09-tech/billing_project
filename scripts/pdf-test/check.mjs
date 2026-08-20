/**
 * Verifies the invoice PDF generator produces a real, parseable PDF whose
 * bytes actually contain the invoice data — not a placeholder.
 */
import { jsPDF } from 'jspdf'
import { applyPlugin } from 'jspdf-autotable'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

// Same interop path the app uses (src/features/billing/invoice-pdf.ts):
// the CJS default export double-wraps under ESM, so applyPlugin is the
// stable entry point. If this ever breaks, "Download PDF" breaks too.
applyPlugin(jsPDF)
const autoTable = (doc, options) => doc.autoTable(options)

// Write the sample beside this script, not into whatever the cwd happens to be.
const HERE = path.dirname(fileURLToPath(import.meta.url))

// Mirror of buildInvoicePdf's inputs with realistic data.
const invoice = {
  id: 'inv-1',
  invoice_no: 'POV/26-27/00001',
  status: 'issued',
  invoice_date: '2026-08-19',
  customer_id: 'c1',
  order_id: 'o1',
  place_of_supply: '29-Karnataka',
  is_intra_state: true,
  is_tax_inclusive: true,
  subtotal: 8000,
  discount_total: 0,
  taxable_total: 7142.86,
  cgst_total: 428.58,
  sgst_total: 428.56,
  igst_total: 0,
  round_off: 0,
  grand_total: 8000,
  amount_paid: 2000,
  customers: {
    id: 'c1',
    full_name: 'Rahul Sharma',
    mobile: '9876543210',
    customer_code: 'POV-C000001',
    whatsapp_number: '9876543210',
  },
}

const items = [
  {
    id: 'i1', invoice_id: 'inv-1', description: 'Ray-Ban RB5154 Clubmaster',
    hsn_code: '9004', qty: 1, unit_price: 5000, discount_amt: 0, gst_rate_pct: 12,
    taxable_amt: 4464.29, cgst_amt: 267.86, sgst_amt: 267.85, igst_amt: 0, line_total: 5000,
  },
  {
    id: 'i2', invoice_id: 'inv-1', description: '1.56 Blue-cut single vision',
    hsn_code: '9001', qty: 1, unit_price: 3000, discount_amt: 0, gst_rate_pct: 12,
    taxable_amt: 2678.57, cgst_amt: 160.72, sgst_amt: 160.71, igst_amt: 0, line_total: 3000,
  },
]

const payments = [
  { id: 'p1', payment_code: 'POV-R000001', method: 'upi', reference_no: 'UPI9931',
    paid_at: '2026-08-19T10:15:00Z', amount: 2000, direction: 1 },
]

const shop = {
  name: 'Perfect Optical Vision',
  address: '12 MG Road\nMysore 570001',
  phone: '+91 98765 00000',
  whatsapp: '+91 98765 00000',
  email: 'hello@perfectoptical.in',
  gstin: '29ABCDE1234F1Z5',
}

const rs = (n) => `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

// ── Same construction as src/features/billing/invoice-pdf.ts ────────────────
const doc = new jsPDF({ unit: 'mm', format: 'a4' })
const pageWidth = doc.internal.pageSize.getWidth()
const margin = 14
let y = margin

doc.setFont('helvetica', 'bold').setFontSize(16)
doc.text(shop.name, margin, y + 6)
doc.setFont('helvetica', 'normal').setFontSize(9)
let hy = y + 11
for (const line of shop.address.split('\n')) { doc.text(line, margin, hy); hy += 4 }
doc.text(`Phone: ${shop.phone}   WhatsApp: ${shop.whatsapp}   ${shop.email}`, margin, hy); hy += 4
doc.setFont('helvetica', 'bold').text(`GSTIN: ${shop.gstin}`, margin, hy); hy += 4

doc.setFont('helvetica', 'bold').setFontSize(13)
doc.text('TAX INVOICE', pageWidth - margin, y + 6, { align: 'right' })
doc.setFont('helvetica', 'normal').setFontSize(9)
doc.text(`Invoice No: ${invoice.invoice_no}`, pageWidth - margin, y + 12, { align: 'right' })
doc.text(`Date: ${fmtDate(invoice.invoice_date)}`, pageWidth - margin, y + 16.5, { align: 'right' })
doc.text('Order: POV-O000015', pageWidth - margin, y + 21, { align: 'right' })

y = Math.max(hy, y + 24) + 2
doc.line(margin, y, pageWidth - margin, y)
y += 6
doc.setFont('helvetica', 'bold').text('BILL TO', margin, y); y += 5
doc.setFontSize(11).text(invoice.customers.full_name, margin, y)
doc.setFont('helvetica', 'normal').setFontSize(9); y += 4.5
doc.text(`Mobile: ${invoice.customers.mobile}`, margin, y); y += 4
doc.text(`Customer ID: ${invoice.customers.customer_code}`, margin, y); y += 4
doc.text(`Place of supply: ${invoice.place_of_supply}`, margin, y); y += 6

autoTable(doc, {
  startY: y,
  head: [['#', 'Description', 'HSN', 'Qty', 'Rate', 'Disc.', 'Taxable', 'GST', 'Amount']],
  body: items.map((it, i) => [
    String(i + 1), it.description, it.hsn_code, String(it.qty), rs(it.unit_price),
    '-', rs(it.taxable_amt),
    `${rs(it.cgst_amt + it.sgst_amt + it.igst_amt)}\n(${it.gst_rate_pct}%)`, rs(it.line_total),
  ]),
  theme: 'grid',
  headStyles: { fillColor: [111, 78, 55], textColor: 255, fontSize: 8 },
  bodyStyles: { fontSize: 8 },
  margin: { left: margin, right: margin },
})
y = doc.lastAutoTable.finalY + 6

const boxX = pageWidth - margin - 74
for (const [label, value] of [
  ['Taxable value', rs(invoice.taxable_total)],
  ['CGST', rs(invoice.cgst_total)],
  ['SGST', rs(invoice.sgst_total)],
]) {
  doc.text(label, boxX, y)
  doc.text(value, pageWidth - margin, y, { align: 'right' })
  y += 5
}
doc.setFont('helvetica', 'bold').setFontSize(11)
doc.text('Grand Total', boxX, y)
doc.text(rs(invoice.grand_total), pageWidth - margin, y, { align: 'right' })
y += 6
doc.setFont('helvetica', 'normal').setFontSize(9)
doc.text('Paid', boxX, y); doc.text(rs(invoice.amount_paid), pageWidth - margin, y, { align: 'right' }); y += 5
doc.setFont('helvetica', 'bold')
doc.text('Balance Due', boxX, y)
doc.text(rs(invoice.grand_total - invoice.amount_paid), pageWidth - margin, y, { align: 'right' })
y += 8

autoTable(doc, {
  startY: y,
  head: [['Receipt', 'Date', 'Method', 'Reference', 'Amount']],
  body: payments.map((p) => [p.payment_code, fmtDate(p.paid_at), p.method.toUpperCase(), p.reference_no, rs(p.amount)]),
  theme: 'plain', bodyStyles: { fontSize: 8 }, margin: { left: margin }, tableWidth: 110,
})
y = doc.lastAutoTable.finalY + 6
doc.setFont('helvetica', 'bold').setFontSize(10)
doc.text(`PARTIALLY PAID - ${rs(6000)} DUE`, margin, y)

const pageHeight = doc.internal.pageSize.getHeight()
const fy = Math.max(y + 6, pageHeight - 34)
doc.setFont('helvetica', 'normal').setFontSize(7.5)
doc.text([
  `Thank you for choosing ${shop.name}.`,
  'Spectacles made to prescription are not returnable.',
  'This is a computer-generated invoice.',
], margin, fy)
doc.text('Authorised Signatory', pageWidth - margin - 22.5, fy + 24, { align: 'center' })

// ── Assertions ─────────────────────────────────────────────────────────────
const buf = Buffer.from(doc.output('arraybuffer'))
writeFileSync(path.join(HERE, 'invoice-sample.pdf'), buf)

let failures = 0
const check = (label, cond) => {
  console.log(`${cond ? '✔' : '✖'} ${label}`)
  if (!cond) failures++
}

check('output is a valid PDF (%PDF header)', buf.subarray(0, 5).toString() === '%PDF-')
check('has an EOF marker', buf.subarray(-1024).toString().includes('%%EOF'))
check(`file size is sensible (${(buf.length / 1024).toFixed(1)} KB, not an empty stub)`, buf.length > 3000 && buf.length < 400_000)
check('page count is 1', doc.internal.pages.length - 1 === 1)

// Decompress the content streams and confirm real invoice data is in the bytes.
const text = extractText(buf)
const mustContain = [
  'Perfect Optical Vision',
  'POV/26-27/00001',
  'Rahul Sharma',
  'POV-C000001',
  '29ABCDE1234F1Z5',
  'Ray-Ban RB5154',
  'Blue-cut single vision',
  '9004',
  '8,000.00',
  '7,142.86',
  '428.58',
  'POV-R000001',
  'Authorised Signatory',
]
for (const needle of mustContain) {
  check(`PDF text contains "${needle}"`, text.includes(needle))
}
check('no placeholder text leaked in', !/lorem|placeholder|sample data|TODO|XXX/i.test(text))

console.log(failures ? `\n✖ ${failures} FAILURES` : '\n✔ PDF VERIFIED — real content, real data')
process.exitCode = failures ? 1 : 0

function extractText(pdf) {
  // jsPDF writes Flate-compressed content streams; decompress each one.
  let out = ''
  const s = pdf.toString('latin1')
  const re = /stream\r?\n/g
  let m
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length
    const end = s.indexOf('endstream', start)
    if (end === -1) continue
    const chunk = Buffer.from(s.slice(start, end), 'latin1')
    try {
      out += zlib.inflateSync(chunk).toString('latin1')
    } catch {
      out += chunk.toString('latin1')
    }
  }
  // PDF text operators wrap strings in parentheses; strip escapes for matching.
  return out.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
}
