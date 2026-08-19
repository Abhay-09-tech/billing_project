import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function OrderDetailPage() {
  return (
    <PhasePlaceholder
      title="Order"
      phase="Phase 6"
      ready={[
          'getOrderDetail() returns order, items, history, prescription and lab jobs',
          'Status transitions validated server-side',
      ]}
      next={[
          'Job sheet view with the prescription used',
          'Status timeline',
          'Send to lab / receive from lab actions',
          'Create invoice from this order',
      ]}
    />
  )
}
