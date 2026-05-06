'use strict';

/**
 * FN-1424: Add the `fmcsa.imports.manage` permission and assign it to
 * platform-level admin roles. This permission gates the FMCSA import
 * control plane (manual trigger + history endpoints), which is also
 * fenced by the `is_internal` tenant flag from FN-1412.
 */

const FMCSA_IMPORTS_PERMISSIONS = [
  {
    module: 'fmcsa_imports',
    action: 'manage',
    code: 'fmcsa.imports.manage',
    description: 'Trigger FMCSA reference dataset imports and view import history',
  },
];

const ROLE_ASSIGNMENTS = {
  super_admin: ['fmcsa.imports.manage'],
  platform_admin: ['fmcsa.imports.manage'],
};

exports.up = async function up(knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRoles = await knex.schema.hasTable('roles');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasPermissions || !hasRoles || !hasRolePermissions) return;

  for (const p of FMCSA_IMPORTS_PERMISSIONS) {
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
  const permissionRows = await knex('permissions')
    .whereIn('code', FMCSA_IMPORTS_PERMISSIONS.map((p) => p.code))
    .select('id', 'code');
  const roleByCode = new Map(roles.map((r) => [r.code, r.id]));
  const permissionIdByCode = new Map(permissionRows.map((p) => [p.code, p.id]));

  for (const [roleCode, permissionCodes] of Object.entries(ROLE_ASSIGNMENTS)) {
    const roleId = roleByCode.get(roleCode);
    if (!roleId) continue;
    for (const permissionCode of permissionCodes) {
      const permissionId = permissionIdByCode.get(permissionCode);
      if (!permissionId) continue;
      const existing = await knex('role_permissions')
        .where({ role_id: roleId, permission_id: permissionId })
        .first();
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
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasPermissions) return;

  const codes = FMCSA_IMPORTS_PERMISSIONS.map((p) => p.code);
  const permissionRows = await knex('permissions').whereIn('code', codes).select('id');
  const permissionIds = permissionRows.map((r) => r.id);
  if (permissionIds.length === 0) return;

  if (hasRolePermissions) {
    await knex('role_permissions').whereIn('permission_id', permissionIds).del();
  }
  await knex('permissions').whereIn('id', permissionIds).del();
};
