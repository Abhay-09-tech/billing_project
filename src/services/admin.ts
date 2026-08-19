import { supabase } from '@/lib/supabase'
import type { AuditLogRow, ProfileRow, RoleRow } from '@/types/database'

// ── Users & roles ───────────────────────────────────────────────────────────

export type ProfileWithRole = ProfileRow & {
  roles: Pick<RoleRow, 'id' | 'code' | 'name'> | null
}

export async function listUsers(): Promise<ProfileWithRole[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, roles(id, code, name)')
    .order('full_name')
  if (error) throw error
  return (data ?? []) as ProfileWithRole[]
}

export async function listRoles(): Promise<RoleRow[]> {
  const { data, error } = await supabase.from('roles').select('*').order('code')
  if (error) throw error
  return (data ?? []) as RoleRow[]
}

export async function setUserRole(profileId: string, roleId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ role_id: roleId }).eq('id', profileId)
  if (error) throw error
}

export async function setUserActive(profileId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ is_active: isActive }).eq('id', profileId)
  if (error) throw error
}

export async function updateUserDetails(
  profileId: string,
  patch: { full_name?: string; phone?: string | null },
): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', profileId)
  if (error) throw error
}

/**
 * Send a password-reset email.
 *
 * Creating an auth user requires the service-role key, which must never reach
 * the browser — so new staff accounts are created in the Supabase dashboard
 * (documented in docs/GETTING-STARTED.md step 7). Resetting a password is a
 * normal client-side operation and is safe here.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  })
  if (error) throw error
}

// ── Audit log ───────────────────────────────────────────────────────────────

export async function listAuditLogs(params: {
  entityType?: string
  action?: string
  page: number
  pageSize: number
}) {
  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(params.page * params.pageSize, (params.page + 1) * params.pageSize - 1)

  if (params.entityType) query = query.eq('entity_type', params.entityType)
  if (params.action) query = query.eq('action', params.action)

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as AuditLogRow[], total: count ?? 0 }
}

// ── Export / backup ─────────────────────────────────────────────────────────

export const EXPORTABLE_TABLES = [
  { table: 'customers', label: 'Customers' },
  { table: 'prescriptions', label: 'Prescriptions' },
  { table: 'orders', label: 'Orders' },
  { table: 'order_items', label: 'Order items' },
  { table: 'invoices', label: 'Invoices' },
  { table: 'invoice_items', label: 'Invoice items' },
  { table: 'payments', label: 'Payments' },
  { table: 'products', label: 'Products' },
  { table: 'inventory_transactions', label: 'Stock movements' },
  { table: 'lab_orders', label: 'Lab jobs' },
  { table: 'whatsapp_messages', label: 'WhatsApp messages' },
  { table: 'audit_logs', label: 'Audit log' },
] as const

export type ExportableTable = (typeof EXPORTABLE_TABLES)[number]['table']

/**
 * Fetch a whole table for export, paged so a large table cannot blow the
 * browser's memory or hit PostgREST's row cap silently.
 */
export async function fetchTableForExport(
  table: ExportableTable,
  onProgress?: (fetched: number) => void,
): Promise<Record<string, unknown>[]> {
  const CHUNK = 1000
  const rows: Record<string, unknown>[] = []

  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + CHUNK - 1)
    if (error) throw error
    const batch = (data ?? []) as Record<string, unknown>[]
    rows.push(...batch)
    onProgress?.(rows.length)
    if (batch.length < CHUNK) break
  }

  return rows
}
