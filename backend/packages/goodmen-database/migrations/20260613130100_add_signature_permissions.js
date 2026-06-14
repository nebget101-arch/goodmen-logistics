'use strict';

/**
 * RBAC permissions for e-signature requests (FN-1796 / FN-1788).
 * Mirrors the structure of add_agreement_permissions.js.
 *
 * Public signer routes are token-gated (no RBAC); these grants cover the
 * internal-facing send/manage/void actions on signature requests.
 */
const SIGNATURE_PERMISSIONS = [
  { module: 'agreement_signatures', action: 'view', code: 'agreement.signatures.view', description: 'View e-signature requests and their status' },
  { module: 'agreement_signatures', action: 'create', code: 'agreement.signatures.create', description: 'Create and send e-signature requests' },
  { module: 'agreement_signatures', action: 'void', code: 'agreement.signatures.void', description: 'Void / cancel e-signature requests' },
];

const ROLE_ASSIGNMENTS = {
  super_admin: SIGNATURE_PERMISSIONS.map((p) => p.code),
  admin: SIGNATURE_PERMISSIONS.map((p) => p.code),
  company_admin: SIGNATURE_PERMISSIONS.map((p) => p.code),
  finance_manager: SIGNATURE_PERMISSIONS.map((p) => p.code),
  accounting: ['agreement.signatures.view'],
  carrier_accountant: ['agreement.signatures.view'],
};

exports.up = async function up(knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRoles = await knex.schema.hasTable('roles');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasPermissions || !hasRoles || !hasRolePermissions) return;

  for (const p of SIGNATURE_PERMISSIONS) {
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
  const permissionRows = await knex('permissions').whereIn('code', SIGNATURE_PERMISSIONS.map((p) => p.code)).select('id', 'code');
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
  const codes = SIGNATURE_PERMISSIONS.map((p) => p.code);
  await knex('permissions').whereIn('code', codes).delete();
};
