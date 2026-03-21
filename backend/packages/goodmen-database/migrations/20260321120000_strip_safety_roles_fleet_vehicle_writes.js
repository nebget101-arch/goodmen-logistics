'use strict';

/**
 * FN-133 follow-up: Safety Manager (and legacy `safety` role if present) must not have
 * fleet truck/trailer mutation permissions in role_permissions — product policy is read-only.
 */

const CODES = [
  'vehicles.create',
  'vehicles.edit',
  'vehicles.delete',
  'trailers.create',
  'trailers.edit',
  'trailers.delete',
];

exports.up = async (knex) => {
  const hasRoles = await knex.schema.hasTable('roles');
  const hasPerms = await knex.schema.hasTable('permissions');
  const hasRp = await knex.schema.hasTable('role_permissions');
  if (!hasRoles || !hasPerms || !hasRp) return;

  const roleRows = await knex('roles').whereIn('code', ['safety_manager', 'safety']).select('id');
  if (!roleRows.length) return;

  const permRows = await knex('permissions').whereIn('code', CODES).select('id');
  if (!permRows.length) return;

  const roleIds = roleRows.map((r) => r.id);
  const permIds = permRows.map((p) => p.id);

  await knex('role_permissions').whereIn('role_id', roleIds).whereIn('permission_id', permIds).del();
};

exports.down = async () => {
  // Irreversible: re-grant would need product decision; no-op.
};
