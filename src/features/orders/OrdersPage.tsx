import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function OrdersPage() {
  return (
    <PhasePlaceholder
      title="Orders"
      phase="Phase 6"
      ready={[
          'Order creation RPC with atomic stock deduction',
          'Configurable 11-state workflow with transition validation',
          'Full status history trail',
          'Lab order linkage',
      ]}
      next={[
          'Order list with status and date filters',
          'New-order builder: customer, prescription, frame, lens',
          'Status advance buttons per allowed transition',
          'Expected-delivery tracking',
      ]}
    />
  )
}
