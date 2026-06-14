'use strict';

/**
 * RBAC permissions for agreement templates (FN-1792 / FN-1787).
 * Mirrors the structure of add_lease_financing_permissions.js.
 */
const AGREEMENT_PERMISSIONS = [
  { module: 'agreement_templates', action: 'view', code: 'agreement.templates.view', description: 'View agreement templates' },
  { module: 'agreement_templates', action: 'create', code: 'agreement.templates.create', description: 'Upload/create agreement templates' },
  { module: 'agreement_templates', action: 'edit', code: 'agreement.templates.edit', description: 'Edit agreement templates and detected fields' },
  { module: 'agreement_templates', action: 'delete', code: 'agreement.templates.delete', description: 'Delete agreement templates' },
];

const ROLE_ASSIGNMENTS = {
  super_admin: AGREEMENT_PERMISSIONS.map((p) => p.code),
  admin: AGREEMENT_PERMISSIONS.map((p) => p.code),
  company_admin: AGREEMENT_PERMISSIONS.map((p) => p.code),
  finance_manager: AGREEMENT_PERMISSIONS.map((p) => p.code),
  accounting: ['agreement.templates.view'],
  carrier_accountant: ['agreement.templates.view'],
};

exports.up = async function up(knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRoles = await knex.schema.hasTable('roles');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasPermissions || !hasRoles || !hasRolePermissions) return;

  for (const p of AGREEMENT_PERMISSIONS) {
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
  const permissionRows = await knex('permissions').whereIn('code', AGREEMENT_PERMISSIONS.map((p) => p.code)).select('id', 'code');
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
  const codes = AGREEMENT_PERMISSIONS.map((p) => p.code);
  await knex('permissions').whereIn('code', codes).delete();
};
