import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function SettingsPage() {
  return (
    <PhasePlaceholder
      title="Settings"
      phase="Phase 8"
      ready={[
          'Settings table with secret rows hidden from all clients',
          'Numbering formats configurable without a deployment',
          'Roles and permissions are data, not code',
          'Order statuses configurable',
      ]}
      next={[
          'Shop profile, GSTIN and logo',
          'GST and invoice numbering settings',
          'User and role management',
          'Notification thresholds',
          'Data export and backup',
      ]}
    />
  )
}
