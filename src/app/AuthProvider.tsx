/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  getSession,
  loadCurrentUser,
  onAuthStateChange,
  signOut as serviceSignOut,
  type CurrentUser,
} from '@/services/auth'
import type { Permission } from '@/lib/permissions'

interface AuthState {
  status: 'loading' | 'signed_out' | 'signed_in'
  user: CurrentUser | null
  can: (perm: Permission) => boolean
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading')
  const [user, setUser] = useState<CurrentUser | null>(null)

  const hydrate = useCallback(async () => {
    const session = await getSession()
    if (!session) {
      setUser(null)
      setStatus('signed_out')
      return
    }
    try {
      const current = await loadCurrentUser(session)
      if (!current) {
        // Auth user without an active profile — treat as signed out.
        await serviceSignOut().catch(() => {})
        setUser(null)
        setStatus('signed_out')
        return
      }
      setUser(current)
      setStatus('signed_in')
    } catch (err) {
      console.error('[auth] failed to load profile', err)
      setUser(null)
      setStatus('signed_out')
    }
  }, [])

  useEffect(() => {
    void hydrate()
    // Re-hydrate on token refresh/sign-in/sign-out from any tab.
    return onAuthStateChange(() => void hydrate())
  }, [hydrate])

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      can: (perm) => user?.permissions.has(perm) ?? false,
      signOut: async () => {
        await serviceSignOut()
        setUser(null)
        setStatus('signed_out')
      },
      refresh: hydrate,
    }),
    [status, user, hydrate],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
