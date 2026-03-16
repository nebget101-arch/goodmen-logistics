'use strict';

const IFTA_PERMISSIONS = [
  { module: 'ifta', action: 'view', code: 'ifta.view', description: 'View IFTA quarter filings and reports' },
  { module: 'ifta', action: 'edit', code: 'ifta.edit', description: 'Create and edit IFTA quarter data' },
  { module: 'ifta', action: 'import', code: 'ifta.import', description: 'Import IFTA miles and fuel CSV files' },
  { module: 'ifta', action: 'run_ai_review', code: 'ifta.run_ai_review', description: 'Run AI review for IFTA filing readiness' },
  { module: 'ifta', action: 'finalize', code: 'ifta.finalize', description: 'Finalize IFTA quarter filing' },
  { module: 'ifta', action: 'export', code: 'ifta.export', description: 'Export IFTA filing reports and payloads' },
];

const ROLE_ASSIGNMENTS = {
  super_admin: IFTA_PERMISSIONS.map((p) => p.code),
  admin: IFTA_PERMISSIONS.map((p) => p.code),
  company_admin: IFTA_PERMISSIONS.map((p) => p.code),
  accounting: IFTA_PERMISSIONS.map((p) => p.code),
  carrier_accountant: IFTA_PERMISSIONS.map((p) => p.code),
  finance_manager: IFTA_PERMISSIONS.map((p) => p.code),
  safety_manager: ['ifta.view'],
  dispatcher: ['ifta.view'],
};

exports.up = async function up(knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRoles = await knex.schema.hasTable('roles');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasPermissions || !hasRoles || !hasRolePermissions) return;

  for (const p of IFTA_PERMISSIONS) {
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
  const permissionRows = await knex('permissions').whereIn('code', IFTA_PERMISSIONS.map((p) => p.code)).select('id', 'code');
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
  const codes = IFTA_PERMISSIONS.map((p) => p.code);
  await knex('permissions').whereIn('code', codes).delete();
};
