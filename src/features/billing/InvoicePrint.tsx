import { useQuery } from '@tanstack/react-query'
import type { InvoiceItemRow, PaymentRow } from '@/types/database'
import type { InvoiceWithCustomer } from '@/services/billing'
import { getSetting } from '@/services/settings'
import { formatMoney } from '@/lib/money'
import { formatDate, formatMobile } from '@/lib/format'
import type { ShopProfile } from './invoice-pdf'

/**
 * Print layout for a GST tax invoice (brief §7, §8).
 *
 * Only this element is visible when printing — index.css hides everything else,
 * so no sidebar, navigation or buttons reach the paper. The browser's own
 * Print → "Save as PDF" therefore produces the same document staff see, while
 * "Download PDF" uses the jsPDF generator for a file to attach or archive.
 */
export function InvoicePrint({
  invoice,
  items,
  payments = [],
  orderCode,
  customerAddress,
}: {
  invoice: InvoiceWithCustomer
  items: InvoiceItemRow[]
  payments?: PaymentRow[]
  orderCode?: string | null
  customerAddress?: string | null
}) {
  const shop = useQuery({
    queryKey: ['settings', 'shop.profile'],
    queryFn: () => getSetting<ShopProfile>('shop.profile'),
  })

  const profile = shop.data ?? {}
  const shopName = profile.name || 'Perfect Optical Vision'
  const taxTotal =
    Number(invoice.cgst_total) + Number(invoice.sgst_total) + Number(invoice.igst_total)
  const balance = Number(invoice.grand_total) - Number(invoice.amount_paid)
  const received = payments.filter((p) => p.direction > 0)
  const methods = [...new Set(received.map((p) => p.method.replace('_', ' ')))].join(', ')

  return (
    <div id="invoice-print" className="hidden print:block">
      <div className="mx-auto max-w-3xl bg-white p-6 text-[10.5pt] leading-snug text-black">
        {/* ── Shop header ────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div className="flex items-start gap-3">
            {profile.logo_data_url && (
              <img src={profile.logo_data_url} alt="" className="h-16 w-16 object-contain" />
            )}
            <div>
              <h1 className="text-xl font-bold">{shopName}</h1>
              {profile.address && (
                <p className="mt-0.5 whitespace-pre-line text-[9.5pt]">{profile.address}</p>
              )}
              <p className="mt-0.5 text-[9.5pt]">
                {profile.phone && <>Phone: {profile.phone}</>}
                {profile.whatsapp && <> · WhatsApp: {profile.whatsapp}</>}
              </p>
              {profile.email && <p className="text-[9.5pt]">{profile.email}</p>}
              {profile.gstin && <p className="mt-0.5 font-semibold">GSTIN: {profile.gstin}</p>}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-lg font-bold tracking-wide">TAX INVOICE</p>
            <table className="mt-1.5 ml-auto text-[9.5pt]">
              <tbody>
                <tr>
                  <td className="pr-2 text-right font-medium">Invoice No:</td>
                  <td className="text-left font-semibold">{invoice.invoice_no}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-right font-medium">Date:</td>
                  <td className="text-left">
                    {invoice.invoice_date ? formatDate(invoice.invoice_date) : '—'}
                  </td>
                </tr>
                {orderCode && (
                  <tr>
                    <td className="pr-2 text-right font-medium">Order No:</td>
                    <td className="text-left">{orderCode}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Customer ───────────────────────────────────────────────────── */}
        <div className="mt-3 border-b border-gray-400 pb-3">
          <p className="text-[9pt] font-bold tracking-wide">BILL TO</p>
          <div className="mt-1 flex items-start justify-between gap-6">
            <div>
              <p className="text-[12pt] font-semibold">{invoice.customers?.full_name}</p>
              {customerAddress && (
                <p className="mt-0.5 whitespace-pre-line text-[9.5pt]">{customerAddress}</p>
              )}
            </div>
            <table className="shrink-0 text-[9.5pt]">
              <tbody>
                <tr>
                  <td className="pr-2 font-medium">Mobile:</td>
                  <td>{formatMobile(invoice.customers?.mobile)}</td>
                </tr>
                {invoice.customers?.whatsapp_number &&
                  invoice.customers.whatsapp_number !== invoice.customers.mobile && (
                    <tr>
                      <td className="pr-2 font-medium">WhatsApp:</td>
                      <td>{formatMobile(invoice.customers.whatsapp_number)}</td>
                    </tr>
                  )}
                <tr>
                  <td className="pr-2 font-medium">Customer ID:</td>
                  <td>{invoice.customers?.customer_code}</td>
                </tr>
                {invoice.place_of_supply && (
                  <tr>
                    <td className="pr-2 font-medium">Place of supply:</td>
                    <td>{invoice.place_of_supply}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Lines ──────────────────────────────────────────────────────── */}
        <table className="mt-3 w-full border-collapse text-[9.5pt]">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1.5 pr-1 text-left font-semibold">#</th>
              <th className="py-1.5 pr-2 text-left font-semibold">Description</th>
              <th className="py-1.5 pr-2 text-left font-semibold">SKU / HSN</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Rate</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Disc.</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Taxable</th>
              <th className="py-1.5 pr-2 text-right font-semibold">GST</th>
              <th className="py-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id} className="border-b border-gray-300">
                <td className="py-1.5 pr-1 align-top">{index + 1}</td>
                <td className="py-1.5 pr-2 align-top">{item.description}</td>
                <td className="py-1.5 pr-2 align-top text-[8.5pt]">{item.hsn_code ?? '—'}</td>
                <td className="py-1.5 pr-2 text-right align-top">{Number(item.qty)}</td>
                <td className="py-1.5 pr-2 text-right align-top">{formatMoney(item.unit_price)}</td>
                <td className="py-1.5 pr-2 text-right align-top">
                  {Number(item.discount_amt) > 0 ? formatMoney(item.discount_amt) : '—'}
                </td>
                <td className="py-1.5 pr-2 text-right align-top">{formatMoney(item.taxable_amt)}</td>
                <td className="py-1.5 pr-2 text-right align-top">
                  {formatMoney(
                    Number(item.cgst_amt) + Number(item.sgst_amt) + Number(item.igst_amt),
                  )}
                  <span className="ml-1 text-[8pt]">({item.gst_rate_pct}%)</span>
                </td>
                <td className="py-1.5 text-right align-top font-medium">
                  {formatMoney(item.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Totals ─────────────────────────────────────────────────────── */}
        <div className="mt-3 flex justify-between gap-6">
          <div className="text-[9pt]">
            <p className="font-semibold">Payment</p>
            <table className="mt-1">
              <tbody>
                {methods && (
                  <tr>
                    <td className="pr-3 font-medium">Method:</td>
                    <td className="capitalize">{methods}</td>
                  </tr>
                )}
                <tr>
                  <td className="pr-3 font-medium">Status:</td>
                  <td className="font-semibold">
                    {balance <= 0.005 ? 'PAID IN FULL' : Number(invoice.amount_paid) > 0 ? 'PARTIALLY PAID' : 'UNPAID'}
                  </td>
                </tr>
              </tbody>
            </table>
            {received.length > 0 && (
              <table className="mt-2 text-[8.5pt]">
                <tbody>
                  {received.map((p) => (
                    <tr key={p.id}>
                      <td className="pr-3">{p.payment_code}</td>
                      <td className="pr-3">{formatDate(p.paid_at)}</td>
                      <td className="pr-3 capitalize">{p.method.replace('_', ' ')}</td>
                      <td className="text-right">{formatMoney(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <table className="w-72 shrink-0 text-[9.5pt]">
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
                <td className="py-1.5">Grand Total</td>
                <td className="py-1.5 text-right">{formatMoney(invoice.grand_total)}</td>
              </tr>
              <tr>
                <td className="py-0.5">Paid</td>
                <td className="py-0.5 text-right">{formatMoney(invoice.amount_paid)}</td>
              </tr>
              <tr className="font-bold">
                <td className="py-0.5">Balance Due</td>
                <td className="py-0.5 text-right">{formatMoney(balance)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-[8.5pt]">
          Total tax: {formatMoney(taxTotal)}
          {invoice.is_tax_inclusive && ' · Prices are inclusive of GST'}
        </p>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-end justify-between gap-6 border-t border-gray-400 pt-3 text-[8.5pt]">
          <div className="max-w-md">
            <p className="font-semibold">Thank you for choosing {shopName}.</p>
            <ul className="mt-1 space-y-0.5 text-gray-700">
              <li>· Spectacles made to prescription are not returnable.</li>
              <li>· Please check the fit and vision before leaving the counter.</li>
              <li>· Frame warranty is as per manufacturer terms; bring this invoice for any claim.</li>
              <li>· Goods once sold are not exchangeable after 7 days.</li>
            </ul>
            <p className="mt-1.5 text-gray-500">This is a computer-generated invoice.</p>
          </div>
          <div className="shrink-0 text-center">
            <div className="mt-10 border-t border-black px-6 pt-1">
              For {shopName}
              <br />
              Authorised Signatory
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
