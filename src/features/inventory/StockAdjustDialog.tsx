import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { adjustStock, listProducts } from '@/services/products'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Input, Select, Textarea } from '@/components/ui/fields'
import { SearchInput } from '@/components/ui/search-input'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId?: string
}

type Reason = 'purchase_inward' | 'adjustment' | 'damage' | 'opening_stock'

interface FormValues {
  productId: string
  reason: Reason
  direction: 'in' | 'out'
  qty: string
  unitCost: string
  note: string
}

const REASONS: Array<{ value: Reason; label: string; hint: string; fixedDirection?: 'in' | 'out' }> = [
  { value: 'purchase_inward', label: 'Stock received', hint: 'New stock arrived from a supplier', fixedDirection: 'in' },
  { value: 'opening_stock', label: 'Opening stock', hint: 'Counting existing stock into the system for the first time', fixedDirection: 'in' },
  { value: 'adjustment', label: 'Correction', hint: 'Physical count differs from the system', },
  { value: 'damage', label: 'Damaged / written off', hint: 'Broken, lost or unsellable', fixedDirection: 'out' },
]

export function StockAdjustDialog({ open, onOpenChange, productId }: Props) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const form = useForm<FormValues>({
    defaultValues: {
      productId: productId ?? '',
      reason: 'purchase_inward',
      direction: 'in',
      qty: '',
      unitCost: '',
      note: '',
    },
  })

  const products = useQuery({
    queryKey: ['products', 'picker', search],
    queryFn: () => listProducts({ search, page: 0, pageSize: 20 }),
    enabled: open && !productId,
  })

  const reason = form.watch('reason')
  const reasonMeta = REASONS.find((r) => r.value === reason)!
  const direction = reasonMeta.fixedDirection ?? form.watch('direction')

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const qty = Number(values.qty)
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Enter a quantity greater than zero.')
      if (!values.productId) throw new Error('Choose a product.')

      return adjustStock({
        productId: values.productId,
        qtyDelta: direction === 'out' ? -qty : qty,
        reason: values.reason,
        note: values.note.trim() || undefined,
        unitCost: values.unitCost ? Number(values.unitCost) : undefined,
      })
    },
    onSuccess: () => {
      toast.success('Stock updated')
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      form.reset()
      onOpenChange(false)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not update the stock.')),
  })

  // The database requires a reason note for corrections and write-offs.
  const noteRequired = reason === 'adjustment' || reason === 'damage'

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Update stock"
      description="Every movement is recorded permanently with who, when and why."
    >
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        {!productId && (
          <FormField label="Product" required htmlFor="s-product">
            <div className="space-y-2">
              <SearchInput value={search} onValueChange={setSearch} placeholder="Search products…" />
              <Select id="s-product" {...form.register('productId', { required: true })}>
                <option value="">Select a product…</option>
                {products.data?.rows
                  .filter((p) => p.is_stock_tracked)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — {p.product_stock?.[0]?.qty_on_hand ?? 0} in stock
                    </option>
                  ))}
              </Select>
            </div>
          </FormField>
        )}

        <FormField label="Reason" required hint={reasonMeta.hint} htmlFor="s-reason">
          <Select id="s-reason" {...form.register('reason')}>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          {!reasonMeta.fixedDirection && (
            <FormField label="Direction" required htmlFor="s-dir">
              <Select id="s-dir" {...form.register('direction')}>
                <option value="in">Increase stock</option>
                <option value="out">Reduce stock</option>
              </Select>
            </FormField>
          )}
          <FormField label="Quantity" required htmlFor="s-qty">
            <Input
              id="s-qty"
              type="number"
              step="1"
              min={1}
              inputMode="numeric"
              autoFocus={Boolean(productId)}
              {...form.register('qty', { required: true })}
            />
          </FormField>
          {(reason === 'purchase_inward' || reason === 'opening_stock') && (
            <FormField label="Cost per unit" hint="Optional" htmlFor="s-cost">
              <Input id="s-cost" type="number" step="0.01" min={0} inputMode="decimal" {...form.register('unitCost')} />
            </FormField>
          )}
        </div>

        <FormField
          label="Note"
          required={noteRequired}
          hint={noteRequired ? 'Required — explain why the quantity is changing' : 'Optional'}
          htmlFor="s-note"
        >
          <Textarea
            id="s-note"
            rows={2}
            placeholder={
              reason === 'adjustment'
                ? 'e.g. Physical count on 19 Aug found 8, system showed 10'
                : reason === 'damage'
                  ? 'e.g. Frame broken while fitting'
                  : 'e.g. Invoice 4471 from Luxottica'
            }
            {...form.register('note', { required: noteRequired })}
          />
        </FormField>

        <p className="rounded-lg bg-cream-100 px-3 py-2 text-xs text-brand-700">
          Stock is a permanent ledger. This creates a new entry — it never edits or erases
          an earlier one, so the history always explains the current quantity.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {direction === 'out' ? 'Reduce stock' : 'Add stock'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
