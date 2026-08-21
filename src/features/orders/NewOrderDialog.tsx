import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { createOrder } from '@/services/orders'
import { getCustomer360, searchCustomers } from '@/services/customers'
import { listProducts } from '@/services/products'
import type { CustomerSearchHit, NewOrderItemInput, OrderRow } from '@/types/database'
import { computeInvoiceTotals } from '@/lib/gst'
import { formatMoney } from '@/lib/money'
import { formatDate, formatMobile } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { FormField, Input, Select, Textarea } from '@/components/ui/fields'
import { SearchInput } from '@/components/ui/search-input'
import { NewCustomerDialog } from '@/features/customers/NewCustomerDialog'
import { RxCard } from '@/features/prescriptions/RxCard'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialCustomerId?: string | null
  onCreated?: (order: OrderRow) => void
}

interface DraftLine {
  key: string
  item_kind: NewOrderItemInput['item_kind']
  product_id?: string
  description: string
  qty: number
  unit_price: number
  discount_amt: number
  gst_rate_pct: number
  lens_spec?: { type?: string; index?: string; coating?: string }
}

let lineCounter = 0
const newKey = () => `line-${++lineCounter}`

/**
 * Order builder following the billing flow in the brief §32:
 * customer → prescription → frame → lens → discount → advance.
 * Totals shown here are the TypeScript mirror of the database GST function;
 * the values actually stored are recomputed server-side by rpc_create_order.
 */
