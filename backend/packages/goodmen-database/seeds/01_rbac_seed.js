'use strict';

/**
 * RBAC seed: divisions, roles, permissions, role_permissions, and default locations (with code/type).
 * Idempotent: skips existing by code/unique keys.
 */

const ROLES = [
  { code: 'super_admin', name: 'Super Admin', description: 'Full system access, all locations' },
  { code: 'executive_read_only', name: 'Executive Read Only', description: 'View dashboards and reports only' },
  { code: 'dispatch_manager', name: 'Dispatch Manager', description: 'Manage loads, dispatch, brokers; view drivers/vehicles' },
  { code: 'dispatcher', name: 'Dispatcher', description: 'View/create/edit loads, assign drivers/trucks' },
  { code: 'safety_manager', name: 'Safety Manager', description: 'Drivers, DQF, safety, compliance' },
  { code: 'carrier_accountant', name: 'Carrier Accountant', description: 'Invoices, settlements, accounting, reports' },
  { code: 'shop_manager', name: 'Shop Manager', description: 'Work orders, invoices view/bill, parts request; location-scoped' },
  { code: 'service_writer', name: 'Service Writer', description: 'Work orders, invoices, parts usage; location-scoped' },
  { code: 'mechanic', name: 'Mechanic', description: 'Work orders labor/parts; no invoice finalization' },
  { code: 'parts_manager', name: 'Parts Manager', description: 'Parts, inventory receive/adjust/transfer, vendors, POs' },
  { code: 'parts_clerk', name: 'Parts Clerk', description: 'Receive, transfers, customer parts sales' },
  { code: 'inventory_auditor', name: 'Inventory Auditor', description: 'View inventory and cycle counts only' },
  { code: 'company_accountant', name: 'Company Accountant', description: 'Accounting across divisions' },
  { code: 'driver', name: 'Driver', description: 'Portal: own profile, documents, assigned loads (future)' },
  { code: 'customer', name: 'Customer', description: 'Portal: own invoices, work orders, estimates (future)' }
];

const MODULES = [
  'dashboard', 'users', 'roles', 'loads', 'load_documents', 'dispatch', 'brokers', 'drivers', 'dqf', 'safety',
  'vehicles', 'trailers', 'work_orders', 'invoices', 'parts', 'inventory', 'inventory_transfers', 'purchase_orders',
  'vendors', 'customers', 'accounting', 'settlements', 'reports', 'locations'
];
const ACTIONS = ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'receive', 'transfer', 'adjust', 'bill', 'export', 'manage'];

function buildPermissions() {
  const list = [];
  for (const mod of MODULES) {
    for (const action of ACTIONS) {
      list.push({ module: mod, action, code: `${mod}.${action}`, description: `${mod} ${action}` });
    }
  }
  return list;
}

const ROLE_PERMISSIONS = {
  super_admin: null, // null = all permissions
  executive_read_only: ['dashboard.view', 'reports.view', 'loads.view', 'drivers.view', 'vehicles.view', 'work_orders.view', 'invoices.view', 'inventory.view', 'customers.view', 'locations.view'],
  dispatch_manager: ['dashboard.view', 'loads.view', 'loads.create', 'loads.edit', 'loads.assign', 'load_documents.view', 'dispatch.view', 'dispatch.manage', 'brokers.view', 'brokers.manage', 'drivers.view', 'vehicles.view', 'trailers.view', 'reports.view', 'reports.export'],
  dispatcher: ['dashboard.view', 'loads.view', 'loads.create', 'loads.edit', 'loads.assign', 'load_documents.view', 'load_documents.create', 'brokers.view', 'drivers.view', 'vehicles.view', 'trailers.view'],
  safety_manager: ['dashboard.view', 'drivers.view', 'drivers.edit', 'dqf.manage', 'safety.manage', 'vehicles.view', 'reports.view'],
  carrier_accountant: ['dashboard.view', 'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.bill', 'accounting.view', 'accounting.manage', 'settlements.view', 'settlements.create', 'settlements.edit', 'settlements.approve', 'settlements.manage', 'reports.view', 'reports.export'],
  shop_manager: ['dashboard.view', 'work_orders.view', 'work_orders.manage', 'invoices.view', 'invoices.bill', 'parts.view', 'locations.view'],
  service_writer: ['dashboard.view', 'work_orders.view', 'work_orders.create', 'work_orders.edit', 'invoices.view', 'invoices.create', 'invoices.edit', 'parts.view', 'parts.receive'],
  mechanic: ['dashboard.view', 'work_orders.view', 'work_orders.edit', 'parts.view', 'parts.receive'],
  parts_manager: ['dashboard.view', 'parts.view', 'parts.create', 'parts.edit', 'parts.manage', 'inventory.view', 'inventory.receive', 'inventory.adjust', 'inventory.transfer', 'inventory_transfers.view', 'inventory_transfers.manage', 'purchase_orders.view', 'purchase_orders.manage', 'vendors.view', 'vendors.manage', 'locations.view'],
  parts_clerk: ['dashboard.view', 'parts.view', 'inventory.view', 'inventory.receive', 'inventory_transfers.view', 'inventory_transfers.manage', 'customers.view', 'locations.view'],
  inventory_auditor: ['dashboard.view', 'inventory.view', 'reports.view', 'locations.view'],
  company_accountant: ['dashboard.view', 'invoices.view', 'accounting.view', 'accounting.manage', 'reports.view', 'reports.export', 'locations.view'],
  driver: ['dashboard.view'],
  customer: []
};

