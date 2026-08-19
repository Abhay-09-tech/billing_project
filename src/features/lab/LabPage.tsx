import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function LabPage() {
  return (
    <PhasePlaceholder
      title="Lab"
      phase="Phase 6"
      ready={[
          'lab_orders with six QC states and remake chains',
          'Lab vendor directory',
          'Expected-return-date tracking',
      ]}
      next={[
          'Jobs grouped by lab status',
          'Send to lab and mark received',
          'QC pass or fail with notes',
          'Overdue job highlighting',
      ]}
    />
  )
}
