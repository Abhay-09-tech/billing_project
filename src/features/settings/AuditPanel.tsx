import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { listAuditLogs } from '@/services/admin'
import { formatDateTime } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Card, CardHeader, EmptyState, ErrorState, LoadingState } from '@/components/ui/layout'
import { Pagination } from '@/components/ui/pagination'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/fields'

const PAGE_SIZE = 30

const ENTITY_LABELS: Record<string, string> = {
  customers: 'Customer',
  prescriptions: 'Prescription',
  orders: 'Order',
  invoices: 'Invoice',
  payments: 'Payment',
  products: 'Product',
  inventory_transactions: 'Stock movement',
  lab_orders: 'Lab job',
  profiles: 'User',
  settings: 'Setting',
  roles: 'Role',
  role_permissions: 'Permission',
  credit_notes: 'Credit note',
  whatsapp_templates: 'WhatsApp template',
  whatsapp_automation_rules: 'WhatsApp automation',
}

const ACTION_TONES: Record<string, 'green' | 'blue' | 'red' | 'amber' | 'gray'> = {
  insert: 'green',
  update: 'blue',
  delete: 'red',
  'invoice.issued': 'green',
  'invoice.cancelled': 'red',
}

export function AuditPanel() {
  const [page, setPage] = useState(0)
  const [entityType, setEntityType] = useState('')

  const query = useQuery({
    queryKey: ['admin', 'audit', entityType, page],
    queryFn: () => listAuditLogs({ entityType: entityType || undefined, page, pageSize: PAGE_SIZE }),
  })

  return (
    <Card>
      <CardHeader
        title="Audit log"
        actions={
          <Select
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value)
              setPage(0)
            }}
            className="h-9 max-w-44"
            aria-label="Filter by record type"
          >
            <option value="">Everything</option>
            {Object.entries(ENTITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        }
      />

      <p className="border-b border-gray-100 px-4 py-2.5 text-xs text-gray-500 sm:px-5">
        Every change to a customer, prescription, order, bill, payment, product, stock level or
        setting is recorded here permanently. Entries cannot be edited or deleted by anyone,
        including administrators.
      </p>

      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
      ) : query.data.rows.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          hint="Activity appears here as staff use the system."
          icon={<ScrollText className="h-10 w-10" />}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Action</TH>
                <TH>Record</TH>
                <TH className="hidden lg:table-cell">Details</TH>
              </TR>
            </THead>
            <TBody>
              {query.data.rows.map((log) => (
                <TR key={log.id}>
                  <TD className="whitespace-nowrap text-gray-500">
                    {formatDateTime(log.created_at)}
                  </TD>
                  <TD>
                    <Badge tone={ACTION_TONES[log.action] ?? 'gray'}>
                      {log.action.replace('.', ' ')}
                    </Badge>
                  </TD>
                  <TD>
                    <p className="text-gray-900">
                      {ENTITY_LABELS[log.entity_type] ?? log.entity_type}
                    </p>
                    <p className="font-mono text-xs text-gray-400">
                      {log.entity_id.slice(0, 8)}
                    </p>
                  </TD>
                  <TD className="hidden max-w-md lg:table-cell">
                    <AuditDetail log={log} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={query.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </Card>
  )
}

/** Show what actually changed rather than dumping raw JSON at the user. */
function AuditDetail({ log }: { log: { before: unknown; after: unknown; metadata: unknown } }) {
  if (log.metadata && typeof log.metadata === 'object') {
    const entries = Object.entries(log.metadata as Record<string, unknown>)
    return (
      <span className="text-xs text-gray-600">
        {entries.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
      </span>
    )
  }

  const before = log.before as Record<string, unknown> | null
  const after = log.after as Record<string, unknown> | null

  if (before && after) {
    const NOISE = new Set(['updated_at', 'created_at'])
    const changed = Object.keys(after).filter(
      (k) => !NOISE.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    )
    if (changed.length === 0) return <span className="text-xs text-gray-400">—</span>
    return (
      <span className="text-xs text-gray-600">
        Changed: {changed.slice(0, 6).join(', ')}
        {changed.length > 6 ? ` +${changed.length - 6} more` : ''}
      </span>
    )
  }

  if (after) {
    const name = (after.full_name ?? after.name ?? after.invoice_no ?? after.order_code) as
      | string
      | undefined
    return <span className="text-xs text-gray-600">{name ? `Created ${name}` : 'Created'}</span>
  }

  return <span className="text-xs text-gray-400">—</span>
}
