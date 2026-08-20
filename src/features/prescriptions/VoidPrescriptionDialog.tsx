import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { voidPrescription } from '@/services/prescriptions'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Textarea } from '@/components/ui/fields'

/**
 * Marks a prescription as entered in error.
 *
 * A prescription is clinical history, so it is never edited or deleted — a
 * wrong power that quietly changed later would make it impossible to explain
 * why a pair of lenses was made the way it was. Voiding keeps the record,
 * marks it struck through, and stops it being offered on new orders. The
 * correct values go in as a new prescription.
 */
export function VoidPrescriptionDialog({
  open,
  onOpenChange,
  prescriptionId,
  customerId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  prescriptionId: string
  customerId?: string
}) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () => voidPrescription(prescriptionId, reason.trim()),
    onSuccess: () => {
      toast.success('Prescription marked as entered in error')
      void queryClient.invalidateQueries({ queryKey: ['prescriptions'] })
      if (customerId) void queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
      setReason('')
      onOpenChange(false)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not void the prescription.')),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mark as entered in error"
      description="The record stays in history, struck through, and is no longer offered on new orders."
    >
      <div className="space-y-4">
        <FormField
          label="Reason"
          required
          hint="Why was this wrong? Recorded permanently."
          htmlFor="void-reason"
        >
          <Textarea
            id="void-reason"
            rows={3}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Right and left eye values were swapped"
          />
        </FormField>

        <p className="rounded-lg bg-cream-100 px-3 py-2 text-xs text-brand-700">
          Prescriptions are never edited or deleted — a power that silently changed later would
          make it impossible to explain why a pair of lenses was made a certain way. Enter the
          correct values as a new prescription afterwards.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Mark as error
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
