import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function InvoiceDetailPage() {
  return (
    <PhasePlaceholder
      title="Invoice"
      phase="Phase 7"
      ready={[
          'getInvoiceDetail() returns invoice, lines and payments',
          'Cancel-invoice RPC with reason and stock return',
      ]}
      next={[
          'Full GST invoice layout ready to print',
          'Record payment inline',
          'Cancel or credit-note actions',
          'Download PDF',
      ]}
    />
  )
}
