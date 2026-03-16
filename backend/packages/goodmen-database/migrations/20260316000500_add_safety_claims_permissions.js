'use strict';

/**
 * Add RBAC permission codes for Safety Claims & Accidents module
 * and assign them to key roles.
 */

const SAFETY_PERMISSIONS = [
  { module: 'safety', action: 'incidents.view', code: 'safety.incidents.view', description: 'View safety incidents' },
  { module: 'safety', action: 'incidents.create', code: 'safety.incidents.create', description: 'Create safety incidents' },
  { module: 'safety', action: 'incidents.edit', code: 'safety.incidents.edit', description: 'Edit safety incidents' },
  { module: 'safety', action: 'incidents.close', code: 'safety.incidents.close', description: 'Close safety incidents' },
  { module: 'safety', action: 'claims.view', code: 'safety.claims.view', description: 'View safety claims' },
  { module: 'safety', action: 'claims.create', code: 'safety.claims.create', description: 'Create safety claims' },
  { module: 'safety', action: 'claims.edit', code: 'safety.claims.edit', description: 'Edit safety claims' },
  { module: 'safety', action: 'claims.financials.view', code: 'safety.claims.financials.view', description: 'View safety claim financials' },
  { module: 'safety', action: 'claims.financials.edit', code: 'safety.claims.financials.edit', description: 'Edit safety claim financials' },
  { module: 'safety', action: 'documents.upload', code: 'safety.documents.upload', description: 'Upload safety incident/claim documents' },
  { module: 'safety', action: 'reports.view', code: 'safety.reports.view', description: 'View safety reports' },
];

// Role defaults (additive)
const ROLE_ASSIGNMENTS = {
  super_admin: SAFETY_PERMISSIONS.map((p) => p.code),
  admin: SAFETY_PERMISSIONS.map((p) => p.code),
  company_admin: SAFETY_PERMISSIONS.map((p) => p.code),
  safety_manager: SAFETY_PERMISSIONS.map((p) => p.code),
  dispatcher: ['safety.incidents.view', 'safety.claims.view', 'safety.reports.view'],
};

exports.up = async function up(knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRoles = await knex.schema.hasTable('roles');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasPermissions || !hasRoles || !hasRolePermissions) return;

  // Upsert permissions
  for (const p of SAFETY_PERMISSIONS) {
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
  const permissionRows = await knex('permissions').whereIn('code', SAFETY_PERMISSIONS.map((p) => p.code)).select('id', 'code');
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
  const hasPermissions = await knex.schema.hasTable('permissions');
  if (!hasPermissions) return;
  const codes = SAFETY_PERMISSIONS.map((p) => p.code);
  await knex('permissions').whereIn('code', codes).delete();
};
