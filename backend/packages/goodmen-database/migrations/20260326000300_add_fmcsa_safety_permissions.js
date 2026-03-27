'use strict';

/**
 * Add RBAC permission codes for FMCSA Safety module
 * and assign them to key roles.
 */

const FMCSA_PERMISSIONS = [
  { module: 'fmcsa_safety', action: 'view', code: 'fmcsa_safety.view', description: 'View FMCSA safety dashboard and scores' },
  { module: 'fmcsa_safety', action: 'manage', code: 'fmcsa_safety.manage', description: 'Manage FMCSA monitored carriers' },
  { module: 'fmcsa_safety', action: 'scrape', code: 'fmcsa_safety.scrape', description: 'Trigger manual FMCSA data scrape' },
];

const ROLE_ASSIGNMENTS = {
  super_admin: FMCSA_PERMISSIONS.map((p) => p.code),
  admin: FMCSA_PERMISSIONS.map((p) => p.code),
  company_admin: FMCSA_PERMISSIONS.map((p) => p.code),
  safety_manager: FMCSA_PERMISSIONS.map((p) => p.code),
  dispatcher: ['fmcsa_safety.view'],
};

exports.up = async function up(knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRoles = await knex.schema.hasTable('roles');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasPermissions || !hasRoles || !hasRolePermissions) return;

  // Upsert permissions
  for (const p of FMCSA_PERMISSIONS) {
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
    .whereIn('code', FMCSA_PERMISSIONS.map((p) => p.code))
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
  if (!hasPermissions) return;
  const codes = FMCSA_PERMISSIONS.map((p) => p.code);
  await knex('permissions').whereIn('code', codes).delete();
};
