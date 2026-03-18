'use strict';

const SHOP_CLIENT_PERMISSIONS = [
  {
    module: 'shop_clients',
    action: 'read',
    code: 'shop_clients.read',
    description: 'View shop client records, vehicles, and financials'
  },
  {
    module: 'shop_clients',
    action: 'write',
    code: 'shop_clients.write',
    description: 'Create and update shop client records'
  }
];

const ROLE_ASSIGNMENTS = {
  admin: ['shop_clients.read', 'shop_clients.write'],
  shop_clerk: ['shop_clients.read', 'shop_clients.write'],
  accounting: ['shop_clients.read'],
  carrier_accountant: ['shop_clients.read'],
  company_accountant: ['shop_clients.read']
};

async function resolveRoleId(knex, roleCode) {
  let role = await knex('roles').where({ code: roleCode }).first('id');
  if (role) return role.id;

  role = await knex('roles')
    .whereRaw('LOWER(name) = ?', [roleCode.toLowerCase()])
    .first('id');

  return role?.id || null;
}

exports.up = async function up(knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRoles = await knex.schema.hasTable('roles');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasPermissions || !hasRoles || !hasRolePermissions) return;

  // Upsert permissions by code
  for (const p of SHOP_CLIENT_PERMISSIONS) {
    const existing = await knex('permissions').where({ code: p.code }).first('id');
    if (existing) {
      await knex('permissions')
        .where({ id: existing.id })
        .update({
          module: p.module,
          action: p.action,
          description: p.description,
          updated_at: knex.fn.now()
        });
    } else {
      await knex('permissions').insert({
        module: p.module,
        action: p.action,
        code: p.code,
        description: p.description,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }

  const permissionRows = await knex('permissions')
    .whereIn('code', SHOP_CLIENT_PERMISSIONS.map((p) => p.code))
    .select('id', 'code');
  const permissionIdByCode = new Map(permissionRows.map((p) => [p.code, p.id]));

  // Assign permission codes to target roles (idempotent)
  for (const [roleCode, permissionCodes] of Object.entries(ROLE_ASSIGNMENTS)) {
    const roleId = await resolveRoleId(knex, roleCode);
    if (!roleId) continue;

    for (const permissionCode of permissionCodes) {
      const permissionId = permissionIdByCode.get(permissionCode);
      if (!permissionId) continue;

      const existing = await knex('role_permissions')
        .where({ role_id: roleId, permission_id: permissionId })
        .first('id');

      if (!existing) {
        await knex('role_permissions').insert({
          role_id: roleId,
          permission_id: permissionId,
          created_at: knex.fn.now()
        });
      }
    }
  }
};

exports.down = async function down(knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasPermissions) return;

  const codes = SHOP_CLIENT_PERMISSIONS.map((p) => p.code);
  const permissionRows = await knex('permissions').whereIn('code', codes).select('id');

  if (hasRolePermissions && permissionRows.length) {
    await knex('role_permissions')
      .whereIn('permission_id', permissionRows.map((p) => p.id))
      .delete();
  }

  await knex('permissions').whereIn('code', codes).delete();
};
