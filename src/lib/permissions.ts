/**
 * Permission codes — mirrors the `permissions` seed. UI gating only;
 * RLS + RPC checks in Postgres are the real boundary.
 */
export const PERMS = {
  dashboardRead: 'dashboard.read',
  customersRead: 'customers.read',
  customersCreate: 'customers.create',
  customersUpdate: 'customers.update',
  prescriptionsRead: 'prescriptions.read',
  prescriptionsCreate: 'prescriptions.create',
  prescriptionsVoid: 'prescriptions.void',
  productsRead: 'products.read',
  productsCreate: 'products.create',
  productsManage: 'products.manage',
  inventoryRead: 'inventory.read',
  inventoryAdjust: 'inventory.adjust',
  ordersRead: 'orders.read',
  ordersCreate: 'orders.create',
  ordersUpdate: 'orders.update',
  ordersUpdateStatus: 'orders.update_status',
  labRead: 'lab.read',
  labManage: 'lab.manage',
  invoicesRead: 'invoices.read',
  invoicesCreate: 'invoices.create',
  invoicesCancel: 'invoices.cancel',
  paymentsRead: 'payments.read',
  paymentsCreate: 'payments.create',
  paymentsRefund: 'payments.refund',
  paymentsAllowOverpay: 'payments.allow_overpay',
  reportsRead: 'reports.read',
  whatsappRead: 'whatsapp.read',
  whatsappSend: 'whatsapp.send',
  whatsappManage: 'whatsapp.manage',
  auditRead: 'audit.read',
  usersManage: 'users.manage',
  settingsManage: 'settings.manage',
  exportsRun: 'exports.run',
} as const

export type Permission = (typeof PERMS)[keyof typeof PERMS]
