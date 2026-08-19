import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getSetting, updateSetting } from '@/services/settings'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, ErrorState, LoadingState, PageHeader } from '@/components/ui/layout'
import { FormField, Input, Select, Textarea } from '@/components/ui/fields'
import { cn } from '@/lib/utils'
import { UsersPanel } from './UsersPanel'
import { AuditPanel } from './AuditPanel'
import { BackupPanel } from './BackupPanel'
import { SetupChecklist } from './SetupChecklist'

type Tab = 'setup' | 'shop' | 'billing' | 'numbering' | 'users' | 'audit' | 'backup'

interface ShopProfile {
  name?: string
  address?: string
  phone?: string
  whatsapp?: string
  email?: string
  gstin?: string
  state_code?: string
}

interface BillingSettings {
  registration?: string
  tax_inclusive?: boolean
  default_gst_rate?: number
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('setup')

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Shop details, tax configuration, users, audit trail and backups"
      />

      <div className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="inline-flex gap-1 rounded-lg bg-gray-100 p-1">
          {(
            [
              ['setup', 'Setup'],
              ['shop', 'Shop'],
              ['billing', 'Billing & GST'],
              ['numbering', 'Numbering'],
              ['users', 'Users'],
              ['audit', 'Audit log'],
              ['backup', 'Export & backup'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'rounded-md px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                tab === value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'setup' && <SetupChecklist onGoToTab={(t) => setTab(t as Tab)} />}
      {tab === 'shop' && <ShopSettings />}
      {tab === 'billing' && <BillingSettingsPanel />}
      {tab === 'numbering' && <NumberingSettings />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'audit' && <AuditPanel />}
      {tab === 'backup' && <BackupPanel />}
    </>
  )
}

function ShopSettings() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['settings', 'shop.profile'],
    queryFn: () => getSetting<ShopProfile>('shop.profile'),
  })
  const form = useForm<ShopProfile>()

  useEffect(() => {
    if (query.data) form.reset(query.data)
  }, [query.data, form])

