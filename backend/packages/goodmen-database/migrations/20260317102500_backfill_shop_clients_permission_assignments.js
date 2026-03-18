'use strict';

const ASSIGNMENTS = {
  // Requested roles
  admin: ['shop_clients.read', 'shop_clients.write'],
  shop_clerk: ['shop_clients.read', 'shop_clients.write'],
  accounting: ['shop_clients.read'],

  // Common aliases used in this codebase
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

  const codes = ['shop_clients.read', 'shop_clients.write'];
  const permissionRows = await knex('permissions').whereIn('code', codes).select('id', 'code');
  if (!permissionRows.length) return;

  const permissionIdByCode = new Map(permissionRows.map((p) => [p.code, p.id]));

  for (const [roleCode, permissionCodes] of Object.entries(ASSIGNMENTS)) {
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
  // No-op by design: this migration only backfills missing assignments.
};
