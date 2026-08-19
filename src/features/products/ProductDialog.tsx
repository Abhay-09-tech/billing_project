import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createProduct,
  getBrands,
  getCategories,
  getSuppliers,
  nextSku,
  updateProduct,
  type ProductWithStock,
} from '@/services/products'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Input, Select } from '@/components/ui/fields'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pass a product to edit it; omit to create a new one. */
  product?: ProductWithStock | null
}

interface ProductFormValues {
  sku: string
  barcode: string
  name: string
  category_id: string
  brand_id: string
  supplier_id: string
  model: string
  size: string
  color: string
  purchase_price: string
  selling_price: string
  gst_rate_pct: string
  hsn_code: string
  min_stock_level: string
  is_stock_tracked: boolean
  openingStock: string
}

const numOrNull = (v: string) => {
  const t = v?.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function ProductDialog({ open, onOpenChange, product }: Props) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(product)

  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories, enabled: open })
  const brands = useQuery({ queryKey: ['brands'], queryFn: getBrands, enabled: open })
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: getSuppliers, enabled: open })

  const form = useForm<ProductFormValues>({
    defaultValues: {
      sku: '', barcode: '', name: '', category_id: '', brand_id: '', supplier_id: '',
      model: '', size: '', color: '', purchase_price: '', selling_price: '',
      gst_rate_pct: '12', hsn_code: '', min_stock_level: '1',
      is_stock_tracked: true, openingStock: '',
    },
  })

  // Load the product when editing; allocate a fresh SKU when creating.
  useEffect(() => {
    if (!open) return
    if (product) {
      form.reset({
        sku: product.sku,
        barcode: product.barcode ?? '',
        name: product.name,
        category_id: product.category_id,
        brand_id: product.brand_id ?? '',
        supplier_id: product.supplier_id ?? '',
        model: product.model ?? '',
        size: product.size ?? '',
        color: product.color ?? '',
        purchase_price: product.purchase_price?.toString() ?? '',
        selling_price: product.selling_price.toString(),
        gst_rate_pct: product.gst_rate_pct.toString(),
        hsn_code: product.hsn_code ?? '',
        min_stock_level: product.min_stock_level.toString(),
        is_stock_tracked: product.is_stock_tracked,
        openingStock: '',
      })
    } else {
      form.reset()
      nextSku()
        .then((sku) => form.setValue('sku', sku))
        .catch(() => {
          /* staff can type their own SKU if allocation fails */
        })
    }
  }, [open, product, form])

  // A made-to-order category (lenses) must not be stock-tracked — mirrors the
  // rule in the database, so the form cannot produce an impossible product.
  const categoryId = form.watch('category_id')
  const category = categories.data?.find((c) => c.id === categoryId)
  useEffect(() => {
    if (category && category.kind !== 'stocked') form.setValue('is_stock_tracked', false)
  }, [category, form])

  const mutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const payload = {
        sku: values.sku.trim(),
        barcode: values.barcode.trim() || null,
        name: values.name.trim(),
        category_id: values.category_id,
        brand_id: values.brand_id || null,
        supplier_id: values.supplier_id || null,
        model: values.model.trim() || null,
        size: values.size.trim() || null,
        color: values.color.trim() || null,
        purchase_price: numOrNull(values.purchase_price),
        selling_price: numOrNull(values.selling_price) ?? 0,
        gst_rate_pct: numOrNull(values.gst_rate_pct) ?? 0,
        hsn_code: values.hsn_code.trim() || null,
        min_stock_level: numOrNull(values.min_stock_level) ?? 0,
        is_stock_tracked: values.is_stock_tracked,
      }

      if (product) {
        await updateProduct(product.id, payload)
        return product.id
      }

      const created = await createProduct(payload)

      // Opening stock goes through the ledger, never straight into a quantity
      // column — so day-one counts are as auditable as every later movement.
      const opening = numOrNull(values.openingStock)
      if (opening && opening > 0 && payload.is_stock_tracked) {
        const { adjustStock } = await import('@/services/products')
        await adjustStock({
          productId: created.id,
          qtyDelta: opening,
          reason: 'opening_stock',
          note: 'Opening stock entered when the product was created',
          unitCost: payload.purchase_price ?? undefined,
        })
      }
      return created.id
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Product updated' : 'Product added')
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      onOpenChange(false)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not save the product.')),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit product' : 'New product'}
      description={isEdit ? product?.sku : 'Frames, sunglasses, lenses, accessories'}
      size="lg"
    >
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Product name" required htmlFor="p-name">
            <Input id="p-name" autoFocus placeholder="e.g. Ray-Ban RB5154" {...form.register('name', { required: true })} />
          </FormField>
          <FormField label="Category" required htmlFor="p-cat">
            <Select id="p-cat" {...form.register('category_id', { required: true })}>
              <option value="">Select a category…</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="SKU" required hint={isEdit ? undefined : 'Allocated automatically'} htmlFor="p-sku">
            <Input id="p-sku" {...form.register('sku', { required: true })} />
          </FormField>
          <FormField label="Brand" htmlFor="p-brand">
            <Select id="p-brand" {...form.register('brand_id')}>
              <option value="">—</option>
              {brands.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Model" htmlFor="p-model">
            <Input id="p-model" {...form.register('model')} />
          </FormField>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Size" hint="e.g. 52-18-140" htmlFor="p-size">
            <Input id="p-size" {...form.register('size')} />
          </FormField>
          <FormField label="Colour" htmlFor="p-color">
            <Input id="p-color" {...form.register('color')} />
          </FormField>
          <FormField label="Barcode" htmlFor="p-barcode">
            <Input id="p-barcode" {...form.register('barcode')} />
          </FormField>
        </div>

        <div className="grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-4">
          <FormField label="Purchase price" htmlFor="p-pp">
            <Input id="p-pp" type="number" step="0.01" min={0} inputMode="decimal" {...form.register('purchase_price')} />
          </FormField>
          <FormField label="Selling price" required hint="Inclusive of GST" htmlFor="p-sp">
            <Input id="p-sp" type="number" step="0.01" min={0} inputMode="decimal" {...form.register('selling_price', { required: true })} />
          </FormField>
          <FormField label="GST rate %" required hint="Confirm with your CA" htmlFor="p-gst">
            <Select id="p-gst" {...form.register('gst_rate_pct', { required: true })}>
              {['0', '5', '12', '18', '28'].map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="HSN code" htmlFor="p-hsn">
            <Input id="p-hsn" inputMode="numeric" {...form.register('hsn_code')} />
          </FormField>
        </div>

        <div className="grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3">
          <FormField label="Supplier" htmlFor="p-sup">
            <Select id="p-sup" {...form.register('supplier_id')}>
              <option value="">—</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Low-stock alert at" htmlFor="p-min">
            <Input
              id="p-min"
              type="number"
              step="1"
              min={0}
              inputMode="numeric"
              disabled={!form.watch('is_stock_tracked')}
              {...form.register('min_stock_level')}
            />
          </FormField>
          {!isEdit && (
            <FormField
              label="Opening stock"
              hint={form.watch('is_stock_tracked') ? 'Quantity in hand today' : 'Not stocked'}
              htmlFor="p-open"
            >
              <Input
                id="p-open"
                type="number"
                step="1"
                min={0}
                inputMode="numeric"
                disabled={!form.watch('is_stock_tracked')}
                {...form.register('openingStock')}
              />
            </FormField>
          )}
        </div>

        <label className="flex items-start gap-2.5 text-sm text-gray-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-700 focus:ring-brand-600"
            disabled={category ? category.kind !== 'stocked' : false}
            {...form.register('is_stock_tracked')}
          />
          <span>
            Track stock for this product
            <span className="block text-xs text-gray-500">
              Turn off for made-to-order items such as prescription lenses, which are ordered
              from the lab per job rather than held on the shelf.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Add product'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
