import { PhasePlaceholder } from '@/components/ui/phase-placeholder'

export default function ProductsPage() {
  return (
    <PhasePlaceholder
      title="Products"
      phase="Phase 5"
      ready={[
          'Products, categories, brands and suppliers tables',
          'Per-product GST rate and HSN code (never hardcoded)',
          'Made-to-order lenses excluded from stock control',
          'SKU allocation RPC',
      ]}
      next={[
          'Product list with search and category filter',
          'Add and edit product forms',
          'Product images',
          'Price and GST management',
      ]}
    />
  )
}
