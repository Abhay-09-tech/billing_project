import { supabase } from '@/lib/supabase'
import type { DashboardMetrics, SalesOverviewRow } from '@/types/database'

/**
 * Every dashboard number comes from this single RPC — no hardcoded values,
 * no client-side aggregation (brief §6 / §44).
 */
export async function getDashboardMetrics(day?: string): Promise<DashboardMetrics> {
  const { data, error } = await supabase.rpc('rpc_dashboard_metrics', {
    p_day: day ?? new Date().toISOString().slice(0, 10),
  })
  if (error) throw error
  return data as DashboardMetrics
}

export async function getSalesOverview(from: string, to: string): Promise<SalesOverviewRow[]> {
  const { data, error } = await supabase.rpc('rpc_sales_overview', { p_from: from, p_to: to })
  if (error) throw error
  return (data ?? []) as SalesOverviewRow[]
}

/**
 * Realtime is used ONLY as a cache-invalidation signal (ARCHITECTURE.md §2.4):
 * we never patch rows into UI state from a payload, so a dropped event is
 * harmless — the next refetch reconciles.
 */
export function subscribeToBusinessChanges(onChange: () => void): () => void {
  const channel = supabase
    .channel('pov-business')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payments' }, onChange)
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
