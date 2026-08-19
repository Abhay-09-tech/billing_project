/**
 * Invoice PDF generation.
 *
 * Built programmatically with jsPDF rather than by screenshotting the page:
 * the text stays selectable and searchable, the file is a few KB instead of
 * megabytes, and it prints crisply at any size. Every value comes from the
 * invoice record — there is no sample or placeholder content anywhere in here.
 */
import jsPDF from 'jspdf'
import { applyPlugin, type UserOptions } from 'jspdf-autotable'
import type { CustomerRow, InvoiceItemRow, PaymentRow } from '@/types/database'

// jspdf-autotable is CommonJS and its default export double-wraps under ESM
// (`default.default` is the real function), which breaks at runtime depending
// on the bundler's interop. The named applyPlugin is the documented, stable
// entry point: it attaches .autoTable to the jsPDF prototype.
applyPlugin(jsPDF)

type AutoTableDoc = jsPDF & {
  autoTable: (options: UserOptions) => void
  lastAutoTable: { finalY: number }
}

const autoTable = (doc: jsPDF, options: UserOptions) => (doc as AutoTableDoc).autoTable(options)
const lastTableY = (doc: jsPDF) => (doc as AutoTableDoc).lastAutoTable.finalY
import type { InvoiceWithCustomer } from '@/services/billing'
import { formatDate, formatMobile } from '@/lib/format'

export interface ShopProfile {
  name?: string
  address?: string
  phone?: string
  whatsapp?: string
  email?: string
  gstin?: string
  state_code?: string
  logo_data_url?: string | null
}

export interface InvoicePdfInput {
  invoice: InvoiceWithCustomer
  items: InvoiceItemRow[]
  payments: PaymentRow[]
  shop: ShopProfile
  customer?: Pick<CustomerRow, 'customer_code' | 'whatsapp_number' | 'mobile' | 'full_name'> | null
  address?: string | null
  orderCode?: string | null
}

