import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function WhatsAppPage() {
  return (
    <PhasePlaceholder
      title="WhatsApp"
      phase="Phase 9-10"
      ready={[
          'Outbox table with idempotency keys preventing duplicate sends',
          'Five message templates seeded, editable from the database',
          'Automation rules per event, currently disabled',
          'Enqueue function wired into order and payment events',
      ]}
      next={[
          'Message dashboard: sent, delivered, failed, pending',
          'Template editor',
          'Automation rule toggles',
          'Manual send and retry',
          'Meta Cloud API dispatcher and delivery webhook',
      ]}
    />
  )
}