const DIVISIONS = [
  { code: 'carrier', name: 'Carrier Authority / Fleet' },
  { code: 'shop', name: 'Shop Operations' },
  { code: 'parts', name: 'Parts / Warehouse' }
];

const DEFAULT_LOCATIONS = [
  { code: 'garland-hairu', name: 'Garland Shop - Hairu', location_type: 'shop' },
  { code: 'garland-julio', name: 'Garland Shop - Julio', location_type: 'shop' },
  { code: 'garland-juan', name: 'Garland Shop - Juan', location_type: 'shop' },
  { code: 'rockwall', name: 'Rockwall Shop', location_type: 'shop' },
  { code: 'hutchins', name: 'Hutchins Shop', location_type: 'shop' },
  { code: 'garland-main-warehouse', name: 'Garland Main Parts Warehouse', location_type: 'warehouse' },
  { code: 'main-office', name: 'Carrier Authority / Main Office', location_type: 'office' }
];

exports.seed = async function (knex) {
  const hasRoles = await knex.schema.hasTable('roles');
  if (!hasRoles) return;

  // Divisions
  for (const d of DIVISIONS) {
    const exists = await knex('divisions').where({ code: d.code }).first();
    if (!exists) await knex('divisions').insert({ ...d, created_at: knex.fn.now(), updated_at: knex.fn.now() });
  }

  // Roles
  for (const r of ROLES) {
    const exists = await knex('roles').where({ code: r.code }).first();
    if (!exists) await knex('roles').insert({ ...r, created_at: knex.fn.now(), updated_at: knex.fn.now() });
  }

  // Permissions (full grid)
  const permissions = buildPermissions();
  for (const p of permissions) {
    const exists = await knex('permissions').where({ code: p.code }).first();
    if (!exists) await knex('permissions').insert({ ...p, created_at: knex.fn.now(), updated_at: knex.fn.now() });
  }

  // role_permissions
  const allPerms = await knex('permissions').select('id', 'code');
  const permByCode = new Map(allPerms.map((x) => [x.code, x.id]));
  const roles = await knex('roles').select('id', 'code');

  for (const roleRow of roles) {
    const codes = ROLE_PERMISSIONS[roleRow.code];
    if (codes === undefined) continue;
    const existing = await knex('role_permissions').where({ role_id: roleRow.id }).select('permission_id');
    const existingSet = new Set(existing.map((r) => r.permission_id));

    if (codes === null) {
      // super_admin: assign all permissions
      for (const p of allPerms) {
        if (existingSet.has(p.id)) continue;
        await knex('role_permissions').insert({ role_id: roleRow.id, permission_id: p.id });
      }
      continue;
    }
    for (const code of codes) {
      const pid = permByCode.get(code);
      if (!pid || existingSet.has(pid)) continue;
      await knex('role_permissions').insert({ role_id: roleRow.id, permission_id: pid });
      existingSet.add(pid);
    }
  }

  // Locations: ensure columns exist and upsert default locations by code
  const hasLocations = await knex.schema.hasTable('locations');
  if (!hasLocations) return;
  const hasCode = await knex.schema.hasColumn('locations', 'code');
  if (!hasCode) return;

  for (const loc of DEFAULT_LOCATIONS) {
    const existing = await knex('locations').where({ code: loc.code }).first();
    if (existing) {
      await knex('locations').where({ id: existing.id }).update({
        name: loc.name,
        location_type: loc.location_type,
        active: true,
        updated_at: knex.fn.now()
      });
    } else {
      const byName = await knex('locations').whereRaw('LOWER(TRIM(name)) = ?', [loc.name.toLowerCase().trim()]).first();
      if (byName) {
        await knex('locations').where({ id: byName.id }).update({
          code: loc.code,
          location_type: loc.location_type,
          active: true,
          updated_at: knex.fn.now()
        });
      } else {
        await knex('locations').insert({
          code: loc.code,
          name: loc.name,
          location_type: loc.location_type,
          active: true,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now()
        });
      }
    }
  }
};
