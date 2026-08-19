import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function InventoryPage() {
  return (
    <PhasePlaceholder
      title="Inventory"
      phase="Phase 5"
      ready={[
          'Append-only stock ledger; every movement has a reason and timestamp',
          'Cached quantities maintained by trigger, direct writes revoked',
          'Ledger-versus-cache reconciliation view',
          'Low-stock view driving the dashboard alert',
      ]}
      next={[
          'Stock levels with low-stock highlighting',
          'Stock inward, adjustment and damage forms',
          'Per-product movement history',
          'Reconciliation report',
      ]}
    />
  )
}
