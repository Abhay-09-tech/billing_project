-- ============================================================================
-- 0010 · Seed — reference data every environment needs.
-- (Business data — customers, products — is NEVER seeded here; decision: the
-- system starts empty. Demo data lives only in supabase/seed.sql for local dev.)
-- ============================================================================

set search_path = public, extensions;

-- ── Branch ──────────────────────────────────────────────────────────────────

insert into public.branches (code, name, is_default)
values ('MAIN', 'Perfect Optical Vision', true);

-- ── Roles & permissions (ARCHITECTURE.md §4.3) ──────────────────────────────

insert into public.roles (code, name, description, is_system) values
  ('admin', 'Admin', 'Full access to everything including settings, users and financial corrections.', true),
  ('staff', 'Staff', 'Day-to-day counter operations: customers, prescriptions, orders, billing.', true);

insert into public.permissions (code, module, description) values
  ('dashboard.read',        'dashboard',     'View the dashboard'),
  ('customers.read',        'customers',     'View customers'),
  ('customers.create',      'customers',     'Create customers'),
  ('customers.update',      'customers',     'Edit customers'),
  ('prescriptions.read',    'prescriptions', 'View prescriptions'),
  ('prescriptions.create',  'prescriptions', 'Add prescriptions'),
  ('prescriptions.void',    'prescriptions', 'Void an incorrect prescription'),
  ('products.read',         'products',      'View products and prices'),
  ('products.create',       'products',      'Add products'),
  ('products.manage',       'products',      'Edit products, prices, categories, brands, suppliers'),
  ('inventory.read',        'inventory',     'View stock levels and history'),
  ('inventory.adjust',      'inventory',     'Adjust stock with a reason'),
  ('orders.read',           'orders',        'View orders'),
  ('orders.create',         'orders',        'Create orders'),
  ('orders.update',         'orders',        'Edit order details'),
  ('orders.update_status',  'orders',        'Move orders through the workflow'),
  ('lab.read',              'lab',           'View lab orders'),
  ('lab.manage',            'lab',           'Manage lab orders and vendors'),
  ('invoices.read',         'billing',       'View invoices'),
  ('invoices.create',       'billing',       'Create and issue invoices'),
  ('invoices.cancel',       'billing',       'Cancel invoices / delete drafts'),
  ('payments.read',         'payments',      'View payments'),
  ('payments.create',       'payments',      'Record payments'),
  ('payments.refund',       'payments',      'Record refunds'),
  ('payments.allow_overpay','payments',      'Accept payment above the outstanding balance (advance)'),
  ('reports.read',          'reports',       'View reports'),
  ('whatsapp.read',         'whatsapp',      'View WhatsApp history and dashboard'),
  ('whatsapp.send',         'whatsapp',      'Send manual WhatsApp messages'),
  ('whatsapp.manage',       'whatsapp',      'Edit templates and automation rules'),
  ('audit.read',            'audit',         'View the audit log'),
  ('users.manage',          'settings',      'Manage users and roles'),
  ('settings.manage',       'settings',      'Change system settings'),
  ('exports.run',           'settings',      'Export data / run backups');

-- Admin: everything.
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
  from public.roles r cross join public.permissions p
 where r.code = 'admin';

-- Staff: operational set (§26 — no settings, users, financial deletion).
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
  from public.roles r cross join public.permissions p
 where r.code = 'staff'
   and p.code in (
     'dashboard.read',
     'customers.read', 'customers.create', 'customers.update',
     'prescriptions.read', 'prescriptions.create',
     'products.read',
     'inventory.read', 'inventory.adjust',
     'orders.read', 'orders.create', 'orders.update', 'orders.update_status',
     'lab.read', 'lab.manage',
     'invoices.read', 'invoices.create',
     'payments.read', 'payments.create',
     'reports.read',
     'whatsapp.read', 'whatsapp.send'
   );

-- ── Numbering & billing settings (decisions of 18 Aug 2026) ────────────────
-- Invoice: POV/26-27/00001 — 15 chars, FY series (CGST Rule 46(b) ≤16 chars).

