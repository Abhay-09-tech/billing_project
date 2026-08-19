import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { AppShell } from './AppShell'
import { LoginPage } from '@/features/auth/LoginPage'
import { LoadingState } from '@/components/ui/layout'
import type { Permission } from '@/lib/permissions'
import { PERMS } from '@/lib/permissions'

// Route-level code splitting (brief §36): each module loads on first visit.
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const CustomersPage = lazy(() => import('@/features/customers/CustomersPage'))
const CustomerProfilePage = lazy(() => import('@/features/customers/CustomerProfilePage'))
const OrdersPage = lazy(() => import('@/features/orders/OrdersPage'))
const OrderDetailPage = lazy(() => import('@/features/orders/OrderDetailPage'))
const BillingPage = lazy(() => import('@/features/billing/BillingPage'))
const InvoiceDetailPage = lazy(() => import('@/features/billing/InvoiceDetailPage'))
const PrescriptionsPage = lazy(() => import('@/features/prescriptions/PrescriptionsPage'))
const ProductsPage = lazy(() => import('@/features/products/ProductsPage'))
const InventoryPage = lazy(() => import('@/features/inventory/InventoryPage'))
const LabPage = lazy(() => import('@/features/lab/LabPage'))
const PaymentsPage = lazy(() => import('@/features/payments/PaymentsPage'))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'))
const WhatsAppPage = lazy(() => import('@/features/whatsapp/WhatsAppPage'))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'))

function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth()
  if (!can(permission)) return <Navigate to="/" replace />
  return <>{children}</>
}

export function App() {
  const { status } = useAuth()

  if (status === 'loading') return <LoadingState label="Starting up…" />
  if (status === 'signed_out') return <LoginPage />

  return (
    // basename keeps routing correct when the app is served from a
    // sub-path, e.g. GitHub Pages at /billing_project/.
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            path="/"
            element={
              <Suspense fallback={<LoadingState />}>
                <DashboardPage />
              </Suspense>
            }
          />
          {(
            [
              ['/customers', PERMS.customersRead, CustomersPage],
              ['/customers/:id', PERMS.customersRead, CustomerProfilePage],
              ['/orders', PERMS.ordersRead, OrdersPage],
              ['/orders/:id', PERMS.ordersRead, OrderDetailPage],
              ['/billing', PERMS.invoicesRead, BillingPage],
              ['/billing/:id', PERMS.invoicesRead, InvoiceDetailPage],
              ['/prescriptions', PERMS.prescriptionsRead, PrescriptionsPage],
              ['/products', PERMS.productsRead, ProductsPage],
              ['/inventory', PERMS.inventoryRead, InventoryPage],
              ['/lab', PERMS.labRead, LabPage],
              ['/payments', PERMS.paymentsRead, PaymentsPage],
              ['/reports', PERMS.reportsRead, ReportsPage],
              ['/whatsapp', PERMS.whatsappRead, WhatsAppPage],
              ['/settings', PERMS.settingsManage, SettingsPage],
            ] as const
          ).map(([path, permission, Component]) => (
            <Route
              key={path}
              path={path}
              element={
                <Guard permission={permission}>
                  <Suspense fallback={<LoadingState />}>
                    <Component />
                  </Suspense>
                </Guard>
              }
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
