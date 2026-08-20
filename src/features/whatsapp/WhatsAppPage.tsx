import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  getMessageStats,
  isProviderConfigured,
  listAutomationRules,
  listMessages,
  listTemplates,
  setRuleEnabled,
} from '@/services/whatsapp'
import type { WhatsAppMessageStatus } from '@/types/database'
import { formatDateTime, formatMobile } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Card, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { Pagination } from '@/components/ui/pagination'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge, WaStatusBadge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

type Tab = 'messages' | 'automation' | 'templates'

const EVENT_LABELS: Record<string, string> = {
  'order.created': 'Order placed',
  'order.status.ready': 'Order ready for pickup',
  'order.delivered': 'Order delivered',
  'invoice.overdue': 'Payment reminder',
  'invoice.paid': 'Payment received',
}

export default function WhatsAppPage() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('messages')
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState<WhatsAppMessageStatus | ''>(
    (searchParams.get('status') as WhatsAppMessageStatus) ?? '',
  )

  const today = new Date().toISOString().slice(0, 10)

  const configured = useQuery({ queryKey: ['whatsapp', 'configured'], queryFn: isProviderConfigured })
  const stats = useQuery({ queryKey: ['whatsapp', 'stats', today], queryFn: () => getMessageStats(today) })
  const messages = useQuery({
    queryKey: ['whatsapp', 'messages', status, page],
    queryFn: () => listMessages({ status: status || undefined, page, pageSize: PAGE_SIZE }),
    enabled: tab === 'messages',
  })
  const rules = useQuery({
    queryKey: ['whatsapp', 'rules'],
    queryFn: listAutomationRules,
    enabled: tab === 'automation',
  })
  const templates = useQuery({
    queryKey: ['whatsapp', 'templates'],
    queryFn: listTemplates,
    enabled: tab === 'templates',
  })

  const toggleRule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setRuleEnabled(id, enabled),
    onSuccess: () => {
      toast.success('Automation updated')
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', 'rules'] })
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not update the automation.')),
  })

  return (
    <>
      <PageHeader title="WhatsApp" subtitle="Automatic customer messages and their delivery status" />

      {configured.data === false && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warning-600/30 bg-warning-50 p-3.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-600" />
          <div className="text-sm text-warning-700">
            <p className="font-medium">WhatsApp is not connected yet.</p>
            <p className="mt-1">
              Messages are queued but nothing is sent. To go live you need a dedicated SIM (one
              never used on WhatsApp), a verified Meta Business account, and the five templates
              below approved by Meta. Setup steps are in <code>docs/GETTING-STARTED.md</code>.
            </p>
            <p className="mt-1">
              Meanwhile, the WhatsApp buttons on bills, orders and the outstanding list open
              WhatsApp directly with the message pre-typed — those work today.
            </p>
          </div>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sent today" value={stats.data?.sent ?? 0} />
        <Stat label="Delivered" value={stats.data?.delivered ?? 0} tone="green" />
        <Stat label="Pending" value={stats.data?.pending ?? 0} />
        <Stat label="Failed" value={stats.data?.failed ?? 0} tone={stats.data?.failed ? 'red' : undefined} />
      </div>

      <div className="mb-4 flex gap-1 rounded-lg bg-cream-200 p-1 sm:inline-flex">
        {(
          [
            ['messages', 'Messages'],
            ['automation', 'Automation'],
            ['templates', 'Templates'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => {
              setTab(value)
              setPage(0)
            }}
            className={cn(
              'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors sm:flex-none',
              tab === value ? 'bg-white text-brand-900 shadow-sm' : 'text-brand-700 hover:text-brand-900',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'messages' && (
        <Card>
          <CardHeader
            title="Message history"
            actions={
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as WhatsAppMessageStatus | '')
                  setPage(0)
                }}
                className="h-9 rounded-lg border border-cream-300 bg-white px-2 text-sm focus:border-brand-600 focus:outline-none"
                aria-label="Filter by status"
              >
                <option value="">All</option>
                <option value="queued">Queued</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="read">Read</option>
                <option value="failed">Failed</option>
              </select>
            }
          />
          {messages.isPending ? (
            <LoadingState />
          ) : messages.isError ? (
            <ErrorState message={friendlyError(messages.error)} onRetry={() => void messages.refetch()} />
          ) : messages.data.rows.length === 0 ? (
            <EmptyState
              title="No messages yet"
              hint="Messages appear here once automation is switched on and orders start moving."
              icon={<MessageCircle className="h-10 w-10" />}
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Customer</TH>
                    <TH>Message</TH>
                    <TH className="hidden lg:table-cell">Type</TH>
                    <TH>Status</TH>
                    <TH className="hidden sm:table-cell">When</TH>
                  </TR>
                </THead>
                <TBody>
                  {messages.data.rows.map((m) => (
                    <TR key={m.id}>
                      <TD>
                        <p className="text-brand-900">{m.customers?.full_name ?? '—'}</p>
                        <p className="text-xs tabular-nums text-brand-600">
                          {formatMobile(m.to_msisdn)}
                        </p>
                      </TD>
                      <TD className="max-w-xs">
                        <p className="truncate text-brand-800">{m.rendered_body ?? '—'}</p>
                        {m.status === 'failed' && m.error_message && (
                          <p className="mt-0.5 truncate text-xs text-error-600">{m.error_message}</p>
                        )}
                      </TD>
                      <TD className="hidden text-brand-700 lg:table-cell">
                        {m.whatsapp_templates?.name ?? '—'}
                      </TD>
                      <TD>
                        <WaStatusBadge status={m.status} />
                      </TD>
                      <TD className="hidden whitespace-nowrap text-brand-600 sm:table-cell">
                        {formatDateTime(m.sent_at ?? m.created_at)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={messages.data.total}
                onPageChange={setPage}
              />
            </>
          )}
        </Card>
      )}

      {tab === 'automation' && (
        <Card>
          <CardHeader title="When to send automatically" />
          {rules.isPending ? (
            <LoadingState />
          ) : rules.isError ? (
            <ErrorState message={friendlyError(rules.error)} onRetry={() => void rules.refetch()} />
          ) : (
            <ul className="divide-y divide-cream-200">
              {rules.data.map((rule) => (
                <li key={rule.id} className="flex items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
                  <div>
                    <p className="font-medium text-brand-900">
                      {EVENT_LABELS[rule.event_key] ?? rule.event_key}
                    </p>
                    <p className="text-sm text-brand-600">
                      Sends “{rule.whatsapp_templates?.name}”
                      {rule.delay_minutes > 0 &&
                        ` after ${rule.delay_minutes >= 1440 ? `${Math.round(rule.delay_minutes / 1440)} day(s)` : `${rule.delay_minutes} min`}`}
                    </p>
                    {rule.whatsapp_templates?.category === 'marketing' && (
                      <Badge tone="amber" className="mt-1">
                        Needs customer opt-in
                      </Badge>
                    )}
                  </div>
                  <label className="flex shrink-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.is_enabled}
                      disabled={!can(PERMS.whatsappManage) || toggleRule.isPending}
                      onChange={(e) =>
                        toggleRule.mutate({ id: rule.id, enabled: e.target.checked })
                      }
                      className="h-5 w-5 rounded border-cream-300 text-brand-700 focus:ring-brand-600"
                    />
                    <span className="text-sm text-brand-700">
                      {rule.is_enabled ? 'On' : 'Off'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'templates' && (
        <Card>
          <CardHeader title="Message templates" />
          {templates.isPending ? (
            <LoadingState />
          ) : templates.isError ? (
            <ErrorState message={friendlyError(templates.error)} onRetry={() => void templates.refetch()} />
          ) : (
            <ul className="divide-y divide-cream-200">
              {templates.data.map((t) => (
                <li key={t.id} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-brand-900">{t.name}</p>
                    <Badge tone={t.category === 'marketing' ? 'amber' : 'blue'}>{t.category}</Badge>
                    <Badge tone={t.approval_status === 'approved' ? 'green' : 'gray'}>
                      {t.approval_status}
                    </Badge>
                  </div>
                  <p className="mt-1.5 rounded-lg bg-cream-100 px-3 py-2 text-sm text-brand-800">
                    {t.body_text}
                  </p>
                  <p className="mt-1 text-xs text-brand-600">
                    Registered with Meta as <code>{t.provider_template_name}</code>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'green' | 'red'
}) {
  return (
    <div className="rounded-xl border border-cream-300 bg-white p-3.5">
      <p className="text-xs text-brand-600">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-xl font-semibold tabular-nums',
          tone === 'green' ? 'text-success-700' : tone === 'red' ? 'text-error-700' : 'text-brand-900',
        )}
      >
        {value}
      </p>
    </div>
  )
}
