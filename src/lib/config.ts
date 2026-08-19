/**
 * Where the Supabase connection details come from.
 *
 * Two sources, in priority order:
 *
 *   1. Build-time environment variables (VITE_SUPABASE_URL / ..._ANON_KEY).
 *      This is the normal production path — set them on the host and every
 *      visitor gets a configured app.
 *
 *   2. Values entered in the Connect screen and kept in this browser's
 *      localStorage. This exists so the app can be deployed once and then
 *      pointed at a database from any device — including a phone, where you
 *      cannot edit a .env file or rebuild.
 *
 * Both hold the **anon** key only. That key is designed to be public: every
 * table is protected by row-level security, so on its own it can read nothing.
 * The service-role key must never be entered here or anywhere in the browser.
 */

const STORAGE_KEY = 'pov.supabase.config'

export interface SupabaseConfig {
  url: string
  anonKey: string
  /** Where these values came from — shown in the UI so it is never a mystery. */
  source: 'env' | 'browser'
}

function readEnv(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (url && anonKey && !url.includes('your-project-ref')) {
    return { url, anonKey, source: 'env' }
  }
  return null
}

function readStored(): SupabaseConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { url?: string; anonKey?: string }
    if (parsed.url && parsed.anonKey) {
      return { url: parsed.url, anonKey: parsed.anonKey, source: 'browser' }
    }
  } catch {
    // Corrupt entry — treat as unconfigured rather than crashing the app.
  }
  return null
}

export function getSupabaseConfig(): SupabaseConfig | null {
  return readEnv() ?? readStored()
}

export function saveSupabaseConfig(url: string, anonKey: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: url.trim(), anonKey: anonKey.trim() }))
}

export function clearSupabaseConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/** True when the app has somewhere to talk to. */
export function isConfigured(): boolean {
  return getSupabaseConfig() !== null
}

export interface ConfigValidation {
  valid: boolean
  error?: string
}

export function validateConfig(url: string, anonKey: string): ConfigValidation {
  const trimmedUrl = url.trim()
  const trimmedKey = anonKey.trim()

  if (!trimmedUrl) return { valid: false, error: 'Enter your Project URL.' }
  if (!trimmedKey) return { valid: false, error: 'Enter your anon public key.' }

  let parsed: URL
  try {
    parsed = new URL(trimmedUrl)
  } catch {
    return { valid: false, error: 'That does not look like a web address. It should start with https://' }
  }
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'The Project URL must start with https://' }
  }

  // The service-role key is a JWT whose payload names the role. Catching it
  // here prevents the single most damaging configuration mistake possible.
  if (looksLikeServiceRoleKey(trimmedKey)) {
    return {
      valid: false,
      error:
        'That is the service_role key, which bypasses all security and must never be used in a browser. Copy the "anon public" key instead.',
    }
  }

  if (trimmedKey.length < 40) {
    return { valid: false, error: 'That key looks too short. Copy the whole "anon public" key.' }
  }

  return { valid: true }
}

function looksLikeServiceRoleKey(key: string): boolean {
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}
