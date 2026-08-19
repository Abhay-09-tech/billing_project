import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, ExternalLink, Pencil, Phone, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { logManualWhatsApp } from '@/services/whatsapp'
import { normalizePhone, openWhatsApp } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Input, Textarea } from '@/components/ui/fields'
import { cn } from '@/lib/utils'

type NumberChoice = 'whatsapp' | 'mobile' | 'custom'

export interface WhatsAppShareProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Heading, e.g. "Send bill on WhatsApp". */
  title: string
  customerId?: string | null
  customerName: string
  /** The customer's saved WhatsApp number, if any. */
  savedWhatsApp?: string | null
  /** The customer's mobile number — the usual fallback. */
  mobile?: string | null
  /** Pre-composed message; staff can edit it before opening WhatsApp. */
  message: string
  relatedEntityType?: 'invoice' | 'order' | 'customer' | null
  relatedEntityId?: string | null
  /** Optional note shown above the message, e.g. about attaching the PDF. */
  hint?: string
  onSent?: () => void
}

/**
 * Manual WhatsApp hand-off (brief §4, §5, §12).
 *
 * Staff pick a number (saved WhatsApp, mobile, or a different one), review and
 * optionally edit the message, then press Open WhatsApp. We open WhatsApp's own
 * click-to-chat link — WhatsApp Web on desktop, the app on mobile — and record
 * the action as "Opened". We never claim it was delivered, because only the
 * Cloud API can tell us that.
 */
export function WhatsAppShareDialog({
  open,
  onOpenChange,
  title,
  customerId,
  customerName,
  savedWhatsApp,
  mobile,
  message,
  relatedEntityType,
  relatedEntityId,
  hint,
  onSent,
}: WhatsAppShareProps) {
  const hasSavedWa = Boolean(savedWhatsApp)
  const hasMobile = Boolean(mobile)

  const [choice, setChoice] = useState<NumberChoice>(hasSavedWa ? 'whatsapp' : hasMobile ? 'mobile' : 'custom')
  const [customNumber, setCustomNumber] = useState('')
  const [body, setBody] = useState(message)
  const [editing, setEditing] = useState(false)

  // Reset each time the dialog opens so a stale edit never leaks between customers.
  useEffect(() => {
    if (open) {
      setBody(message)
      setEditing(false)
      setCustomNumber('')
      setChoice(hasSavedWa ? 'whatsapp' : hasMobile ? 'mobile' : 'custom')
    }
  }, [open, message, hasSavedWa, hasMobile])

  const rawNumber =
    choice === 'whatsapp' ? (savedWhatsApp ?? '') : choice === 'mobile' ? (mobile ?? '') : customNumber

  const phone = useMemo(() => normalizePhone(rawNumber), [rawNumber])

  const logMutation = useMutation({
    mutationFn: () =>
      logManualWhatsApp({
        customerId: customerId ?? null,
        toMsisdn: phone.e164!,
        body,
        entityType: relatedEntityType ?? null,
        entityId: relatedEntityId ?? null,
      }),
    // The hand-off already happened; a logging failure must not look like a
    // send failure to the staff member.
    onError: (err) => console.warn('[whatsapp] could not record the manual send', err),
  })

  function handleOpen() {
    if (!phone.valid || !phone.e164) {
      toast.error(phone.error ?? 'Please enter a valid WhatsApp number.')
      return
    }
    openWhatsApp(phone.e164, body)
    logMutation.mutate(undefined, {
      onSettled: () => {
        onSent?.()
      },
    })
    toast.success('WhatsApp opened — press send there to deliver the message')
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={`To ${customerName}`}
      size="md"
    >
      <div className="space-y-4">
        {/* ── Number choice ─────────────────────────────────────────────── */}
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">Send to</p>
          <div className="space-y-2">
            {hasSavedWa && (
              <NumberOption
                selected={choice === 'whatsapp'}
                onSelect={() => setChoice('whatsapp')}
                icon={<Smartphone className="h-4 w-4" />}
                label="Saved WhatsApp number"
                value={normalizePhone(savedWhatsApp).display || savedWhatsApp!}
              />
            )}
            {hasMobile && mobile !== savedWhatsApp && (
              <NumberOption
                selected={choice === 'mobile'}
                onSelect={() => setChoice('mobile')}
                icon={<Phone className="h-4 w-4" />}
                label="Mobile number"
                value={normalizePhone(mobile).display || mobile!}
              />
            )}
            <NumberOption
              selected={choice === 'custom'}
              onSelect={() => setChoice('custom')}
              icon={<Pencil className="h-4 w-4" />}
              label="A different number"
              value={choice === 'custom' ? '' : 'Type another number'}
            />
          </div>

          {choice === 'custom' && (
            <div className="mt-2">
              <FormField
                label="WhatsApp number"
                error={customNumber && !phone.valid ? phone.error : undefined}
                hint={!customNumber ? 'Any format works — 9876543210, +91 98765 43210' : undefined}
                htmlFor="wa-custom"
              >
                <Input
                  id="wa-custom"
                  type="tel"
                  inputMode="tel"
                  autoFocus
                  value={customNumber}
                  onChange={(e) => setCustomNumber(e.target.value)}
                  placeholder="9876543210"
                />
              </FormField>
            </div>
          )}

          {phone.valid && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-green-700">
              <Check className="h-4 w-4" />
              Will open WhatsApp for {phone.display}
            </p>
          )}
        </div>

        {/* ── Message preview ───────────────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Message</p>
            <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
              <Pencil className="h-3.5 w-3.5" />
              {editing ? 'Done editing' : 'Edit message'}
            </Button>
          </div>

          {editing ? (
            <Textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="WhatsApp message"
              className="font-mono text-sm"
            />
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-[#e7ffdb] p-3">
              <p className="text-sm whitespace-pre-wrap text-gray-900">{body}</p>
            </div>
          )}
        </div>

        {hint && <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">{hint}</p>}

        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">
          This opens WhatsApp with the message ready. <strong>You still press send</strong> in
          WhatsApp — the shop's own account sends it, so it lands as a normal chat.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleOpen} disabled={!phone.valid}>
            <ExternalLink className="h-4 w-4" />
            Open WhatsApp
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function NumberOption({
  selected,
  onSelect,
  icon,
  label,
  value,
}: {
  selected: boolean
  onSelect: () => void
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
          : 'border-gray-300 hover:bg-gray-50',
      )}
    >
      <span className={cn('shrink-0', selected ? 'text-brand-700' : 'text-gray-400')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {value && <span className="block truncate text-sm tabular-nums text-gray-500">{value}</span>}
      </span>
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-brand-600 bg-brand-600' : 'border-gray-300',
        )}
      >
        {selected && <Check className="h-3 w-3 text-white" />}
      </span>
    </button>
  )
}
