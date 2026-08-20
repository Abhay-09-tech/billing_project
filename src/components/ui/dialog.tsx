import * as RadixDialog from '@radix-ui/react-dialog'
import * as RadixAlert from '@radix-ui/react-alert-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  /** md fits forms; lg for item pickers/wide content. */
  size?: 'md' | 'lg'
}

/**
 * Modal dialog. On mobile it renders as a bottom sheet (full-width, slides
 * from the bottom) — thumbs reach it; on ≥sm it is a centred modal.
 */
export function Dialog({ open, onOpenChange, title, description, children, size = 'md' }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <RadixDialog.Content
          className={cn(
            'fixed z-50 bg-white shadow-xl focus:outline-none',
            // mobile: bottom sheet
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl',
            // desktop: centred modal
            'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85dvh] sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
            size === 'md' ? 'sm:max-w-lg' : 'sm:max-w-3xl',
            'flex flex-col',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-cream-200 px-4 py-3 sm:px-5">
            <div>
              <RadixDialog.Title className="text-base font-semibold text-brand-900">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-0.5 text-sm text-brand-600">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <button
                className="rounded-lg p-2 text-brand-500 hover:bg-cream-200 hover:text-brand-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </RadixDialog.Close>
          </div>
          <div className="overflow-y-auto px-4 py-4 sm:px-5 pb-safe">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  tone?: 'danger' | 'default'
  loading?: boolean
  onConfirm: () => void
}

/** Confirmation for destructive actions (brief §30). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'default',
  loading,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <RadixAlert.Root open={open} onOpenChange={onOpenChange}>
      <RadixAlert.Portal>
        <RadixAlert.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RadixAlert.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl focus:outline-none">
          <RadixAlert.Title className="text-base font-semibold text-brand-900">{title}</RadixAlert.Title>
          <RadixAlert.Description className="mt-2 text-sm text-brand-700">
            {description}
          </RadixAlert.Description>
          <div className="mt-5 flex justify-end gap-2">
            <RadixAlert.Cancel asChild>
              <Button variant="outline" size="sm" disabled={loading}>
                Cancel
              </Button>
            </RadixAlert.Cancel>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              size="sm"
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </RadixAlert.Content>
      </RadixAlert.Portal>
    </RadixAlert.Root>
  )
}
