'use strict';

/**
 * Safety Manager: create/edit fleet trucks & trailers, unit documents, trailer records.
 * Idempotent — skips existing role_permissions rows.
 * Complements rbac-service mergeSafetyFleetUnitBaselineIfApplicable for legacy users.
 */

const CODES = [
  'vehicles.create',
  'vehicles.edit',
  'trailers.view',
  'trailers.create',
  'trailers.edit',
  'documents.view',
  'documents.upload',
];

exports.up = async (knex) => {
  const hasRoles = await knex.schema.hasTable('roles');
  const hasPerms = await knex.schema.hasTable('permissions');
  const hasRp = await knex.schema.hasTable('role_permissions');
  if (!hasRoles || !hasPerms || !hasRp) return;

  const roleRows = await knex('roles').whereIn('code', ['safety_manager', 'safety']).select('id', 'code');
  if (!roleRows.length) return;

  const permRows = await knex('permissions').whereIn('code', CODES).select('id', 'code');
  const permByCode = new Map(permRows.map((p) => [p.code, p.id]));
  if (!permByCode.size) return;

  for (const role of roleRows) {
    for (const code of CODES) {
      const permissionId = permByCode.get(code);
      if (!permissionId) continue;
      const exists = await knex('role_permissions')
        .where({ role_id: role.id, permission_id: permissionId })
        .first('role_id');
      if (exists) continue;
      await knex('role_permissions').insert({ role_id: role.id, permission_id: permissionId });
    }
  }
};

exports.down = async (knex) => {
  const hasRoles = await knex.schema.hasTable('roles');
  const hasPerms = await knex.schema.hasTable('permissions');
  const hasRp = await knex.schema.hasTable('role_permissions');
  if (!hasRoles || !hasPerms || !hasRp) return;

  const roleRows = await knex('roles').whereIn('code', ['safety_manager', 'safety']).select('id');
  if (!roleRows.length) return;

  const permRows = await knex('permissions').whereIn('code', CODES).select('id');
  const permIds = permRows.map((p) => p.id);
  if (!permIds.length) return;

  await knex('role_permissions')
    .whereIn(
      'role_id',
      roleRows.map((r) => r.id)
    )
    .whereIn('permission_id', permIds)
    .del();
};
