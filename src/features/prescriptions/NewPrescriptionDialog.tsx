import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { createPrescription } from '@/services/prescriptions'
import type { PrescriptionRow, RxType } from '@/types/database'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Input, Select, Textarea } from '@/components/ui/fields'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerId: string
  onCreated?: (rx: PrescriptionRow) => void
}

interface RxFormValues {
  rx_date: string
  rx_type: RxType
  prescribed_by: string
  remarks: string
  od_sph: string; od_cyl: string; od_axis: string; od_add: string
  os_sph: string; os_cyl: string; os_axis: string; os_add: string
  pd_right: string; pd_left: string; pd_binocular: string
  od_seg_ht: string; os_seg_ht: string
  od_prism_h: string; od_prism_h_base: string; od_prism_v: string; od_prism_v_base: string
  os_prism_h: string; os_prism_h_base: string; os_prism_v: string; os_prism_v_base: string
}

const num = (v: string): number | null => {
  const t = v?.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function NewPrescriptionDialog({ open, onOpenChange, customerId, onCreated }: Props) {
  const queryClient = useQueryClient()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<RxFormValues>({
    defaultValues: {
      rx_date: new Date().toISOString().slice(0, 10),
      rx_type: 'distance',
      prescribed_by: '',
      remarks: '',
      od_sph: '', od_cyl: '', od_axis: '', od_add: '',
      os_sph: '', os_cyl: '', os_axis: '', os_add: '',
      pd_right: '', pd_left: '', pd_binocular: '',
      od_seg_ht: '', os_seg_ht: '',
      od_prism_h: '', od_prism_h_base: '', od_prism_v: '', od_prism_v_base: '',
      os_prism_h: '', os_prism_h_base: '', os_prism_v: '', os_prism_v_base: '',
    },
  })

  const mutation = useMutation({
    mutationFn: async (values: RxFormValues) => {
      const rx = await createPrescription({
        customer_id: customerId,
        rx_date: values.rx_date,
        rx_type: values.rx_type,
        prescribed_by: values.prescribed_by.trim() || null,
        remarks: values.remarks.trim() || null,
        od_sph: num(values.od_sph), od_cyl: num(values.od_cyl),
        od_axis: num(values.od_axis), od_add: num(values.od_add),
        os_sph: num(values.os_sph), os_cyl: num(values.os_cyl),
        os_axis: num(values.os_axis), os_add: num(values.os_add),
        pd_right: num(values.pd_right), pd_left: num(values.pd_left),
        pd_binocular: num(values.pd_binocular),
        od_seg_ht: num(values.od_seg_ht), os_seg_ht: num(values.os_seg_ht),
        od_prism_h: num(values.od_prism_h),
        od_prism_h_base: (values.od_prism_h_base || null) as 'in' | 'out' | null,
        od_prism_v: num(values.od_prism_v),
        od_prism_v_base: (values.od_prism_v_base || null) as 'up' | 'down' | null,
        os_prism_h: num(values.os_prism_h),
        os_prism_h_base: (values.os_prism_h_base || null) as 'in' | 'out' | null,
        os_prism_v: num(values.os_prism_v),
        os_prism_v_base: (values.os_prism_v_base || null) as 'up' | 'down' | null,
      })
      return rx
    },
    onSuccess: (rx) => {
      toast.success('Prescription saved')
      void queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
      void queryClient.invalidateQueries({ queryKey: ['prescriptions'] })
      form.reset()
      setShowAdvanced(false)
      onOpenChange(false)
      onCreated?.(rx)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not save the prescription.')),
  })

  function onSubmit(values: RxFormValues) {
    setFormError(null)

    // Mirror the database CHECK constraints so the message is friendly and
    // immediate rather than a round-trip error.
    for (const eye of ['od', 'os'] as const) {
      const cyl = num(values[`${eye}_cyl`])
      const axis = num(values[`${eye}_axis`])
      if (cyl != null && cyl !== 0 && axis == null) {
        setFormError(`${eye.toUpperCase()}: axis is required when cylinder power is entered.`)
        return
      }
      if ((cyl == null || cyl === 0) && axis != null) {
        setFormError(`${eye.toUpperCase()}: axis needs a cylinder power.`)
        return
      }
    }
    if (num(values.od_sph) == null && num(values.os_sph) == null &&
        num(values.od_cyl) == null && num(values.os_cyl) == null &&
        values.rx_type !== 'contact_lens') {
      setFormError('Enter at least one power value.')
      return
    }
    mutation.mutate(values)
  }

  const needsAdd = ['near', 'bifocal', 'progressive'].includes(form.watch('rx_type'))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New prescription"
      description="Saved as a new record — earlier prescriptions are never overwritten."
      size="lg"
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Prescription date" required htmlFor="rx-date">
            <Input id="rx-date" type="date" max={new Date().toISOString().slice(0, 10)} {...form.register('rx_date', { required: true })} />
          </FormField>
          <FormField label="Type" required htmlFor="rx-type">
            <Select id="rx-type" {...form.register('rx_type')}>
              <option value="distance">Distance</option>
              <option value="near">Near</option>
              <option value="bifocal">Bifocal</option>
              <option value="progressive">Progressive</option>
              <option value="contact_lens">Contact lens</option>
            </Select>
          </FormField>
          <FormField label="Doctor / Optometrist" htmlFor="rx-by">
            <Input id="rx-by" placeholder="Name" {...form.register('prescribed_by')} />
          </FormField>
        </div>

        {/* Power grid — the fast path staff use every day. */}
        <div className="overflow-x-auto rounded-lg border border-cream-300">
          <table className="w-full min-w-[34rem]">
            <thead className="bg-cream-100">
              <tr className="text-xs font-medium text-brand-600">
                <th className="w-12 px-2 py-2 text-left">Eye</th>
                <th className="px-2 py-2 text-left">SPH</th>
                <th className="px-2 py-2 text-left">CYL</th>
                <th className="px-2 py-2 text-left">AXIS</th>
                {needsAdd && <th className="px-2 py-2 text-left">ADD</th>}
                <th className="px-2 py-2 text-left">PD</th>
              </tr>
            </thead>
            <tbody>
              {(['od', 'os'] as const).map((eye) => (
                <tr key={eye} className="border-t border-cream-200">
                  <td className="px-2 py-2 text-sm font-semibold text-brand-700">{eye.toUpperCase()}</td>
                  <td className="px-2 py-2">
                    <Input type="number" step="0.25" min={-30} max={30} inputMode="decimal" placeholder="0.00" aria-label={`${eye} sphere`} {...form.register(`${eye}_sph`)} />
                  </td>
                  <td className="px-2 py-2">
                    <Input type="number" step="0.25" min={-10} max={10} inputMode="decimal" placeholder="0.00" aria-label={`${eye} cylinder`} {...form.register(`${eye}_cyl`)} />
                  </td>
                  <td className="px-2 py-2">
                    <Input type="number" step="1" min={1} max={180} inputMode="numeric" placeholder="—" aria-label={`${eye} axis`} {...form.register(`${eye}_axis`)} />
                  </td>
                  {needsAdd && (
                    <td className="px-2 py-2">
                      <Input type="number" step="0.25" min={0.25} max={4} inputMode="decimal" placeholder="0.00" aria-label={`${eye} add`} {...form.register(`${eye}_add`)} />
                    </td>
                  )}
                  <td className="px-2 py-2">
                    <Input type="number" step="0.5" min={20} max={45} inputMode="decimal" placeholder="—" aria-label={`${eye} PD`} {...form.register(eye === 'od' ? 'pd_right' : 'pd_left')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-brand-600">
          Enter monocular PD per eye where known — progressive lenses need it. Otherwise use the binocular PD below.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <FormField label="PD (binocular)" htmlFor="rx-pdb">
            <Input id="rx-pdb" type="number" step="0.5" min={40} max={90} inputMode="decimal" {...form.register('pd_binocular')} />
          </FormField>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          Prism &amp; segment height
        </button>

        {showAdvanced && (
          <div className="space-y-3 rounded-lg border border-cream-300 p-3">
            {(['od', 'os'] as const).map((eye) => (
              <div key={eye} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <p className="col-span-2 self-center text-sm font-semibold text-brand-700 sm:col-span-1">
                  {eye.toUpperCase()}
                </p>
                <FormField label="Prism H" htmlFor={`${eye}-ph`}>
                  <Input id={`${eye}-ph`} type="number" step="0.25" inputMode="decimal" {...form.register(`${eye}_prism_h`)} />
                </FormField>
                <FormField label="Base" htmlFor={`${eye}-phb`}>
                  <Select id={`${eye}-phb`} {...form.register(`${eye}_prism_h_base`)}>
                    <option value="">—</option>
                    <option value="in">In</option>
                    <option value="out">Out</option>
                  </Select>
                </FormField>
                <FormField label="Prism V" htmlFor={`${eye}-pv`}>
                  <Input id={`${eye}-pv`} type="number" step="0.25" inputMode="decimal" {...form.register(`${eye}_prism_v`)} />
                </FormField>
                <FormField label="Base" htmlFor={`${eye}-pvb`}>
                  <Select id={`${eye}-pvb`} {...form.register(`${eye}_prism_v_base`)}>
                    <option value="">—</option>
                    <option value="up">Up</option>
                    <option value="down">Down</option>
                  </Select>
                </FormField>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Seg height OD" htmlFor="rx-segod">
                <Input id="rx-segod" type="number" step="0.5" inputMode="decimal" {...form.register('od_seg_ht')} />
              </FormField>
              <FormField label="Seg height OS" htmlFor="rx-segos">
                <Input id="rx-segos" type="number" step="0.5" inputMode="decimal" {...form.register('os_seg_ht')} />
              </FormField>
            </div>
          </div>
        )}

        <FormField label="Remarks" htmlFor="rx-remarks">
          <Textarea id="rx-remarks" rows={2} {...form.register('remarks')} />
        </FormField>

        {formError && (
          <p className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
            {formError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Save prescription
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
