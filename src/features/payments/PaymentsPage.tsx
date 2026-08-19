import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function PaymentsPage() {
  return (
    <PhasePlaceholder
      title="Payments"
      phase="Phase 7"
      ready={[
          'Append-only signed payments ledger; nothing is ever deleted',
          'Overpayment blocked unless explicitly permitted',
          'Refunds and reversals as new entries',
          'Outstanding view derived from the ledger',
      ]}
      next={[
          'Payment list with method and date filters',
          'Record payment and refund forms',
          'Outstanding screen with ageing',
          'Send WhatsApp payment reminder',
      ]}
    />
  )
}
