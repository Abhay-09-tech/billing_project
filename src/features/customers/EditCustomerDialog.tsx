import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { updateCustomer } from '@/services/customers'
import type { CustomerRow } from '@/types/database'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Input, Select, Textarea } from '@/components/ui/fields'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: CustomerRow
}

interface EditValues {
  full_name: string
  mobile: string
  whatsapp_number: string
  alt_phone: string
  email: string
  dob: string
  gender: '' | 'male' | 'female' | 'other'
  city: string
  notes: string
}

/**
 * Corrects customer details.
 *
 * Contact and personal details are the one thing staff genuinely mistype
 * every day — a wrong digit in a mobile number means the WhatsApp bill never
 * arrives — so they are editable in place.
 *
 * The customer CODE is not editable: it appears on issued invoices, and
 * changing it would break the link between a bill and the person it was
 * issued to. Every edit is written to the audit log with who changed it.
 */
export function EditCustomerDialog({ open, onOpenChange, customer }: Props) {
  const queryClient = useQueryClient()

  const form = useForm<EditValues>({
    defaultValues: {
      full_name: '', mobile: '', whatsapp_number: '', alt_phone: '',
      email: '', dob: '', gender: '', city: '', notes: '',
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      full_name: customer.full_name ?? '',
      mobile: customer.mobile ?? '',
      whatsapp_number: customer.whatsapp_number ?? '',
      alt_phone: customer.alt_phone ?? '',
      email: customer.email ?? '',
      dob: customer.dob ?? '',
      gender: (customer.gender ?? '') as EditValues['gender'],
      city: customer.city ?? '',
      notes: customer.notes ?? '',
    })
  }, [open, customer, form])

  const mutation = useMutation({
    mutationFn: (values: EditValues) =>
      updateCustomer(customer.id, {
        full_name: values.full_name.trim(),
        mobile: values.mobile.trim(),
        // Empty strings would fail the database's format checks, so blank
        // optional fields are stored as NULL rather than "".
        whatsapp_number: values.whatsapp_number.trim() || null,
        alt_phone: values.alt_phone.trim() || null,
        email: values.email.trim() || null,
        dob: values.dob || null,
        gender: values.gender === '' ? null : values.gender,
        city: values.city.trim() || null,
        notes: values.notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Customer details updated')
      void queryClient.invalidateQueries({ queryKey: ['customer', customer.id] })
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      onOpenChange(false)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not update the customer.')),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit customer"
      description={customer.customer_code}
      size="lg"
    >
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Full name" required htmlFor="e-name">
            <Input id="e-name" autoFocus {...form.register('full_name', { required: true })} />
          </FormField>
          <FormField
            label="Mobile"
            required
            hint="10 digits, starting 6–9"
            htmlFor="e-mobile"
          >
            <Input id="e-mobile" type="tel" inputMode="numeric" maxLength={10}
                   {...form.register('mobile', { required: true })} />
          </FormField>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="WhatsApp number" hint="Blank = same as mobile" htmlFor="e-wa">
            <Input id="e-wa" type="tel" inputMode="numeric" maxLength={10} {...form.register('whatsapp_number')} />
          </FormField>
          <FormField label="Alternate phone" htmlFor="e-alt">
            <Input id="e-alt" type="tel" inputMode="numeric" maxLength={10} {...form.register('alt_phone')} />
          </FormField>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Email" htmlFor="e-email">
            <Input id="e-email" type="email" inputMode="email" {...form.register('email')} />
          </FormField>
          <FormField label="Date of birth" htmlFor="e-dob">
            <Input id="e-dob" type="date" {...form.register('dob')} />
          </FormField>
          <FormField label="Gender" htmlFor="e-gender">
            <Select id="e-gender" {...form.register('gender')}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          </FormField>
        </div>

        <FormField label="City" htmlFor="e-city">
          <Input id="e-city" {...form.register('city')} />
        </FormField>

        <FormField label="Notes" htmlFor="e-notes">
          <Textarea id="e-notes" rows={2} {...form.register('notes')} />
        </FormField>

        <p className="rounded-lg bg-cream-100 px-3 py-2 text-xs text-brand-700">
          The customer ID ({customer.customer_code}) cannot be changed — it appears on invoices
          already issued. Every edit is recorded in the audit log.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
