import { supabase } from '@/lib/supabase'
import type {
  CustomerRow,
  WhatsAppAutomationRuleRow,
  WhatsAppMessageRow,
  WhatsAppMessageStatus,
  WhatsAppTemplateRow,
} from '@/types/database'

export type MessageWithCustomer = WhatsAppMessageRow & {
  customers: Pick<CustomerRow, 'id' | 'full_name' | 'mobile'> | null
  whatsapp_templates: Pick<WhatsAppTemplateRow, 'id' | 'code' | 'name'> | null
}

export async function listMessages(params: {
  status?: WhatsAppMessageStatus
  page: number
  pageSize: number
}) {
  let query = supabase
    .from('whatsapp_messages')
    .select('*, customers(id, full_name, mobile), whatsapp_templates(id, code, name)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(params.page * params.pageSize, (params.page + 1) * params.pageSize - 1)

  if (params.status) query = query.eq('status', params.status)

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as MessageWithCustomer[], total: count ?? 0 }
}

/** Counts for the WhatsApp dashboard tiles (brief §23). */
export async function getMessageStats(day: string) {
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('status, created_at, sent_at')
    .gte('created_at', `${day}T00:00:00`)
  if (error) throw error

  const rows = data ?? []
  return {
    sent: rows.filter((r) => ['sent', 'delivered', 'read'].includes(r.status)).length,
    delivered: rows.filter((r) => ['delivered', 'read'].includes(r.status)).length,
    failed: rows.filter((r) => r.status === 'failed').length,
    pending: rows.filter((r) => ['queued', 'sending'].includes(r.status)).length,
  }
}

export async function listTemplates(): Promise<WhatsAppTemplateRow[]> {
  const { data, error } = await supabase.from('whatsapp_templates').select('*').order('code')
  if (error) throw error
  return (data ?? []) as WhatsAppTemplateRow[]
}

export type RuleWithTemplate = WhatsAppAutomationRuleRow & {
  whatsapp_templates: Pick<WhatsAppTemplateRow, 'id' | 'code' | 'name' | 'category'> | null
}

export async function listAutomationRules(): Promise<RuleWithTemplate[]> {
  const { data, error } = await supabase
    .from('whatsapp_automation_rules')
    .select('*, whatsapp_templates(id, code, name, category)')
    .order('event_key')
  if (error) throw error
  return (data ?? []) as RuleWithTemplate[]
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_automation_rules')
    .update({ is_enabled: enabled })
    .eq('id', id)
  if (error) throw error
}

export async function updateTemplate(
  id: string,
  patch: Partial<Pick<WhatsAppTemplateRow, 'body_text' | 'provider_template_name' | 'is_active'>>,
): Promise<void> {
  const { error } = await supabase.from('whatsapp_templates').update(patch).eq('id', id)
  if (error) throw error
}

/**
 * Record that staff opened WhatsApp with a prepared message.
 *
 * Status is 'opened', never 'sent'/'delivered' — a database CHECK enforces
 * that a manual_link message can never claim delivery (brief §13).
 */
export async function logManualWhatsApp(params: {
  customerId: string | null
  toMsisdn: string
  body: string
  entityType?: string | null
  entityId?: string | null
}): Promise<WhatsAppMessageRow> {
  const { data, error } = await supabase.rpc('rpc_log_manual_whatsapp', {
    p_customer_id: params.customerId,
    p_to_msisdn: params.toMsisdn,
    p_body: params.body,
    p_entity_type: params.entityType ?? null,
    p_entity_id: params.entityId ?? null,
  })
  if (error) throw error
  return data as WhatsAppMessageRow
}

/** Whether the provider has actually been connected yet. */
export async function isProviderConfigured(): Promise<boolean> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'whatsapp.provider')
    .maybeSingle()
  if (error) throw error
  const value = data?.value as { enabled?: boolean } | null
  return Boolean(value?.enabled)
}
