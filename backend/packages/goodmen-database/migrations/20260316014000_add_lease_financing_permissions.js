'use strict';

const LEASE_PERMISSIONS = [
  { module: 'lease_financing', action: 'view', code: 'lease.financing.view', description: 'View lease-to-own agreements' },
  { module: 'lease_financing', action: 'create', code: 'lease.financing.create', description: 'Create lease-to-own agreements' },
  { module: 'lease_financing', action: 'edit', code: 'lease.financing.edit', description: 'Edit lease-to-own agreements' },
  { module: 'lease_financing', action: 'activate', code: 'lease.financing.activate', description: 'Activate lease-to-own agreements' },
  { module: 'lease_financing', action: 'terminate', code: 'lease.financing.terminate', description: 'Terminate/default lease-to-own agreements' },
  { module: 'lease_financing', action: 'payments.manage', code: 'lease.financing.payments.manage', description: 'Record/manage lease payments' },
  { module: 'lease_financing', action: 'dashboard.view', code: 'lease.financing.dashboard.view', description: 'View fleet financing dashboard' },
  { module: 'lease_financing', action: 'driver.view', code: 'lease.financing.driver.view', description: 'Driver read-only financing visibility' },
];

const ROLE_ASSIGNMENTS = {
  super_admin: LEASE_PERMISSIONS.map((p) => p.code),
  admin: LEASE_PERMISSIONS.map((p) => p.code),
  company_admin: LEASE_PERMISSIONS.map((p) => p.code),
  accounting: LEASE_PERMISSIONS.map((p) => p.code).filter((c) => c !== 'lease.financing.terminate'),
  finance_manager: LEASE_PERMISSIONS.map((p) => p.code),
  carrier_accountant: LEASE_PERMISSIONS.map((p) => p.code).filter((c) => c !== 'lease.financing.terminate'),
  owner_operator: ['lease.financing.driver.view'],
  driver: ['lease.financing.driver.view'],
};

exports.up = async function up(knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRoles = await knex.schema.hasTable('roles');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasPermissions || !hasRoles || !hasRolePermissions) return;

  for (const p of LEASE_PERMISSIONS) {
    const existing = await knex('permissions').where({ code: p.code }).first();
    if (existing) {
      await knex('permissions').where({ id: existing.id }).update({
        module: p.module,
        action: p.action,
        description: p.description,
        updated_at: knex.fn.now(),
      });
    } else {
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

  const roles = await knex('roles').select('id', 'code');
  const permissionRows = await knex('permissions').whereIn('code', LEASE_PERMISSIONS.map((p) => p.code)).select('id', 'code');
  const roleByCode = new Map(roles.map((r) => [r.code, r.id]));
  const permissionIdByCode = new Map(permissionRows.map((p) => [p.code, p.id]));

  for (const [roleCode, permissionCodes] of Object.entries(ROLE_ASSIGNMENTS)) {
    const roleId = roleByCode.get(roleCode);
    if (!roleId) continue;

    for (const permissionCode of permissionCodes) {
      const permissionId = permissionIdByCode.get(permissionCode);
      if (!permissionId) continue;

      const existing = await knex('role_permissions').where({ role_id: roleId, permission_id: permissionId }).first();
      if (!existing) {
        await knex('role_permissions').insert({
          role_id: roleId,
          permission_id: permissionId,
          created_at: knex.fn.now(),
        });
      }
    }
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('permissions'))) return;
  const codes = LEASE_PERMISSIONS.map((p) => p.code);
  await knex('permissions').whereIn('code', codes).delete();
};
