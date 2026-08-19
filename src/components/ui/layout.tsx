import type { ReactNode } from 'react'
import { AlertCircle, Inbox, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white', className)}>{children}</div>
  )
}

export function CardHeader({ title, actions, className }: { title: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5', className)}>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {actions}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-gray-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Every list/detail screen renders exactly one of: loading / error / empty / content. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-500">
      <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden />
      <p className="text-sm">{label}</p>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <AlertCircle className="h-8 w-8 text-red-500" aria-hidden />
      <p className="max-w-sm text-sm text-gray-600">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string
  hint?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="text-gray-300">{icon ?? <Inbox className="h-10 w-10" aria-hidden />}</div>
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="max-w-sm text-sm text-gray-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
