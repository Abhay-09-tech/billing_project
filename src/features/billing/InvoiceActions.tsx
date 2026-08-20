import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Eye, MessageCircle, Printer, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import type { InvoiceItemRow, PaymentRow } from '@/types/database'
import type { InvoiceWithCustomer } from '@/services/billing'
import { getSetting } from '@/services/settings'
import { buildInvoiceMessage } from '@/lib/whatsapp'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { WhatsAppShareDialog } from '@/features/whatsapp/WhatsAppShareDialog'
import { downloadInvoicePdf, invoiceFileName, invoicePdfBlob, type ShopProfile } from './invoice-pdf'

interface Props {
  invoice: InvoiceWithCustomer
  items: InvoiceItemRow[]
  payments: PaymentRow[]
  orderCode?: string | null
  customerAddress?: string | null
  /** 'bar' for the invoice page, 'stacked' for the confirmation screen. */
  layout?: 'bar' | 'stacked'
  onViewInvoice?: () => void
  onWhatsAppSent?: () => void
}

/**
 * The five actions the brief asks for on every invoice surface (§3, §10, §14):
 * Print · Download PDF · Send on WhatsApp · Share · View.
 *
 * Kept in one component so the invoice page, the confirmation screen and the
 * order screen all behave identically.
 */
export function InvoiceActions({
  invoice,
  items,
  payments,
  orderCode,
  customerAddress,
  layout = 'bar',
  onViewInvoice,
  onWhatsAppSent,
}: Props) {
  const { can } = useAuth()
  const [waOpen, setWaOpen] = useState(false)

  const shopQuery = useQuery({
    queryKey: ['settings', 'shop.profile'],
    queryFn: () => getSetting<ShopProfile>('shop.profile'),
  })
  const shop = shopQuery.data ?? {}
  const shopName = shop.name || 'Perfect Optical Vision'

  const pdfInput = {
    invoice,
    items,
    payments,
    shop,
    address: customerAddress ?? null,
    orderCode: orderCode ?? null,
  }

  const message = buildInvoiceMessage({
    shopName,
    customerName: invoice.customers?.full_name ?? 'Customer',
    invoiceNo: invoice.invoice_no ?? '',
    orderCode: orderCode ?? null,
    grandTotal: Number(invoice.grand_total),
    amountPaid: Number(invoice.amount_paid),
  })

  function handleDownload() {
    try {
      downloadInvoicePdf(pdfInput)
      toast.success('Invoice PDF downloaded')
    } catch (err) {
      toast.error(friendlyError(err, 'Could not create the PDF.'))
    }
  }

  /**
   * Native share sheet where the browser supports files (Android Chrome, iOS
   * Safari, Edge). This is the only path that can genuinely attach the PDF to
   * a WhatsApp chat, so we offer it first when available and fall back to a
   * download rather than pretending an attachment happened.
   */
  const canShareFiles =
    typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'

  async function handleShare() {
    try {
      const blob = invoicePdfBlob(pdfInput)
      const file = new File([blob], invoiceFileName(invoice), { type: 'application/pdf' })

      if (canShareFiles && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Invoice ${invoice.invoice_no}`,
          text: message,
        })
        return
      }
      // No file sharing on this device: give staff the PDF and say why.
      downloadInvoicePdf(pdfInput)
      toast.info('This browser cannot attach files directly. The PDF has been downloaded — attach it in WhatsApp.')
    } catch (err) {
      const e = err as { name?: string }
      if (e.name === 'AbortError') return // staff dismissed the share sheet
      toast.error(friendlyError(err, 'Could not share the invoice.'))
    }
  }

  const buttons = (
    <>
      <Button variant={layout === 'stacked' ? 'outline' : 'outline'} onClick={() => window.print()} className={layout === 'stacked' ? 'w-full justify-start' : undefined}>
        <Printer className="h-4 w-4" />
        Print Invoice
      </Button>

      <Button variant="outline" onClick={handleDownload} className={layout === 'stacked' ? 'w-full justify-start' : undefined}>
        <Download className="h-4 w-4" />
        Download PDF
      </Button>

      {can(PERMS.whatsappSend) && (
        <Button
          onClick={() => setWaOpen(true)}
          className={layout === 'stacked' ? 'w-full justify-start bg-brand-700 hover:bg-brand-800' : 'bg-brand-700 hover:bg-brand-800'}
        >
          <MessageCircle className="h-4 w-4" />
          Send on WhatsApp
        </Button>
      )}

      <Button variant="outline" onClick={handleShare} className={layout === 'stacked' ? 'w-full justify-start' : undefined}>
        <Share2 className="h-4 w-4" />
        Share Invoice
      </Button>

      {onViewInvoice && (
        <Button variant="outline" onClick={onViewInvoice} className={layout === 'stacked' ? 'w-full justify-start' : undefined}>
          <Eye className="h-4 w-4" />
          View Invoice
        </Button>
      )}
    </>
  )

  return (
    <>
      {layout === 'stacked' ? (
        <div className="space-y-2">{buttons}</div>
      ) : (
        <div className="flex flex-wrap gap-2">{buttons}</div>
      )}

      <WhatsAppShareDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        title="Send bill on WhatsApp"
        customerId={invoice.customer_id}
        customerName={invoice.customers?.full_name ?? 'Customer'}
        savedWhatsApp={invoice.customers?.whatsapp_number}
        mobile={invoice.customers?.mobile}
        message={message}
        relatedEntityType="invoice"
        relatedEntityId={invoice.id}
        hint="WhatsApp does not allow a website to attach a file to a chat automatically. Use “Share Invoice” to attach the PDF from your device, or send this message and follow with the PDF."
        onSent={onWhatsAppSent}
      />
    </>
  )
}
