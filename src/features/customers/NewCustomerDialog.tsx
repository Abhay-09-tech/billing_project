import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { createCustomer, findDuplicates } from '@/services/customers'
import type { CustomerRow } from '@/types/database'
import { friendlyError } from '@/lib/errors'
import { formatMobile } from '@/lib/format'
import { customerSchema, type CustomerFormValues } from './schemas'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Input, Select, Textarea } from '@/components/ui/fields'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (customer: CustomerRow) => void
}

/**
 * Progressive data entry (brief §33): name + mobile is the whole required
 * form. Everything else lives behind "More details" so the fast path is also
 * the correct path.
 */
export function NewCustomerDialog({ open, onOpenChange, onCreated }: Props) {
  const queryClient = useQueryClient()
  const [showMore, setShowMore] = useState(false)
  const [duplicates, setDuplicates] = useState<CustomerRow[]>([])

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: { fullName: '', mobile: '', whatsappOptIn: true },
  })

  const mutation = useMutation({
    mutationFn: createCustomer,
    onSuccess: (customer) => {
      toast.success(`${customer.full_name} added (${customer.customer_code})`)
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      form.reset()
      setDuplicates([])
      setShowMore(false)
      onOpenChange(false)
      onCreated?.(customer)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not save the customer.')),
  })

  // Check for an existing customer as soon as a full mobile number is typed.
  async function checkDuplicates(mobile: string) {
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setDuplicates([])
      return
    }
    try {
      setDuplicates(await findDuplicates(mobile, form.getValues('fullName') || undefined))
    } catch {
      setDuplicates([]) // a failed probe must never block customer creation
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New customer" description="Name and mobile are enough to start.">
      <form
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="space-y-4"
      >
        <FormField label="Full name" required error={form.formState.errors.fullName?.message} htmlFor="c-name">
          <Input id="c-name" autoFocus autoComplete="name" placeholder="e.g. Ramesh Kumar" {...form.register('fullName')} />
        </FormField>

        <FormField label="Mobile number" required error={form.formState.errors.mobile?.message} htmlFor="c-mobile">
          <Input
            id="c-mobile"
            type="tel"
            inputMode="numeric"
            maxLength={10}
            autoComplete="tel-national"
            placeholder="9876543210"
            {...form.register('mobile', {
              onChange: (e) => void checkDuplicates(e.target.value.trim()),
            })}
          />
        </FormField>

        {duplicates.length > 0 && (
          <div className="rounded-lg border border-warning-600/30 bg-warning-50 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-warning-700">
              <AlertTriangle className="h-4 w-4" />
              Possible existing customer
            </p>
            <ul className="mt-2 space-y-1.5">
              {duplicates.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-warning-700">
                    {d.full_name} · {formatMobile(d.mobile)}{' '}
                    <span className="text-warning-700">({d.customer_code})</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false)
                      onCreated?.(d)
                    }}
                  >
                    Use this
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-warning-700">
              You can still create a new customer — the mobile number must differ.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? 'rotate-180' : ''}`} />
          {showMore ? 'Hide extra details' : 'More details (optional)'}
        </button>

        {showMore && (
          <div className="space-y-4 border-t border-cream-200 pt-4">
            <FormField label="WhatsApp number" hint="Leave blank to use the mobile number" error={form.formState.errors.whatsappNumber?.message} htmlFor="c-wa">
              <Input id="c-wa" type="tel" inputMode="numeric" maxLength={10} {...form.register('whatsappNumber')} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Date of birth" htmlFor="c-dob">
                <Input id="c-dob" type="date" max={new Date().toISOString().slice(0, 10)} {...form.register('dob')} />
              </FormField>
              <FormField label="Gender" htmlFor="c-gender">
                <Select id="c-gender" {...form.register('gender')}>
                  <option value="">Not specified</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </Select>
              </FormField>
            </div>
            <FormField label="Email" error={form.formState.errors.email?.message} htmlFor="c-email">
              <Input id="c-email" type="email" inputMode="email" {...form.register('email')} />
            </FormField>
            <FormField label="Address" htmlFor="c-address">
              <Textarea id="c-address" rows={2} {...form.register('addressLine')} />
            </FormField>
            <FormField label="City" htmlFor="c-city">
              <Input id="c-city" {...form.register('city')} />
            </FormField>
            <FormField label="Notes" htmlFor="c-notes">
              <Textarea id="c-notes" rows={2} placeholder="Preferences, referrals, anything useful next visit" {...form.register('notes')} />
            </FormField>
            <label className="flex items-start gap-2.5 text-sm text-brand-800">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-cream-300 text-brand-700 focus:ring-brand-600" {...form.register('whatsappOptIn')} />
              <span>
                Customer agrees to receive updates on WhatsApp
                <span className="block text-xs text-brand-600">Required for promotional messages such as review requests.</span>
              </span>
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Save customer
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
