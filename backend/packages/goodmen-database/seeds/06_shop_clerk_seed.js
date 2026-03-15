'use strict';

/**
 * Seed 06: shop_clerk role-permission assignments + new manager permissions.
 *
 * Strategy (additive only):
 *  - Idempotent: skips existing role_permissions rows.
 *  - Does NOT remove any existing role-permission assignments.
 *  - Depends on migration 20260314200000_add_shop_clerk_permissions having run first.
 *  - If a permission code doesn't exist yet (migration not run), that code is silently skipped.
 *  - Existing role mappings for super_admin, dispatcher, carrier_accountant etc. are untouched.
 */

/**
 * shop_clerk: operational create/view/edit for shop entities.
 *
 * Explicitly EXCLUDES:
 *   users.*, roles.*, settlements.*, accounting.*
 *   inventory.adjust, inventory.transfer
 *   invoices.post, invoices.void, invoices.bill
 *   work_orders.approve, work_orders.close
 *   payments.refund, payments.delete
 *   discounts.approve
 *   reports.shop
 *   documents.delete, work_order_lines.delete, estimates.approve, estimates.delete
 *
 * Note: vehicles.create, customers.create, work_orders.assign, work_orders.approve
 *       already exist in the permissions grid from 01_rbac_seed.js.
 */
const SHOP_CLERK_PERMISSIONS = [
  // Dashboard
  'dashboard.view',

  // Customers
  'customers.view',
  'customers.create',
  'customers.edit',

  // Vehicles
  'vehicles.view',
  'vehicles.create',
  'vehicles.edit',

  // Appointments (new codes from migration 20260314200000)
  'appointments.view',
  'appointments.create',
  'appointments.edit',

  // Work Orders
  'work_orders.view',
  'work_orders.create',
  'work_orders.edit',
  'work_orders.assign',

  // Work Order Lines (new codes)
  'work_order_lines.view',
  'work_order_lines.create',
  'work_order_lines.edit',

  // Estimates (new codes)
  'estimates.view',
  'estimates.create',
  'estimates.edit',
  'estimates.convert',

  // Invoices — draft CRUD only; post/void/bill are manager-only
  'invoices.view',
  'invoices.create',
  'invoices.edit',

  // Payments — create and view only; no refund
  'payments.view',
  'payments.create',

  // Inventory — view only
  'inventory.view',

  // Parts — view only
  'parts.view',

  // Documents (new codes)
  'documents.view',
  'documents.upload',

  // Discounts — view rules only; no approval
  'discounts.view',
];

/**
 * shop_manager: superset of shop_clerk plus all finalization/management permissions.
 * Applied on top of what 01_rbac_seed.js already assigns to shop_manager.
 */
const SHOP_MANAGER_ADDITIONAL_PERMISSIONS = [
  // All shop_clerk permissions (additive, idempotent)
  ...SHOP_CLERK_PERMISSIONS,

  // Manager-only finalization
  'work_orders.approve',
  'work_orders.close',
  'invoices.post',
  'invoices.void',
  'invoices.bill',

  // Payment management
  'payments.refund',
  'payments.delete',

  // Discount approval
  'discounts.approve',

  // Shop reporting
  'reports.shop',

  // Estimate management
  'estimates.approve',

  // Document management
  'documents.delete',

  // Work order line management
  'work_order_lines.delete',

  // Appointment cancellation
  'appointments.delete',

  // Inventory (existing; already in shop_manager via 01_rbac_seed, this is additive)
  'inventory.view',
  'inventory.receive',
  'inventory.adjust',
  'inventory.transfer',
];

/**
 * technician: assigned-work access — labor, inspection, parts usage.
 * No financial finalization; no customer PII editing.
 */
const TECHNICIAN_PERMISSIONS = [
  'dashboard.view',
  'work_orders.view',
  'work_orders.edit',
  'work_order_lines.view',
  'work_order_lines.create',
  'work_order_lines.edit',
  'parts.view',
  'parts.receive',
  'documents.view',
  'documents.upload',
  'appointments.view',
  'vehicles.view',
  'customers.view',
  'inventory.view',
];

/**
 * parts_manager: inventory, purchasing, and vendor management.
 * No customer/invoice CRUD; no user management.
 */
const PARTS_MANAGER_PERMISSIONS = [
  'dashboard.view',
  'parts.view',
  'parts.create',
  'parts.edit',
  'parts.manage',
  'inventory.view',
  'inventory.receive',
  'inventory.adjust',
  'inventory.transfer',
  'inventory_transfers.view',
  'inventory_transfers.manage',
  'purchase_orders.view',
  'purchase_orders.manage',
  'vendors.view',
  'vendors.manage',
  'locations.view',
  'documents.view',
  'documents.upload',
  'reports.shop',
];

/**
 * Idempotent helper: assigns permission codes to a role.
 * Skips missing permissions (handles partial migration state gracefully).
 */
async function assignPermissions(knex, roleCode, permissionCodes) {
  const roleRow = await knex('roles').where({ code: roleCode }).first();
  if (!roleRow) {
    console.warn(`[seed 06] role '${roleCode}' not found — skipping.`);
    return;
  }

  const allPerms = await knex('permissions').select('id', 'code');
  const permByCode = new Map(allPerms.map((p) => [p.code, p.id]));

  const existing = await knex('role_permissions').where({ role_id: roleRow.id }).select('permission_id');
  const existingSet = new Set(existing.map((r) => r.permission_id));

  const uniqueCodes = [...new Set(permissionCodes)];
  let added = 0;
  for (const code of uniqueCodes) {
    const permId = permByCode.get(code);
    if (!permId) continue; // Permission code doesn't exist yet — skip silently
    if (existingSet.has(permId)) continue; // Already assigned
    await knex('role_permissions').insert({ role_id: roleRow.id, permission_id: permId });
    existingSet.add(permId);
    added++;
  }

  console.log(`[seed 06] '${roleCode}': +${added} permissions assigned.`);
}

exports.seed = async function (knex) {
  const [hasRoles, hasPermissions, hasRolePerms] = await Promise.all([
    knex.schema.hasTable('roles'),
    knex.schema.hasTable('permissions'),
    knex.schema.hasTable('role_permissions'),
  ]);

  if (!hasRoles || !hasPermissions || !hasRolePerms) {
    console.warn('[seed 06] RBAC tables not ready — skipping. Run migrations first.');
    return;
  }

  await assignPermissions(knex, 'shop_clerk',    SHOP_CLERK_PERMISSIONS);
  await assignPermissions(knex, 'shop_manager',   SHOP_MANAGER_ADDITIONAL_PERMISSIONS);
  await assignPermissions(knex, 'technician',     TECHNICIAN_PERMISSIONS);
  await assignPermissions(knex, 'parts_manager',  PARTS_MANAGER_PERMISSIONS);

  console.log('[seed 06] shop_clerk_seed: done.');
};
