import { useQuery } from '@tanstack/react-query'
import type { InvoiceItemRow } from '@/types/database'
import type { InvoiceWithCustomer } from '@/services/billing'
import { getSetting } from '@/services/settings'
import { formatMoney } from '@/lib/money'
import { formatDate, formatMobile } from '@/lib/format'

interface ShopProfile {
  name?: string
  address?: string
  phone?: string
  email?: string
  gstin?: string
  state_code?: string
}

/**
 * Print layout for a GST tax invoice.
 *
 * Only this element is visible when printing (see the print rules in
 * index.css): the browser's own Print → Save as PDF is the PDF export, which
 * avoids shipping a PDF library and always matches what staff see on screen.
 */
export function InvoicePrint({
  invoice,
  items,
}: {
  invoice: InvoiceWithCustomer
  items: InvoiceItemRow[]
}) {
  const shop = useQuery({
    queryKey: ['settings', 'shop.profile'],
    queryFn: () => getSetting<ShopProfile>('shop.profile'),
  })

  const profile = shop.data ?? {}
  const taxTotal = Number(invoice.cgst_total) + Number(invoice.sgst_total) + Number(invoice.igst_total)

  return (
    <div id="invoice-print" className="hidden print:block">
      <div className="mx-auto max-w-3xl bg-white p-8 text-[11pt] text-black">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <h1 className="text-xl font-bold">{profile.name || 'Perfect Optical Vision'}</h1>
            {profile.address && <p className="mt-0.5 whitespace-pre-line">{profile.address}</p>}
            <p className="mt-0.5">
              {profile.phone && <>Phone: {profile.phone}</>}
              {profile.email && <> · {profile.email}</>}
            </p>
            {profile.gstin && <p className="mt-0.5 font-medium">GSTIN: {profile.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">TAX INVOICE</p>
            <p className="mt-1">
              <span className="font-medium">No: </span>
              {invoice.invoice_no}
            </p>
            <p>
              <span className="font-medium">Date: </span>
              {invoice.invoice_date ? formatDate(invoice.invoice_date) : '—'}
            </p>
          </div>
        </div>

        {/* ── Customer ───────────────────────────────────────────────── */}
        <div className="mt-3 border-b border-gray-400 pb-3">
          <p className="font-medium">Bill to</p>
          <p className="mt-0.5 text-[12pt] font-semibold">{invoice.customers?.full_name}</p>
          <p>{formatMobile(invoice.customers?.mobile)}</p>
          <p className="text-[10pt] text-gray-700">{invoice.customers?.customer_code}</p>
          {invoice.place_of_supply && <p className="mt-1">Place of supply: {invoice.place_of_supply}</p>}
        </div>

        {/* ── Lines ──────────────────────────────────────────────────── */}
        <table className="mt-3 w-full border-collapse text-[10pt]">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1.5 text-left font-semibold">#</th>
              <th className="py-1.5 text-left font-semibold">Description</th>
              <th className="py-1.5 text-left font-semibold">HSN</th>
              <th className="py-1.5 text-right font-semibold">Qty</th>
              <th className="py-1.5 text-right font-semibold">Rate</th>
              <th className="py-1.5 text-right font-semibold">Taxable</th>
              <th className="py-1.5 text-right font-semibold">GST</th>
              <th className="py-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id} className="border-b border-gray-300">
                <td className="py-1.5">{index + 1}</td>
                <td className="py-1.5">{item.description}</td>
                <td className="py-1.5">{item.hsn_code ?? '—'}</td>
                <td className="py-1.5 text-right">{Number(item.qty)}</td>
                <td className="py-1.5 text-right">{formatMoney(item.unit_price)}</td>
                <td className="py-1.5 text-right">{formatMoney(item.taxable_amt)}</td>
                <td className="py-1.5 text-right">
                  {formatMoney(Number(item.cgst_amt) + Number(item.sgst_amt) + Number(item.igst_amt))}
                  <span className="ml-1 text-[8pt]">({item.gst_rate_pct}%)</span>
                </td>
                <td className="py-1.5 text-right font-medium">{formatMoney(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Totals ─────────────────────────────────────────────────── */}
        <div className="mt-3 flex justify-end">
          <table className="w-72 text-[10pt]">
            <tbody>
              <tr>
                <td className="py-0.5">Taxable value</td>
                <td className="py-0.5 text-right">{formatMoney(invoice.taxable_total)}</td>
              </tr>
              {Number(invoice.discount_total) > 0 && (
                <tr>
                  <td className="py-0.5">Discount</td>
                  <td className="py-0.5 text-right">− {formatMoney(invoice.discount_total)}</td>
                </tr>
              )}
              {invoice.is_intra_state ? (
                <>
                  <tr>
                    <td className="py-0.5">CGST</td>
                    <td className="py-0.5 text-right">{formatMoney(invoice.cgst_total)}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5">SGST</td>
                    <td className="py-0.5 text-right">{formatMoney(invoice.sgst_total)}</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td className="py-0.5">IGST</td>
                  <td className="py-0.5 text-right">{formatMoney(invoice.igst_total)}</td>
                </tr>
              )}
              {Number(invoice.round_off) !== 0 && (
                <tr>
                  <td className="py-0.5">Round off</td>
                  <td className="py-0.5 text-right">{formatMoney(invoice.round_off)}</td>
                </tr>
              )}
              <tr className="border-y border-black text-[12pt] font-bold">
                <td className="py-1.5">Grand total</td>
                <td className="py-1.5 text-right">{formatMoney(invoice.grand_total)}</td>
              </tr>
              <tr>
                <td className="py-0.5">Paid</td>
                <td className="py-0.5 text-right">{formatMoney(invoice.amount_paid)}</td>
              </tr>
              <tr className="font-semibold">
                <td className="py-0.5">Balance due</td>
                <td className="py-0.5 text-right">
                  {formatMoney(Number(invoice.grand_total) - Number(invoice.amount_paid))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-[9pt]">
          Total tax: {formatMoney(taxTotal)}. Prices are inclusive of GST.
        </p>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="mt-8 flex items-end justify-between border-t border-gray-400 pt-3 text-[9pt]">
          <div>
            <p>Thank you for choosing {profile.name || 'Perfect Optical Vision'}.</p>
            <p className="mt-1 text-gray-600">
              Spectacles once made to prescription are not returnable. Please check the fit before
              leaving the counter.
            </p>
          </div>
          <div className="text-center">
            <div className="mt-8 border-t border-black px-8 pt-1">Authorised signatory</div>
          </div>
        </div>
      </div>
    </div>
  )
}
