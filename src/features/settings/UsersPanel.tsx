import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, KeyRound, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import {
  listRoles,
  listUsers,
  sendPasswordReset,
  setUserActive,
  setUserRole,
  type ProfileWithRole,
} from '@/services/admin'
import { friendlyError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { useAuth } from '@/app/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, ErrorState, LoadingState } from '@/components/ui/layout'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/fields'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'

export function UsersPanel() {
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()
  const [helpOpen, setHelpOpen] = useState(false)
  const [deactivating, setDeactivating] = useState<ProfileWithRole | null>(null)

  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: listUsers })
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: listRoles })

  const roleMutation = useMutation({
    mutationFn: ({ id, roleId }: { id: string; roleId: string }) => setUserRole(id, roleId),
    onSuccess: () => {
      toast.success('Role updated')
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not change the role.')),
  })

  const activeMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setUserActive(id, active),
    onSuccess: (_d, vars) => {
      toast.success(vars.active ? 'Access restored' : 'Access removed')
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      setDeactivating(null)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not change access.')),
  })

  const resetMutation = useMutation({
    mutationFn: (email: string) => sendPasswordReset(email),
    onSuccess: () => toast.success('Password reset email sent'),
    onError: (err) => toast.error(friendlyError(err, 'Could not send the reset email.')),
  })

  if (users.isPending) return <Card><LoadingState /></Card>
  if (users.isError)
    return (
      <Card>
        <ErrorState message={friendlyError(users.error)} onRetry={() => void users.refetch()} />
      </Card>
    )

  const activeAdmins = users.data.filter((u) => u.is_active && u.roles?.code === 'admin').length

  return (
    <>
      <Card>
        <CardHeader
          title="Staff accounts"
          actions={
            <Button size="sm" variant="outline" onClick={() => setHelpOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Add a user
            </Button>
          }
        />

        {activeAdmins < 2 && (
          <p className="mx-4 mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:mx-5">
            Only one active administrator. Create a second admin account — if you lose access to
            this one, nobody can manage users, settings or prices.
          </p>
        )}

        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH className="hidden sm:table-cell">Added</TH>
              <TH>Access</TH>
              <TH className="w-32" />
            </TR>
          </THead>
          <TBody>
            {users.data.map((u) => {
              const isSelf = u.id === currentUser?.userId
              const isLastAdmin = u.roles?.code === 'admin' && u.is_active && activeAdmins <= 1
              return (
                <TR key={u.id}>
                  <TD>
                    <p className="font-medium text-gray-900">
                      {u.full_name}
                      {isSelf && <span className="ml-1.5 text-xs text-gray-500">(you)</span>}
                    </p>
                    {u.phone && <p className="text-xs text-gray-500">{u.phone}</p>}
                  </TD>
                  <TD>
                    <Select
                      value={u.role_id}
                      disabled={isSelf || isLastAdmin || roleMutation.isPending}
                      onChange={(e) => roleMutation.mutate({ id: u.id, roleId: e.target.value })}
                      className="h-9 max-w-36"
                      aria-label={`Role for ${u.full_name}`}
                    >
                      {roles.data?.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </TD>
                  <TD className="hidden text-gray-500 sm:table-cell">{formatDate(u.created_at)}</TD>
                  <TD>
                    {u.is_active ? (
                      <Badge tone="green">Active</Badge>
                    ) : (
                      <Badge tone="gray">Removed</Badge>
                    )}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {u.is_active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50"
                          disabled={isSelf || isLastAdmin}
                          onClick={() => setDeactivating(u)}
                        >
                          Remove
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => activeMutation.mutate({ id: u.id, active: true })}
                        >
                          Restore
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>

        <div className="border-t border-gray-100 px-4 py-3 sm:px-5">
          <p className="text-sm text-gray-600">
            <KeyRound className="mr-1 inline h-4 w-4 text-gray-400" />
            Forgotten password? Staff can use “Forgot password” on the sign-in screen, or you can
            trigger a reset email:
          </p>
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const email = new FormData(e.currentTarget).get('email') as string
              if (email) resetMutation.mutate(email)
            }}
          >
            <input
              name="email"
              type="email"
              required
              placeholder="staff@example.com"
              className="h-10 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:border-brand-600 focus:outline-none sm:max-w-xs"
            />
            <Button type="submit" variant="outline" size="sm" loading={resetMutation.isPending}>
              Send reset email
            </Button>
          </form>
        </div>
      </Card>

      {/* Creating an auth user needs the service-role key, which must never be
          in the browser. So we tell the admin exactly where to do it instead of
          shipping a dangerous shortcut. */}
      <Dialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Add a staff user"
        description="Two short steps — the first is in Supabase, for security"
      >
        <div className="space-y-4 text-sm text-gray-700">
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-blue-900">
            Creating a login requires an administrative key that deliberately never exists in this
            web app. Putting it here would let anyone who opens the browser console create accounts.
          </p>

          <ol className="space-y-3">
            <li>
              <p className="font-medium text-gray-900">1. Create the login</p>
              <p className="mt-0.5 text-gray-600">
                Supabase dashboard → <strong>Authentication → Users → Add user</strong>. Enter the
                staff email and a password, tick <em>Auto Confirm User</em>, then copy the UID it
                shows.
              </p>
            </li>
            <li>
              <p className="font-medium text-gray-900">2. Give it a role</p>
              <p className="mt-0.5 text-gray-600">
                Supabase → <strong>SQL Editor</strong>, paste this, replacing the UID and name:
              </p>
              <pre className="mt-1.5 overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
{`insert into public.profiles (id, full_name, role_id, branch_id)
select 'PASTE-UID-HERE', 'Staff Name', r.id, b.id
  from public.roles r, public.branches b
 where r.code = 'staff' and b.is_default;`}
              </pre>
              <p className="mt-1.5 text-gray-600">
                Use <code>'admin'</code> instead of <code>'staff'</code> for a full-access account.
              </p>
            </li>
          </ol>

          <p className="text-gray-600">
            The user then appears in the table here, where you can change their role or remove
            access at any time.
          </p>

          <div className="flex justify-end gap-2">
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="inline-flex"
            >
              <Button variant="outline">
                <ExternalLink className="h-4 w-4" />
                Open Supabase
              </Button>
            </a>
            <Button onClick={() => setHelpOpen(false)}>Done</Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deactivating)}
        onOpenChange={(v) => !v && setDeactivating(null)}
        title={`Remove access for ${deactivating?.full_name}?`}
        description="They will be signed out and cannot sign in again. Their past work — orders, bills, payments — stays intact and attributed to them. You can restore access later."
        confirmLabel="Remove access"
        tone="danger"
        loading={activeMutation.isPending}
        onConfirm={() =>
          deactivating && activeMutation.mutate({ id: deactivating.id, active: false })
        }
      />
    </>
  )
}
