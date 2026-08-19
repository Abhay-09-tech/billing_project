/**
 * The Supabase client. PRIVATE to src/services/** — an ESLint boundary rule
 * blocks any import from features/components/app code. UI code calls service
 * functions; service functions call this. (docs/ARCHITECTURE.md §2.3)
 *
 * The client is created lazily. Importing this module must never throw: if the
 * app is not connected to a database yet, we want the Connect screen, not a
 * blank white page.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from './config'
import type { Database } from '@/types/database'

let client: SupabaseClient<Database> | null = null
let clientKey = ''

function createSupabaseClient(): SupabaseClient<Database> {
  const config = getSupabaseConfig()
  if (!config) {
    throw new Error(
      'This app is not connected to a database yet. Open Settings → Connect, or set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }

  // Rebuild if the configuration changed (e.g. the user just connected).
  const key = `${config.url}::${config.anonKey}`
  if (client && clientKey === key) return client

  clientKey = key
  client = createClient<Database>(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return client
}

/**
 * Proxy so existing `supabase.from(...)` call sites keep working unchanged
 * while the real client is only built on first use.
 */
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const instance = createSupabaseClient()
    const value = Reflect.get(instance as object, prop, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

/** Drop the cached client after the configuration changes. */
export function resetSupabaseClient(): void {
  client = null
  clientKey = ''
}
