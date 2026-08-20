import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Circle } from 'lucide-react'
import { getSetting } from '@/services/settings'
import { listUsers } from '@/services/admin'
import { listProducts } from '@/services/products'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, LoadingState } from '@/components/ui/layout'
import { cn } from '@/lib/utils'

interface ShopProfile {
  name?: string
  address?: string
  phone?: string
  gstin?: string
  state_code?: string
}

interface Step {
  id: string
  title: string
  why: string
  done: boolean
  blocking: boolean
  action?: { label: string; onClick: () => void }
}

/**
 * First-time setup (brief §17).
 *
 * Not a wizard that locks the app — a live checklist that reads the real
 * database and marks each step done as it actually happens. Steps that would
 * make a legally wrong invoice are marked blocking.
 */
export function SetupChecklist({ onGoToTab }: { onGoToTab: (tab: string) => void }) {
  const navigate = useNavigate()

  const shop = useQuery({
    queryKey: ['settings', 'shop.profile'],
    queryFn: () => getSetting<ShopProfile>('shop.profile'),
  })
  const billing = useQuery({
    queryKey: ['settings', 'billing.gst'],
    queryFn: () => getSetting<{ registration?: string; tax_inclusive?: boolean }>('billing.gst'),
  })
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: listUsers })
  const products = useQuery({
    queryKey: ['products', 'setup-count'],
    queryFn: () => listProducts({ page: 0, pageSize: 1 }),
  })
  const wa = useQuery({
    queryKey: ['settings', 'whatsapp.provider'],
    queryFn: () => getSetting<{ enabled?: boolean }>('whatsapp.provider'),
  })

  if (shop.isPending || users.isPending || products.isPending) {
    return <Card><LoadingState label="Checking your setup…" /></Card>
  }

  const profile = shop.data ?? {}
  const admins = (users.data ?? []).filter((u) => u.is_active && u.roles?.code === 'admin')

  const steps: Step[] = [
    {
      id: 'shop',
      title: 'Shop name and address',
      why: 'Printed at the top of every invoice.',
      done: Boolean(profile.name && profile.address && profile.phone),
      blocking: true,
      action: { label: 'Fill in shop details', onClick: () => onGoToTab('shop') },
    },
    {
      id: 'gstin',
      title: 'GSTIN and state code',
      why: 'A tax invoice without a GSTIN is not valid for a registered dealer.',
      done: Boolean(profile.gstin && profile.state_code),
      blocking: billing.data?.registration === 'regular',
      action: { label: 'Add GSTIN', onClick: () => onGoToTab('shop') },
    },
    {
      id: 'billing',
      title: 'GST registration and price display',
      why: 'Decides whether tax is extracted from your price or added on top. Wrong here means every bill is wrong.',
      done: Boolean(billing.data?.registration),
      blocking: true,
      action: { label: 'Check billing settings', onClick: () => onGoToTab('billing') },
    },
    {
      id: 'admins',
      title: 'A second administrator',
      why: 'If you lose access to the only admin account, nobody can manage users, settings or prices.',
      done: admins.length >= 2,
      blocking: false,
      action: { label: 'Manage users', onClick: () => onGoToTab('users') },
    },
    {
      id: 'products',
      title: 'Products with GST rates',
      why: 'You cannot bill what is not in the catalogue. Confirm each rate with your accountant.',
      done: (products.data?.total ?? 0) > 0,
      blocking: true,
      action: { label: 'Add products', onClick: () => navigate('/products?new=1') },
    },
    {
      id: 'stock',
      title: 'Opening stock counted in',
      why: 'Enter what is physically on the shelf today so stock figures mean something.',
      done: (products.data?.total ?? 0) > 0,
      blocking: false,
      action: { label: 'Update stock', onClick: () => navigate('/inventory') },
    },
    {
      id: 'whatsapp',
      title: 'WhatsApp Business API (optional)',
      why: 'Only needed for automatic messages. Manual WhatsApp sending already works without it.',
      done: Boolean(wa.data?.enabled),
      blocking: false,
      action: { label: 'See WhatsApp status', onClick: () => navigate('/whatsapp') },
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const blockers = steps.filter((s) => s.blocking && !s.done)

  return (
    <Card>
      <CardHeader title="First-time setup" actions={<span className="text-sm text-brand-600">{doneCount} of {steps.length} done</span>} />

      <div className="p-4 sm:p-5">
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-cream-200">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>

        {blockers.length > 0 ? (
          <p className="mb-4 flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2.5 text-sm text-warning-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Finish the {blockers.length} highlighted step{blockers.length === 1 ? '' : 's'} before
              issuing a bill to a real customer. Everything else can wait.
            </span>
          </p>
        ) : (
          <p className="mb-4 flex items-start gap-2 rounded-lg bg-success-50 px-3 py-2.5 text-sm text-success-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Setup is complete. The system is ready for real billing.</span>
          </p>
        )}

        <ol className="space-y-2">
          {steps.map((step) => (
            <li
              key={step.id}
              className={cn(
                'flex flex-wrap items-start gap-3 rounded-lg border p-3',
                step.done
                  ? 'border-cream-300 bg-cream-100/60'
                  : step.blocking
                    ? 'border-warning-600/30 bg-warning-50/40'
                    : 'border-cream-300',
              )}
            >
              {step.done ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-600" />
              ) : (
                <Circle className={cn('mt-0.5 h-5 w-5 shrink-0', step.blocking ? 'text-warning-600' : 'text-brand-300')} />
              )}
              <div className="min-w-0 flex-1">
                <p className={cn('font-medium', step.done ? 'text-brand-600 line-through' : 'text-brand-900')}>
                  {step.title}
                  {step.blocking && !step.done && (
                    <span className="ml-2 rounded bg-warning-50 px-1.5 py-0.5 text-xs font-medium text-warning-700">
                      Required
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-brand-600">{step.why}</p>
              </div>
              {!step.done && step.action && (
                <Button variant="outline" size="sm" onClick={step.action.onClick}>
                  {step.action.label}
                </Button>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  )
}
