import {
  BarChart3,
  CreditCard,
  Eye,
  FlaskConical,
  LayoutDashboard,
  MessageCircle,
  Package,
  Receipt,
  Settings,
  ShoppingBag,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { PERMS, type Permission } from '@/lib/permissions'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  permission: Permission
  /** Items marked primary appear in the mobile bottom bar (max 4 + More). */
  primary?: boolean
}

/** Main navigation (brief §5), permission-gated per role. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: PERMS.dashboardRead, primary: true },
  { to: '/customers', label: 'Customers', icon: Users, permission: PERMS.customersRead, primary: true },
  { to: '/orders', label: 'Orders', icon: ShoppingBag, permission: PERMS.ordersRead, primary: true },
  { to: '/billing', label: 'Billing', icon: Receipt, permission: PERMS.invoicesRead, primary: true },
  { to: '/prescriptions', label: 'Prescriptions', icon: Eye, permission: PERMS.prescriptionsRead },
  { to: '/products', label: 'Products', icon: Package, permission: PERMS.productsRead },
  { to: '/inventory', label: 'Inventory', icon: Warehouse, permission: PERMS.inventoryRead },
  { to: '/lab', label: 'Lab', icon: FlaskConical, permission: PERMS.labRead },
  { to: '/payments', label: 'Payments', icon: CreditCard, permission: PERMS.paymentsRead },
  { to: '/reports', label: 'Reports', icon: BarChart3, permission: PERMS.reportsRead },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, permission: PERMS.whatsappRead },
  { to: '/settings', label: 'Settings', icon: Settings, permission: PERMS.settingsManage },
]
