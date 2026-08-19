import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function ReportsPage() {
  return (
    <PhasePlaceholder
      title="Reports"
      phase="Phase 8"
      ready={[
          'rpc_sales_overview() aggregates in SQL, not the browser',
          'Shared date-range presets including custom range',
      ]}
      next={[
          'Daily and monthly sales',
          'Product, frame and lens performance',
          'Customer and payment-method reports',
          'Outstanding ageing',
          'CSV and Excel export',
      ]}
    />
  )
}
