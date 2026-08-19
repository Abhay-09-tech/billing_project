/**
 * Auth service — the only auth code that touches supabase-js.
 */
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { ProfileRow, RoleRow } from '@/types/database'

export interface CurrentUser {
  userId: string
  email: string
  profile: ProfileRow
  role: RoleRow
  permissions: Set<string>
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export function getSession(): Promise<Session | null> {
  return supabase.auth.getSession().then(({ data }) => data.session)
}

export function onAuthStateChange(cb: (session: Session | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

/**
 * Load the profile + role + permission set for the signed-in user.
 * Returns null when the auth user has no active profile (deactivated staff) —
 * the UI treats that as "signed out".
 */
export async function loadCurrentUser(session: Session): Promise<CurrentUser | null> {
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle()
  if (pErr) throw pErr
  if (!profile || !profile.is_active) return null

  const [{ data: role, error: rErr }, { data: perms, error: permErr }] = await Promise.all([
    supabase.from('roles').select('*').eq('id', profile.role_id).single(),
    supabase.from('role_permissions').select('permission_code').eq('role_id', profile.role_id),
  ])
  if (rErr) throw rErr
  if (permErr) throw permErr

  return {
    userId: session.user.id,
    email: session.user.email ?? '',
    profile,
    role: role!,
    permissions: new Set((perms ?? []).map((p) => p.permission_code)),
  }
}
