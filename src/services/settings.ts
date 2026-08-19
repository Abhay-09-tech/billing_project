import { supabase } from '@/lib/supabase'
import type { Json, SettingRow } from '@/types/database'

/**
 * Settings are key/value with jsonb payloads. Rows flagged `is_secret` are
 * filtered out by RLS, so this can never return an API token.
 */
export async function getSetting<T = Json>(key: string): Promise<T | null> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle()
  if (error) throw error
  return (data?.value ?? null) as T | null
}

export async function listSettings(): Promise<SettingRow[]> {
  const { data, error } = await supabase.from('settings').select('*').order('key')
  if (error) throw error
  return (data ?? []) as SettingRow[]
}

export async function updateSetting(key: string, value: Json): Promise<void> {
  const { error } = await supabase.from('settings').update({ value }).eq('key', key)
  if (error) throw error
}
