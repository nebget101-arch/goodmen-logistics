'use strict';

/**
 * RBAC Phase 2: Add shop_clerk role and new granular permission codes.
 *
 * Strategy (additive only):
 *  - No existing roles, permissions, role_permissions, or tables removed or renamed.
 *  - New permission codes follow the established module.action dot notation used throughout.
 *  - shop_clerk role is new; existing shop_manager, service_writer, and mechanic roles unaffected.
 *  - Permission → role assignments are handled in seed file 06_shop_clerk_seed.js.
 *
 * New codes added (none already exist in the full module×action grid from 01_rbac_seed):
 *   work_orders.close          — manager-only: close a completed work order
 *   work_order_lines.*         — line-item-level permissions (new module)
 *   estimates.*                — estimate lifecycle (new module)
 *   appointments.*             — scheduling (new module)
 *   invoices.post              — post/finalize a draft invoice (manager-only)
 *   invoices.void              — void a posted invoice (manager-only)
 *   payments.*                 — payment recording (new module)
 *   documents.*                — document upload/view (new module)
 *   discounts.*                — discount approval (new module)
 *   reports.shop               — shop-level report (new action on reports module)
 */
const NEW_PERMISSIONS = [
  // Work order lifecycle — "close" is not in the existing ACTIONS grid
  { module: 'work_orders',      action: 'close',   code: 'work_orders.close',        description: 'Close a completed work order (manager only)' },

  // Work order lines (line-item level) — "work_order_lines" not in existing MODULES
  { module: 'work_order_lines', action: 'view',    code: 'work_order_lines.view',    description: 'View work order line items' },
  { module: 'work_order_lines', action: 'create',  code: 'work_order_lines.create',  description: 'Add line items to a work order' },
  { module: 'work_order_lines', action: 'edit',    code: 'work_order_lines.edit',    description: 'Edit work order line items' },
  { module: 'work_order_lines', action: 'delete',  code: 'work_order_lines.delete',  description: 'Remove line items from a work order (manager only)' },

  // Estimates — "estimates" not in existing MODULES
  { module: 'estimates', action: 'view',    code: 'estimates.view',    description: 'View estimates' },
  { module: 'estimates', action: 'create',  code: 'estimates.create',  description: 'Create new estimates' },
  { module: 'estimates', action: 'edit',    code: 'estimates.edit',    description: 'Edit draft estimates' },
  { module: 'estimates', action: 'convert', code: 'estimates.convert', description: 'Convert an approved estimate to a work order or invoice' },
  { module: 'estimates', action: 'approve', code: 'estimates.approve', description: 'Approve an estimate (manager only)' },
  { module: 'estimates', action: 'delete',  code: 'estimates.delete',  description: 'Delete estimates (manager only)' },

  // Appointments — "appointments" not in existing MODULES
  { module: 'appointments', action: 'view',   code: 'appointments.view',   description: 'View service appointments' },
  { module: 'appointments', action: 'create', code: 'appointments.create', description: 'Create new service appointments' },
  { module: 'appointments', action: 'edit',   code: 'appointments.edit',   description: 'Update service appointments' },
  { module: 'appointments', action: 'delete', code: 'appointments.delete', description: 'Cancel or delete appointments' },

  // Invoice finalization — "post" and "void" are not in the existing ACTIONS grid
  { module: 'invoices', action: 'post', code: 'invoices.post', description: 'Post/finalize a draft invoice (manager only)' },
  { module: 'invoices', action: 'void', code: 'invoices.void', description: 'Void a posted invoice (manager only)' },

  // Payments — "payments" not in existing MODULES
  { module: 'payments', action: 'view',   code: 'payments.view',   description: 'View payment records on invoices' },
  { module: 'payments', action: 'create', code: 'payments.create', description: 'Record a payment on an invoice' },
  { module: 'payments', action: 'refund', code: 'payments.refund', description: 'Refund or reverse a payment (manager only)' },
  { module: 'payments', action: 'delete', code: 'payments.delete', description: 'Delete a payment record (manager only)' },

  // Documents — "documents" not in existing MODULES; "upload" not in existing ACTIONS
  { module: 'documents', action: 'view',   code: 'documents.view',   description: 'View uploaded documents' },
  { module: 'documents', action: 'upload', code: 'documents.upload', description: 'Upload new documents' },
  { module: 'documents', action: 'delete', code: 'documents.delete', description: 'Delete uploaded documents (manager only)' },

  // Discounts — "discounts" not in existing MODULES
  { module: 'discounts', action: 'view',    code: 'discounts.view',    description: 'View discount rules and applied overrides' },
  { module: 'discounts', action: 'approve', code: 'discounts.approve', description: 'Approve or apply large discounts (manager only)' },

  // Shop-level reports — "shop" not in existing ACTIONS
  { module: 'reports', action: 'shop', code: 'reports.shop', description: 'View shop performance and revenue reports (manager only)' },
];

exports.up = async function (knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  if (!hasPermissions) {
    console.warn('[migration 20260314200000] permissions table not found — skipping.');
    return;
  }

  // Add new permission codes (idempotent: skip if code already exists)
  for (const p of NEW_PERMISSIONS) {
    const exists = await knex('permissions').where({ code: p.code }).first();
    if (!exists) {
      await knex('permissions').insert({
        module: p.module,
        action: p.action,
        code: p.code,
        description: p.description,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    }
  }

  // Add shop_clerk role (idempotent)
  const hasRoles = await knex.schema.hasTable('roles');
  if (!hasRoles) return;

  const shopClerkExists = await knex('roles').where({ code: 'shop_clerk' }).first();
  if (!shopClerkExists) {
    await knex('roles').insert({
      code: 'shop_clerk',
      name: 'Shop Clerk',
      description:
        'Operational shop access: customers, vehicles, appointments, work orders (draft), ' +
        'estimates, draft invoices, payments (create/view), and documents. ' +
        'Cannot post or void invoices, adjust inventory, approve discounts, refund payments, ' +
        'access payroll/settlements, or manage users/roles.',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }
};

exports.down = async function (knex) {
  // Remove only the newly added role and new permission codes.
  // Does NOT touch any existing roles, permissions, or role_permissions rows.

  const hasRoles = await knex.schema.hasTable('roles');
  if (hasRoles) {
    // Cascade on role_permissions FK removes role_permissions rows automatically.
    await knex('roles').where({ code: 'shop_clerk' }).delete();
  }

  const hasPermissions = await knex.schema.hasTable('permissions');
  if (!hasPermissions) return;

  const newCodes = NEW_PERMISSIONS.map((p) => p.code);
  await knex('permissions').whereIn('code', newCodes).delete();
};
