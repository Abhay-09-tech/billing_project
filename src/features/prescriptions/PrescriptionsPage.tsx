import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { listRecentPrescriptions } from '@/services/prescriptions'
import { formatDate, formatMobile, formatRxPower } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { Pagination } from '@/components/ui/pagination'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const PAGE_SIZE = 25

export default function PrescriptionsPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)

  const query = useQuery({
    queryKey: ['prescriptions', 'recent', page],
    queryFn: () => listRecentPrescriptions(PAGE_SIZE, page),
  })

  return (
    <>
      <PageHeader
        title="Prescriptions"
        subtitle="Every prescription ever recorded. Add new ones from the customer's profile."
      />
      <Card>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.rows.length === 0 ? (
          <EmptyState
            title="No prescriptions recorded yet"
            hint="Open a customer and use “Add prescription”."
            icon={<Eye className="h-10 w-10" />}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Customer</TH>
                  <TH className="hidden sm:table-cell">Mobile</TH>
                  <TH>Type</TH>
                  <TH className="hidden md:table-cell">OD</TH>
                  <TH className="hidden md:table-cell">OS</TH>
                </TR>
              </THead>
              <TBody>
                {query.data.rows.map((rx) => (
                  <TR key={rx.id} onClick={() => navigate(`/customers/${rx.customers.id}`)}>
                    <TD className="whitespace-nowrap">{formatDate(rx.rx_date)}</TD>
                    <TD>
                      <p className="font-medium text-brand-900">{rx.customers.full_name}</p>
                      <p className="text-xs text-brand-600">{rx.customers.customer_code}</p>
                    </TD>
                    <TD className="hidden tabular-nums text-brand-600 sm:table-cell">
                      {formatMobile(rx.customers.mobile)}
                    </TD>
                    <TD>
                      {rx.voided_at ? (
                        <Badge tone="red">Voided</Badge>
                      ) : (
                        <Badge tone="blue">{rx.rx_type.replace('_', ' ')}</Badge>
                      )}
                    </TD>
                    <TD className="hidden tabular-nums text-brand-700 md:table-cell">
                      {formatRxPower(rx.od_sph, { plano: true })} / {formatRxPower(rx.od_cyl)}
                      {rx.od_axis != null ? ` × ${rx.od_axis}°` : ''}
                    </TD>
                    <TD className="hidden tabular-nums text-brand-700 md:table-cell">
                      {formatRxPower(rx.os_sph, { plano: true })} / {formatRxPower(rx.os_cyl)}
                      {rx.os_axis != null ? ` × ${rx.os_axis}°` : ''}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </>
  )
}