insert into public.settings (key, value) values
  ('shop.profile', jsonb_build_object(
     'name',    'Perfect Optical Vision',
     'address', '',
     'phone',   '',
     'whatsapp','',
     'email',   '',
     'gstin',   '',
     'state_code', '',
     'logo_path', null)),
  ('billing.gst', jsonb_build_object(
     'registration', 'regular',
     'tax_inclusive', true,
     'default_gst_rate', 12)),
  ('numbering.invoice',  jsonb_build_object('prefix','POV','pattern','{prefix}/{fy}/{seq}','pad',5,'reset','fy')),
  ('numbering.customer', jsonb_build_object('prefix','POV-C','pattern','{prefix}{seq}','pad',6,'reset','never')),
  ('numbering.order',    jsonb_build_object('prefix','POV-O','pattern','{prefix}{seq}','pad',6,'reset','never')),
  ('numbering.payment',  jsonb_build_object('prefix','POV-R','pattern','{prefix}{seq}','pad',6,'reset','never')),
  ('numbering.product',  jsonb_build_object('prefix','POV-P','pattern','{prefix}{seq}','pad',6,'reset','never')),
  ('numbering.credit_note', jsonb_build_object('prefix','POV-CN','pattern','{prefix}/{fy}/{seq}','pad',4,'reset','fy')),
  ('notifications.low_stock', jsonb_build_object('enabled', true)),
  ('whatsapp.provider', jsonb_build_object(
     'provider', 'meta_cloud',
     'phone_number_display', '',
     'enabled', false));

-- ── Product categories (§12) ────────────────────────────────────────────────

insert into public.product_categories (code, name, kind, sort_order) values
  ('frames',         'Frames',                'stocked',       10),
  ('sunglasses',     'Sunglasses',            'stocked',       20),
  ('lenses',         'Spectacle Lenses',      'made_to_order', 30),
  ('contact_lenses', 'Contact Lenses',        'stocked',       40),
  ('accessories',    'Accessories',           'stocked',       50),
  ('services',       'Services & Repairs',    'service',       60),
  ('other',          'Other Optical Products','stocked',       70);

-- ── WhatsApp templates (§21) — bodies use ordinal {{n}} placeholders as the
--    Cloud API requires; variable_map documents what each ordinal means. ─────

insert into public.whatsapp_templates
  (code, name, provider_template_name, category, body_text, variable_map, approval_status) values
  ('order_confirmation', 'Order Confirmation', 'pov_order_confirmation', 'utility',
   'Hello {{1}}, your order {{2}} has been successfully placed at Perfect Optical Vision. Total amount: ₹{{3}}.',
   '["customer_name","order_number","total_amount"]', 'draft'),
  ('order_ready', 'Order Ready', 'pov_order_ready', 'utility',
   'Hello {{1}}, your spectacles for order {{2}} are ready for pickup at Perfect Optical Vision.',
   '["customer_name","order_number"]', 'draft'),
  ('payment_reminder', 'Payment Reminder', 'pov_payment_reminder', 'utility',
   'Hello {{1}}, your pending balance for invoice {{2}} is ₹{{3}}.',
   '["customer_name","invoice_number","balance"]', 'draft'),
  ('delivery_confirmation', 'Delivery Confirmation', 'pov_delivery_confirmation', 'utility',
   'Thank you for choosing Perfect Optical Vision, {{1}}. Your order {{2}} has been delivered successfully.',
   '["customer_name","order_number"]', 'draft'),
  ('review_request', 'Review Request', 'pov_review_request', 'marketing',
   'Thank you for visiting Perfect Optical Vision, {{1}}. We hope you are happy with your new spectacles. We would appreciate your feedback.',
   '["customer_name"]', 'draft');

-- ── Automation rules (§22) — disabled until the provider is connected. ─────

insert into public.whatsapp_automation_rules (event_key, template_id, delay_minutes, is_enabled)
select 'order.created',      id, 0,    false from public.whatsapp_templates where code = 'order_confirmation'
union all
select 'order.status.ready', id, 0,    false from public.whatsapp_templates where code = 'order_ready'
union all
select 'order.delivered',    id, 0,    false from public.whatsapp_templates where code = 'delivery_confirmation'
union all
select 'order.delivered',    id, 2880, false from public.whatsapp_templates where code = 'review_request'   -- +2 days
union all
select 'invoice.overdue',    id, 0,    false from public.whatsapp_templates where code = 'payment_reminder';