export function NewOrderDialog({ open, onOpenChange, initialCustomerId, onCreated }: Props) {
  const queryClient = useQueryClient()
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId ?? null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)
  const [prescriptionId, setPrescriptionId] = useState<string>('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [advance, setAdvance] = useState('')
  const [advanceMethod, setAdvanceMethod] = useState('cash')
  const [productSearch, setProductSearch] = useState('')

  // Idempotency key per opening of the dialog — a double click on
  // "Create order" returns the order already created, never a second one.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())

  useEffect(() => {
    if (open) {
      setRequestId(crypto.randomUUID())
      if (initialCustomerId) setCustomerId(initialCustomerId)
    }
  }, [open, initialCustomerId])

  const searchResults = useQuery({
    queryKey: ['customers', 'search', customerSearch],
    queryFn: () => searchCustomers(customerSearch),
    enabled: open && !customerId && customerSearch.trim().length >= 2,
  })

  const customer = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => getCustomer360(customerId!),
    enabled: open && Boolean(customerId),
  })

  const products = useQuery({
    queryKey: ['products', 'picker', productSearch],
    queryFn: () => listProducts({ search: productSearch, page: 0, pageSize: 15 }),
    enabled: open && Boolean(customerId),
  })

  // Default to the customer's most recent live prescription.
  useEffect(() => {
    const live = customer.data?.prescriptions.find((p) => !p.voided_at)
    if (live && !prescriptionId) setPrescriptionId(live.id)
  }, [customer.data, prescriptionId])

  /** A discount larger than the line's own value is the one invalid state. */
  const lineOverDiscounted = (l: DraftLine) =>
    l.discount_amt > Math.round(l.qty * l.unit_price * 100) / 100 + 0.0001

  const invalidLines = useMemo(() => lines.filter(lineOverDiscounted), [lines])

  const totals = useMemo(
    () =>
      computeInvoiceTotals(
        lines
          // Excluded rather than computed: computeGstLine throws on a negative
          // net, and a throw here happens during render, blanking the screen.
          .filter((l) => !lineOverDiscounted(l))
          .map((l) => ({
            qty: l.qty,
            unitPrice: l.unit_price,
            discountAmt: l.discount_amt,
            gstRatePct: l.gst_rate_pct,
            taxInclusive: true,
            intraState: true,
          })),
      ),
    [lines],
  )

  const mutation = useMutation({
    mutationFn: () =>
      createOrder({
        customerId: customerId!,
        prescriptionId: prescriptionId || null,
        expectedDeliveryDate: expectedDate || null,
        notes: notes.trim() || null,
        advanceAmount: advance ? Number(advance) : 0,
        advanceMethod,
        requestId,
        items: lines.map((l) => ({
          item_kind: l.item_kind,
          product_id: l.product_id,
          description: l.description,
          lens_spec: l.lens_spec ?? undefined,
          qty: l.qty,
          unit_price: l.unit_price,
          discount_amt: l.discount_amt,
          gst_rate_pct: l.gst_rate_pct,
        })),
      }),
    onSuccess: (order) => {
      toast.success(`Order ${order.order_code} created`)
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      reset()
      onOpenChange(false)
      onCreated?.(order)
    },
    onError: (err) => toast.error(friendlyError(err, 'Could not create the order.')),
  })

  function reset() {
    setCustomerId(null)
    setCustomerSearch('')
    setPrescriptionId('')
    setLines([])
    setExpectedDate('')
    setNotes('')
    setAdvance('')
    setProductSearch('')
  }

  function addProduct(id: string) {
    const p = products.data?.rows.find((r) => r.id === id)
    if (!p) return
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        item_kind: 'product',
        product_id: p.id,
        description: p.name,
        qty: 1,
        unit_price: Number(p.selling_price),
        discount_amt: 0,
        gst_rate_pct: Number(p.gst_rate_pct),
      },
    ])
  }

  function addLens() {
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        item_kind: 'lens',
        description: '',
        qty: 1,
        unit_price: 0,
        discount_amt: 0,
        gst_rate_pct: 12,
        lens_spec: {},
      },
    ])
  }

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const advanceNum = Number(advance) || 0
  const advanceTooHigh = advanceNum > totals.grandTotal
  const canSubmit =
    Boolean(customerId) &&
    lines.length > 0 &&
    lines.every((l) => l.description.trim() && l.unit_price >= 0) &&
    invalidLines.length === 0 &&
    !advanceTooHigh

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) reset()
          onOpenChange(v)
        }}
        title="New order"
        description="Frame, lenses and any extras for one job"
        size="lg"
      >
        <div className="space-y-5">
          {/* ── 1. Customer ─────────────────────────────────────────────── */}
          <section>
            <p className="mb-2 text-xs font-semibold tracking-wide text-brand-600 uppercase">
              1 · Customer
            </p>
            {customerId && customer.data ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cream-300 bg-cream-100 px-3 py-2.5">
                <div>
                  <p className="font-medium text-brand-900">{customer.data.customer.full_name}</p>
                  <p className="text-sm text-brand-600">
                    {formatMobile(customer.data.customer.mobile)} ·{' '}
                    {customer.data.customer.customer_code}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCustomerId(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <SearchInput
                    value={customerSearch}
                    onValueChange={setCustomerSearch}
                    placeholder="Search name or mobile…"
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={() => setNewCustomerOpen(true)}>
                    <UserPlus className="h-4 w-4" />
                    New
                  </Button>
                </div>
                {searchResults.data && searchResults.data.length > 0 && (
                  <ul className="max-h-44 divide-y divide-cream-200 overflow-y-auto rounded-lg border border-cream-300">
                    {searchResults.data.map((hit: CustomerSearchHit) => (
                      <li key={`${hit.id}-${hit.match_via}`}>
                        <button
                          onClick={() => {
                            setCustomerId(hit.id)
                            setPrescriptionId('')
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-brand-50"
                        >
                          <span>
                            <span className="block text-sm font-medium text-brand-900">
                              {hit.full_name}
                            </span>
                            <span className="block text-xs text-brand-600">
                              {formatMobile(hit.mobile)} · {hit.customer_code}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {customerId && (
            <>
              {/* ── 2. Prescription ───────────────────────────────────── */}
              <section>
                <p className="mb-2 text-xs font-semibold tracking-wide text-brand-600 uppercase">
                  2 · Prescription
                </p>
                {customer.data && customer.data.prescriptions.length > 0 ? (
                  <div className="space-y-2">
                    <Select
                      value={prescriptionId}
                      onChange={(e) => setPrescriptionId(e.target.value)}
                      aria-label="Prescription"
                    >
                      <option value="">No prescription (sunglasses, accessories)</option>
                      {customer.data.prescriptions
                        .filter((p) => !p.voided_at)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {formatDate(p.rx_date)} — {p.rx_type.replace('_', ' ')}
                          </option>
                        ))}
                    </Select>
                    {prescriptionId && (
                      <RxCard
                        rx={customer.data.prescriptions.find((p) => p.id === prescriptionId)!}
                        compact
                      />
                    )}
                  </div>
                ) : (
                  <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
                    This customer has no prescription yet. You can still take the order — add the
                    prescription from their profile before sending the job to the lab.
                  </p>
                )}
              </section>

              {/* ── 3. Items ──────────────────────────────────────────── */}
              <section>
                <p className="mb-2 text-xs font-semibold tracking-wide text-brand-600 uppercase">
                  3 · Frame, lenses and extras
                </p>

                <div className="mb-3 flex flex-wrap gap-2">
                  <div className="flex-1 space-y-2">
                    <SearchInput
                      value={productSearch}
                      onValueChange={setProductSearch}
                      placeholder="Search frames, sunglasses, accessories…"
                    />
                    <Select
                      value=""
                      onChange={(e) => e.target.value && addProduct(e.target.value)}
                      aria-label="Add a product"
                    >
                      <option value="">Add a product…</option>
                      {products.data?.rows.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {formatMoney(p.selling_price)}
                          {p.is_stock_tracked
                            ? ` (${p.product_stock?.[0]?.qty_on_hand ?? 0} in stock)`
                            : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button variant="outline" onClick={addLens} className="self-end">
                    <Plus className="h-4 w-4" />
                    Add lens
                  </Button>
                </div>

                {lines.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-cream-300 px-3 py-6 text-center text-sm text-brand-600">
                    No items yet. Add a frame from the list, or add a lens.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {lines.map((line) => (
                      <div key={line.key} className="rounded-lg border border-cream-300 p-3">
                        <div className="mb-2 flex items-start gap-2">
                          <div className="flex-1">
                            {line.item_kind === 'lens' ? (
                              <Input
                                value={line.description}
                                onChange={(e) => updateLine(line.key, { description: e.target.value })}
                                placeholder="Lens description, e.g. 1.56 Blue-cut single vision"
                                aria-label="Lens description"
                              />
                            ) : (
                              <p className="pt-2 font-medium text-brand-900">{line.description}</p>
                            )}
                          </div>
                          <button
                            onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                            className="rounded-lg p-2 text-brand-500 hover:bg-error-50 hover:text-error-600"
                            aria-label="Remove item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <FormField label="Qty" htmlFor={`${line.key}-qty`}>
                            <Input
                              id={`${line.key}-qty`}
                              type="number"
                              min={1}
                              step={1}
                              inputMode="numeric"
                              value={line.qty}
                              onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) || 1 })}
                            />
                          </FormField>
                          <FormField label="Price" htmlFor={`${line.key}-price`}>
                            <Input
                              id={`${line.key}-price`}
                              type="number"
                              min={0}
                              step="0.01"
                              inputMode="decimal"
                              value={line.unit_price}
                              onChange={(e) =>
                                updateLine(line.key, { unit_price: Number(e.target.value) || 0 })
                              }
                            />
                          </FormField>
                          <FormField
                            label="Discount ₹"
                            error={
                              lineOverDiscounted(line)
                                ? `Max ${formatMoney(line.qty * line.unit_price)}`
                                : undefined
                            }
                            htmlFor={`${line.key}-disc`}
                          >
                            <Input
                              id={`${line.key}-disc`}
                              type="number"
                              min={0}
                              max={line.qty * line.unit_price}
                              step="0.01"
                              inputMode="decimal"
                              aria-invalid={lineOverDiscounted(line) || undefined}
                              value={line.discount_amt}
                              onChange={(e) =>
                                updateLine(line.key, { discount_amt: Number(e.target.value) || 0 })
                              }
                            />
                          </FormField>
                          <FormField label="GST %" htmlFor={`${line.key}-gst`}>
                            <Select
                              id={`${line.key}-gst`}
                              value={line.gst_rate_pct}
                              onChange={(e) =>
                                updateLine(line.key, { gst_rate_pct: Number(e.target.value) })
                              }
                            >
                              {[0, 5, 12, 18, 28].map((r) => (
                                <option key={r} value={r}>
                                  {r}%
                                </option>
                              ))}
                            </Select>
                          </FormField>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── 4. Totals + advance ───────────────────────────────── */}
              {lines.length > 0 && (
                <section className="rounded-lg bg-cream-100 p-3">
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between text-brand-700">
                      <dt>Taxable value</dt>
                      <dd className="tabular-nums">{formatMoney(totals.taxableTotal)}</dd>
                    </div>
                    <div className="flex justify-between text-brand-700">
                      <dt>CGST + SGST</dt>
                      <dd className="tabular-nums">
                        {formatMoney(totals.cgstTotal + totals.sgstTotal)}
                      </dd>
                    </div>
                    {totals.discountTotal > 0 && (
                      <div className="flex justify-between text-brand-700">
                        <dt>Discount</dt>
                        <dd className="tabular-nums">− {formatMoney(totals.discountTotal)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-cream-300 pt-1.5 text-base font-semibold text-brand-900">
                      <dt>Total</dt>
                      <dd className="tabular-nums">{formatMoney(totals.grandTotal)}</dd>
                    </div>
                  </dl>
                  <p className="mt-1.5 text-xs text-brand-600">
                    Prices include GST. The final bill is recalculated by the system when the
                    invoice is issued.
                  </p>
                </section>
              )}

              <section className="grid gap-3 sm:grid-cols-3">
                <FormField label="Advance received" error={advanceTooHigh ? 'More than the order total' : undefined} htmlFor="o-adv">
                  <Input
                    id="o-adv"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={advance}
                    onChange={(e) => setAdvance(e.target.value)}
                    placeholder="0.00"
                  />
                </FormField>
                <FormField label="Paid by" htmlFor="o-method">
                  <Select id="o-method" value={advanceMethod} onChange={(e) => setAdvanceMethod(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="other">Other</option>
                  </Select>
                </FormField>
                <FormField label="Expected delivery" htmlFor="o-date">
                  <Input
                    id="o-date"
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                  />
                </FormField>
              </section>

              <FormField label="Notes" htmlFor="o-notes">
                <Textarea
                  id="o-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything the lab or the fitter should know"
                />
              </FormField>
            </>
          )}

          <div className="flex justify-end gap-2 border-t border-cream-200 pt-3">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Create order
            </Button>
          </div>
        </div>
      </Dialog>

      <NewCustomerDialog
        open={newCustomerOpen}
        onOpenChange={setNewCustomerOpen}
        onCreated={(c) => {
          setCustomerId(c.id)
          setCustomerSearch('')
        }}
      />
    </>
  )
}
