import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function BillingPage() {
  return (
    <PhasePlaceholder
      title="Billing"
      phase="Phase 7"
      ready={[
          'GST-inclusive line maths, verified against test vectors',
          'Gapless FY invoice numbering (POV/26-27/00001)',
          'Issued invoices immutable at database level',
          'Counter-sale invoices without an order',
      ]}
      next={[
          'Invoice list with date and status filters',
          'Fast billing flow: search customer to printed bill',
          'Printable and PDF invoice',
          'WhatsApp the bill to the customer',
      ]}
    />
  )
}
