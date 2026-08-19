import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { listLabOrders, updateLabOrder } from '@/services/orders'
import type { LabOrderStatus } from '@/types/database'
import { formatDate, formatMobile } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { Pagination } from '@/components/ui/pagination'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { LabStatusBadge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Textarea } from '@/components/ui/fields'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

const FILTERS: Array<{ value: LabOrderStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All jobs' },
  { value: 'sent', label: 'Sent' },
  { value: 'in_process', label: 'In process' },
  { value: 'received', label: 'Received' },
  { value: 'qc_pending', label: 'QC pending' },
  { value: 'qc_passed', label: 'QC passed' },
  { value: 'qc_failed', label: 'QC failed' },
]

/** Which statuses a job can move to next. Mirrors the lab workflow in §16. */
const NEXT: Record<LabOrderStatus, LabOrderStatus[]> = {
  sent: ['in_process', 'received'],
  in_process: ['received'],
  received: ['qc_pending'],
  qc_pending: ['qc_passed', 'qc_failed'],
  qc_passed: [],
  qc_failed: ['in_process'],
}

const STATUS_LABELS: Record<LabOrderStatus, string> = {
  sent: 'Sent to lab',
  in_process: 'In process',
  received: 'Received',
  qc_pending: 'QC pending',
  qc_passed: 'QC passed',
  qc_failed: 'QC failed',
}

export default function LabPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const [filter, setFilter] = useState<LabOrderStatus | 'all'>('all')
  const [page, setPage] = useState(0)
  const [qcJob, setQcJob] = useState<{ id: string; status: LabOrderStatus } | null>(null)

  const query = useQuery({
    queryKey: ['lab', 'list', filter, page],
    queryFn: () =>
      listLabOrders({
        status: filter === 'all' ? undefined : filter,
        page,
        pageSize: PAGE_SIZE,
      }),
  })

  const mutation = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: LabOrderStatus; notes?: string }) => {
      const patch: Record<string, unknown> = { status }
      if (status === 'received') patch.received_at = new Date().toISOString()
      // The database CHECK requires qc_at exactly when the status is a QC verdict.
      if (status === 'qc_passed' || status === 'qc_failed') {
        patch.qc_at = new Date().toISOString()
        patch.qc_notes = notes ?? null
      }
      return updateLabOrder(id, patch)
    },
    onSuccess: () => {
      toast.success('Lab job updated')
      void queryClient.invalidateQueries({ queryKey: ['lab'] })
      void queryClient.invalidateQueries({ queryKey: ['order'] })
      setQcJob(null)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not update the lab job.')),
  })

  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <PageHeader title="Lab" subtitle="Jobs sent out for lens fitting and their quality checks" />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => {
              setFilter(f.value)
              setPage(0)
            }}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              filter === f.value
                ? 'border-brand-300 bg-brand-50 text-brand-800'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.rows.length === 0 ? (
          <EmptyState
            title={filter === 'all' ? 'No lab jobs yet' : 'No jobs with this status'}
            hint="Send an order to the lab from its order page."
            icon={<FlaskConical className="h-10 w-10" />}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Customer</TH>
                  <TH className="hidden lg:table-cell">Lab</TH>
                  <TH>Status</TH>
                  <TH className="hidden sm:table-cell">Due back</TH>
                  <TH className="w-40" />
                </TR>
              </THead>
              <TBody>
                {query.data.rows.map((job) => {
                  const overdue =
                    job.expected_return_date &&
                    job.expected_return_date < today &&
                    !['qc_passed', 'received'].includes(job.status)
                  const next = NEXT[job.status] ?? []
                  return (
                    <TR key={job.id}>
                      <TD>
                        <button
                          onClick={() => job.orders && navigate(`/orders/${job.orders.id}`)}
                          className="font-medium text-brand-700 hover:text-brand-800"
                        >
                          {job.orders?.order_code ?? '—'}
                        </button>
                        {job.lens_details && (
                          <p className="max-w-xs truncate text-xs text-gray-500">{job.lens_details}</p>
                        )}
                      </TD>
                      <TD>
                        <p className="text-gray-900">{job.orders?.customers?.full_name ?? '—'}</p>
                        <p className="text-xs tabular-nums text-gray-500">
                          {formatMobile(job.orders?.customers?.mobile)}
                        </p>
                      </TD>
                      <TD className="hidden text-gray-600 lg:table-cell">
                        {job.lab_vendors?.name ?? '—'}
                      </TD>
                      <TD>
                        <LabStatusBadge status={job.status} />
                      </TD>
                      <TD
                        className={cn(
                          'hidden sm:table-cell',
                          overdue ? 'font-medium text-red-600' : 'text-gray-500',
                        )}
                      >
                        {job.expected_return_date ? formatDate(job.expected_return_date) : '—'}
                      </TD>
                      <TD>
                        {can(PERMS.labManage) && next.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {next.map((status) => (
                              <Button
                                key={status}
                                size="sm"
                                variant={status === 'qc_failed' ? 'outline' : 'primary'}
                                onClick={() => {
                                  if (status === 'qc_passed' || status === 'qc_failed') {
                                    setQcJob({ id: job.id, status })
                                  } else {
                                    mutation.mutate({ id: job.id, status })
                                  }
                                }}
                                disabled={mutation.isPending}
                              >
                                {STATUS_LABELS[status]}
                              </Button>
                            ))}
                          </div>
                        )}
                      </TD>
                    </TR>
                  )
                })}
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

      <QcDialog
        job={qcJob}
        onClose={() => setQcJob(null)}
        pending={mutation.isPending}
        onConfirm={(notes) =>
          qcJob && mutation.mutate({ id: qcJob.id, status: qcJob.status, notes })
        }
      />
    </>
  )
}

function QcDialog({
  job,
  onClose,
  pending,
  onConfirm,
}: {
  job: { id: string; status: LabOrderStatus } | null
  onClose: () => void
  pending: boolean
  onConfirm: (notes?: string) => void
}) {
  const [notes, setNotes] = useState('')
  const failed = job?.status === 'qc_failed'

  return (
    <Dialog
      open={Boolean(job)}
      onOpenChange={(v) => {
        if (!v) {
          setNotes('')
          onClose()
        }
      }}
      title={failed ? 'Record a QC failure' : 'Mark quality check passed'}
      description={
        failed
          ? 'The job goes back to the lab. Say what was wrong so the remake is right.'
          : 'The spectacles are ready for the customer.'
      }
    >
      <div className="space-y-4">
        <FormField
          label="QC notes"
          required={failed}
          hint={failed ? 'What failed the check?' : 'Optional'}
          htmlFor="qc-notes"
        >
          <Textarea
            id="qc-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={failed ? 'e.g. Axis off by 5°, left lens' : ''}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={failed ? 'danger' : 'primary'}
            loading={pending}
            disabled={failed && notes.trim().length < 3}
            onClick={() => onConfirm(notes.trim() || undefined)}
          >
            {failed ? 'Record failure' : 'Mark passed'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
