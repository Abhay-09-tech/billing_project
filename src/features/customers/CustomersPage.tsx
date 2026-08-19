import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Users } from 'lucide-react'
import { listCustomers } from '@/services/customers'
import { formatMobile, formatRelativeDay } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { PERMS } from '@/lib/permissions'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { SearchInput } from '@/components/ui/search-input'
import { Pagination } from '@/components/ui/pagination'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { NewCustomerDialog } from './NewCustomerDialog'

const PAGE_SIZE = 25

export default function CustomersPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const newOpen = searchParams.get('new') === '1'

  const setNewOpen = (open: boolean) => {
    const next = new URLSearchParams(searchParams)
    if (open) next.set('new', '1')
    else next.delete('new')
    setSearchParams(next, { replace: true })
  }

  const query = useQuery({
    queryKey: ['customers', 'list', search, page],
    queryFn: () => listCustomers({ search, page, pageSize: PAGE_SIZE }),
  })

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={query.data ? `${query.data.total} total` : undefined}
        actions={
          can(PERMS.customersCreate) && (
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" />
              New customer
            </Button>
          )
        }
      />

      <div className="mb-4">
        <SearchInput
          value={search}
          onValueChange={(v) => {
            setSearch(v)
            setPage(0)
          }}
          placeholder="Search by name, mobile or customer ID…"
          className="max-w-md"
        />
      </div>

      <Card>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.rows.length === 0 ? (
          <EmptyState
            title={search ? 'No customers match that search' : 'No customers yet'}
            hint={
              search
                ? 'Try part of a name or the last few digits of a mobile number.'
                : 'Add your first customer to get started.'
            }
            icon={<Users className="h-10 w-10" />}
            action={
              !search &&
              can(PERMS.customersCreate) && (
                <Button onClick={() => setNewOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New customer
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Customer</TH>
                  <TH className="hidden sm:table-cell">Customer ID</TH>
                  <TH>Mobile</TH>
                  <TH className="hidden md:table-cell">City</TH>
                  <TH className="hidden lg:table-cell">Last visit</TH>
                  <TH className="hidden sm:table-cell">Status</TH>
                </TR>
              </THead>
              <TBody>
                {query.data.rows.map((c) => (
                  <TR key={c.id} onClick={() => navigate(`/customers/${c.id}`)}>
                    <TD>
                      <p className="font-medium text-gray-900">{c.full_name}</p>
                      <p className="text-xs text-gray-500 sm:hidden">{c.customer_code}</p>
                    </TD>
                    <TD className="hidden text-gray-500 sm:table-cell">{c.customer_code}</TD>
                    <TD className="tabular-nums">{formatMobile(c.mobile)}</TD>
                    <TD className="hidden text-gray-500 md:table-cell">{c.city ?? '—'}</TD>
                    <TD className="hidden text-gray-500 lg:table-cell">
                      {c.last_visit_at ? formatRelativeDay(c.last_visit_at) : 'Never'}
                    </TD>
                    <TD className="hidden sm:table-cell">
                      {c.status === 'active' ? (
                        <Badge tone="green">Active</Badge>
                      ) : (
                        <Badge tone="gray">{c.status}</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.total} onPageChange={setPage} />
          </>
        )}
      </Card>

      <NewCustomerDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(customer) => navigate(`/customers/${customer.id}`)}
      />
    </>
  )
}