  const mutation = useMutation({
    mutationFn: (values: ShopProfile) => updateSetting('shop.profile', { ...values }),
    onSuccess: () => {
      toast.success('Shop details saved')
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not save the settings.')),
  })

  if (query.isPending) return <Card><LoadingState /></Card>
  if (query.isError)
    return (
      <Card>
        <ErrorState message={friendlyError(query.error)} onRetry={() => void query.refetch()} />
      </Card>
    )

  return (
    <Card>
      <CardHeader title="Shop profile" />
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        className="space-y-4 p-4 sm:p-5"
      >
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          These details print on every invoice. Fill them in before you issue your first real bill.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Shop name" required htmlFor="s-name">
            <Input id="s-name" {...form.register('name', { required: true })} />
          </FormField>
          <FormField
            label="GSTIN"
            hint="15 characters, e.g. 29ABCDE1234F1Z5"
            htmlFor="s-gstin"
          >
            <Input id="s-gstin" maxLength={15} className="uppercase" {...form.register('gstin')} />
          </FormField>
        </div>

        <FormField label="Address" htmlFor="s-address">
          <Textarea id="s-address" rows={3} {...form.register('address')} />
        </FormField>

        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Phone" htmlFor="s-phone">
            <Input id="s-phone" type="tel" inputMode="tel" {...form.register('phone')} />
          </FormField>
          <FormField label="WhatsApp number" htmlFor="s-wa">
            <Input id="s-wa" type="tel" inputMode="tel" {...form.register('whatsapp')} />
          </FormField>
          <FormField label="Email" htmlFor="s-email">
            <Input id="s-email" type="email" inputMode="email" {...form.register('email')} />
          </FormField>
        </div>

        <FormField
          label="State code"
          hint="Two digits from your GSTIN — decides CGST+SGST versus IGST"
          htmlFor="s-state"
        >
          <Input id="s-state" maxLength={2} inputMode="numeric" className="max-w-24" {...form.register('state_code')} />
        </FormField>

        <div className="flex justify-end">
          <Button type="submit" loading={mutation.isPending}>
            Save shop details
          </Button>
        </div>
      </form>
    </Card>
  )
}

function BillingSettingsPanel() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['settings', 'billing.gst'],
    queryFn: () => getSetting<BillingSettings>('billing.gst'),
  })
  const form = useForm<BillingSettings>()

  useEffect(() => {
    if (query.data) form.reset(query.data)
  }, [query.data, form])

  const mutation = useMutation({
    mutationFn: (values: BillingSettings) =>
      updateSetting('billing.gst', {
        registration: values.registration,
        tax_inclusive: String(values.tax_inclusive) === 'true' || values.tax_inclusive === true,
        default_gst_rate: Number(values.default_gst_rate),
      }),
    onSuccess: () => {
      toast.success('Billing settings saved')
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not save the settings.')),
  })

  if (query.isPending) return <Card><LoadingState /></Card>

  return (
    <Card>
      <CardHeader title="Billing & GST" />
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="GST registration" htmlFor="b-reg">
            <Select id="b-reg" {...form.register('registration')}>
              <option value="regular">Regular</option>
              <option value="composition">Composition</option>
              <option value="unregistered">Not registered</option>
            </Select>
          </FormField>
          <FormField
            label="Price display"
            hint="How you quote prices to customers"
            htmlFor="b-incl"
          >
            <Select id="b-incl" {...form.register('tax_inclusive')}>
              <option value="true">Prices include GST</option>
              <option value="false">GST added on top</option>
            </Select>
          </FormField>
          <FormField label="Default GST rate for new products" htmlFor="b-rate">
            <Select id="b-rate" {...form.register('default_gst_rate')}>
              {[0, 5, 12, 18, 28].map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
          Changing the price display affects <strong>new</strong> bills only. Every invoice stores
          which setting was in force when it was issued, so past bills never change.
        </p>

        <div className="flex justify-end">
          <Button type="submit" loading={mutation.isPending}>
            Save billing settings
          </Button>
        </div>
      </form>
    </Card>
  )
}

function NumberingSettings() {
  const keys = ['numbering.invoice', 'numbering.customer', 'numbering.order', 'numbering.payment']
  const queries = useQuery({
    queryKey: ['settings', 'numbering'],
    queryFn: async () => {
      const entries = await Promise.all(
        keys.map(async (k) => [k, await getSetting<Record<string, unknown>>(k)] as const),
      )
      return Object.fromEntries(entries)
    },
  })

  if (queries.isPending) return <Card><LoadingState /></Card>

  const preview = (cfg: Record<string, unknown> | null) => {
    if (!cfg) return '—'
    const pattern = String(cfg.pattern ?? '')
    const pad = Number(cfg.pad ?? 5)
    return pattern
      .replace('{prefix}', String(cfg.prefix ?? ''))
      .replace('{fy}', '26-27')
      .replace('{period}', '26-27')
      .replace('{seq}', '1'.padStart(pad, '0'))
  }

  return (
    <Card>
      <CardHeader title="Document numbering" />
      <div className="space-y-4 p-4 sm:p-5">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Numbering is deliberately read-only here. Changing an invoice series mid-year breaks the
          consecutive sequence GST requires (CGST Rule 46(b)) — it needs a considered change, not a
          quick edit. Ask your developer to change it in a migration.
        </p>

        <dl className="divide-y divide-gray-100">
          {keys.map((k) => {
            const cfg = queries.data?.[k] as Record<string, unknown> | null
            return (
              <div key={k} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <dt className="text-sm font-medium text-gray-900 capitalize">
                    {k.replace('numbering.', '')}
                  </dt>
                  <dd className="text-xs text-gray-500">
                    {cfg?.reset === 'fy'
                      ? 'Resets every financial year (April)'
                      : 'Continuous, never resets'}
                  </dd>
                </div>
                <code className="rounded bg-gray-100 px-2 py-1 text-sm text-gray-800">
                  {preview(cfg)}
                </code>
              </div>
            )
          })}
        </dl>
      </div>
    </Card>
  )
}