// ₹ is not in jsPDF's built-in fonts, so the glyph would render as a black
// box. "Rs." is unambiguous on an Indian invoice and always renders.
const rs = (n: number | string) =>
  `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function buildInvoicePdf(input: InvoicePdfInput): jsPDF {
  const { invoice, items, payments, shop, customer, address, orderCode } = input
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  let y = margin

  // ── Shop header ──────────────────────────────────────────────────────────
  if (shop.logo_data_url) {
    try {
      doc.addImage(shop.logo_data_url, 'PNG', margin, y, 18, 18)
    } catch {
      /* a bad logo must never stop a bill printing */
    }
  }
  const textX = shop.logo_data_url ? margin + 22 : margin

  doc.setFont('helvetica', 'bold').setFontSize(16)
  doc.text(shop.name || 'Perfect Optical Vision', textX, y + 6)

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(70)
  let headerY = y + 11
  if (shop.address) {
    for (const line of shop.address.split('\n').slice(0, 3)) {
      doc.text(line, textX, headerY)
      headerY += 4
    }
  }
  const contact = [
    shop.phone ? `Phone: ${shop.phone}` : null,
    shop.whatsapp ? `WhatsApp: ${shop.whatsapp}` : null,
    shop.email || null,
  ]
    .filter(Boolean)
    .join('   ')
  if (contact) {
    doc.text(contact, textX, headerY)
    headerY += 4
  }
  if (shop.gstin) {
    doc.setFont('helvetica', 'bold').setTextColor(0)
    doc.text(`GSTIN: ${shop.gstin}`, textX, headerY)
    headerY += 4
  }

  // ── Invoice block (right) ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(0)
  doc.text('TAX INVOICE', pageWidth - margin, y + 6, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.text(`Invoice No: ${invoice.invoice_no ?? '—'}`, pageWidth - margin, y + 12, { align: 'right' })
  doc.text(
    `Date: ${invoice.invoice_date ? formatDate(invoice.invoice_date) : '—'}`,
    pageWidth - margin,
    y + 16.5,
    { align: 'right' },
  )
  if (orderCode) {
    doc.text(`Order: ${orderCode}`, pageWidth - margin, y + 21, { align: 'right' })
  }

  y = Math.max(headerY, y + 24) + 2
  doc.setDrawColor(0).setLineWidth(0.4).line(margin, y, pageWidth - margin, y)
  y += 6

  // ── Customer ─────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold').setFontSize(9)
  doc.text('BILL TO', margin, y)
  y += 5
  doc.setFont('helvetica', 'bold').setFontSize(11)
  doc.text(invoice.customers?.full_name ?? customer?.full_name ?? '—', margin, y)
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(70)
  y += 4.5

  const custMobile = invoice.customers?.mobile ?? customer?.mobile
  if (custMobile) {
    doc.text(`Mobile: ${formatMobile(custMobile)}`, margin, y)
    y += 4
  }
  const custWa = invoice.customers?.whatsapp_number ?? customer?.whatsapp_number
  if (custWa && custWa !== custMobile) {
    doc.text(`WhatsApp: ${formatMobile(custWa)}`, margin, y)
    y += 4
  }
  const custCode = invoice.customers?.customer_code ?? customer?.customer_code
  if (custCode) {
    doc.text(`Customer ID: ${custCode}`, margin, y)
    y += 4
  }
  if (address) {
    for (const line of address.split('\n').slice(0, 2)) {
      doc.text(line, margin, y)
      y += 4
    }
  }
  if (invoice.place_of_supply) {
    doc.text(`Place of supply: ${invoice.place_of_supply}`, margin, y)
    y += 4
  }
  y += 2

  // ── Items ────────────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [['#', 'Description', 'HSN', 'Qty', 'Rate', 'Disc.', 'Taxable', 'GST', 'Amount']],
    body: items.map((item, i) => [
      String(i + 1),
      item.description,
      item.hsn_code ?? '-',
      String(Number(item.qty)),
      rs(item.unit_price),
      Number(item.discount_amt) > 0 ? rs(item.discount_amt) : '-',
      rs(item.taxable_amt),
      `${rs(Number(item.cgst_amt) + Number(item.sgst_amt) + Number(item.igst_amt))}\n(${item.gst_rate_pct}%)`,
      rs(item.line_total),
    ]),
    theme: 'grid',
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: 30 },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      2: { cellWidth: 16 },
      3: { cellWidth: 12, halign: 'right' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 18, halign: 'right' },
      6: { cellWidth: 22, halign: 'right' },
      7: { cellWidth: 24, halign: 'right' },
      8: { cellWidth: 24, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  })

  y = lastTableY(doc) + 6

  // ── Totals ───────────────────────────────────────────────────────────────
  const totalRows: Array<[string, string]> = [['Taxable value', rs(invoice.taxable_total)]]
  if (Number(invoice.discount_total) > 0) {
    totalRows.push(['Discount', `- ${rs(invoice.discount_total)}`])
  }
  if (invoice.is_intra_state) {
    totalRows.push(['CGST', rs(invoice.cgst_total)], ['SGST', rs(invoice.sgst_total)])
  } else {
    totalRows.push(['IGST', rs(invoice.igst_total)])
  }
  if (Number(invoice.round_off) !== 0) totalRows.push(['Round off', rs(invoice.round_off)])

  const balance = Number(invoice.grand_total) - Number(invoice.amount_paid)
  const boxX = pageWidth - margin - 74

  doc.setFontSize(9).setTextColor(30)
  for (const [label, value] of totalRows) {
    doc.setFont('helvetica', 'normal')
    doc.text(label, boxX, y)
    doc.text(value, pageWidth - margin, y, { align: 'right' })
    y += 5
  }

  doc.setLineWidth(0.3).setDrawColor(0).line(boxX, y - 1, pageWidth - margin, y - 1)
  y += 4
  doc.setFont('helvetica', 'bold').setFontSize(11)
  doc.text('Grand Total', boxX, y)
  doc.text(rs(invoice.grand_total), pageWidth - margin, y, { align: 'right' })
  y += 6

  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.text('Paid', boxX, y)
  doc.text(rs(invoice.amount_paid), pageWidth - margin, y, { align: 'right' })
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.text('Balance Due', boxX, y)
  doc.text(rs(balance), pageWidth - margin, y, { align: 'right' })
  y += 8

  // ── Payments received ────────────────────────────────────────────────────
  const received = payments.filter((p) => p.direction > 0)
  if (received.length > 0) {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(0)
    doc.text('Payments received', margin, y)
    y += 2
    autoTable(doc, {
      startY: y,
      head: [['Receipt', 'Date', 'Method', 'Reference', 'Amount']],
      body: received.map((p) => [
        p.payment_code,
        formatDate(p.paid_at),
        p.method.replace('_', ' ').toUpperCase(),
        p.reference_no ?? '-',
        rs(p.amount),
      ]),
      theme: 'plain',
      headStyles: { fontSize: 8, fontStyle: 'bold', textColor: 80 },
      bodyStyles: { fontSize: 8, textColor: 50 },
      columnStyles: { 4: { halign: 'right' } },
      margin: { left: margin, right: margin },
      tableWidth: 110,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6
  }

  // Payment status stamp
  doc.setFont('helvetica', 'bold').setFontSize(10)
  if (balance <= 0.005) {
    doc.setTextColor(21, 128, 61).text('PAID IN FULL', margin, y)
  } else if (Number(invoice.amount_paid) > 0) {
    doc.setTextColor(180, 83, 9).text(`PARTIALLY PAID — ${rs(balance)} DUE`, margin, y)
  } else {
    doc.setTextColor(185, 28, 28).text(`UNPAID — ${rs(balance)} DUE`, margin, y)
  }
  y += 8

  // ── Footer, pinned to the bottom of the last page ────────────────────────
  const pageHeight = doc.internal.pageSize.getHeight()
  const footerY = Math.max(y, pageHeight - 34)

  doc.setDrawColor(150).setLineWidth(0.2).line(margin, footerY, pageWidth - margin, footerY)
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(90)
  doc.text(
    [
      `Thank you for choosing ${shop.name || 'Perfect Optical Vision'}.`,
      'Spectacles made to prescription are not returnable. Please check the fit and vision before leaving the counter.',
      'Warranty on frames is as per manufacturer terms. Please bring this invoice for any service or warranty claim.',
      'This is a computer-generated invoice.',
    ],
    margin,
    footerY + 5,
  )

  doc.setDrawColor(120).line(pageWidth - margin - 45, footerY + 20, pageWidth - margin, footerY + 20)
  doc.setFontSize(8).setTextColor(60)
  doc.text('Authorised Signatory', pageWidth - margin - 22.5, footerY + 24, { align: 'center' })

  return doc
}

export function invoiceFileName(invoice: InvoiceWithCustomer): string {
  const safe = (invoice.invoice_no ?? 'draft').replace(/[^\w-]+/g, '-')
  const who = (invoice.customers?.full_name ?? 'customer').replace(/[^\w]+/g, '-')
  return `Invoice-${safe}-${who}.pdf`
}

export function downloadInvoicePdf(input: InvoicePdfInput): void {
  buildInvoicePdf(input).save(invoiceFileName(input.invoice))
}

/** Blob for uploading to Storage or attaching elsewhere. */
export function invoicePdfBlob(input: InvoicePdfInput): Blob {
  return buildInvoicePdf(input).output('blob')
}
