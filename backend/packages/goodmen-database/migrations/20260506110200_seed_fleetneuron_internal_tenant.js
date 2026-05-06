'use strict';

/**
 * FN-1417: Mark the seeded FleetNeuron tenant row as internal.
 *
 * The default tenant is created by the multi-MC bootstrap migration
 * (20260310102000_backfill_default_multi_mc_context.js) under the name
 * 'FleetNeuron Default Tenant'. This migration flips its `is_internal` flag.
 *
 * Idempotent and tolerant of environments where the tenant row was renamed:
 * if the FleetNeuron tenant cannot be located by exact name, falls back to
 * any tenant whose name starts with 'FleetNeuron'. If neither matches, this
 * migration logs a warning and exits without failing — downstream stories
 * (FN-1415) will still gate by `is_internal`, so a missing flag means no
 * tenant is internal until an operator sets it manually.
 */

const FLEETNEURON_TENANT_NAME = 'FleetNeuron Default Tenant';

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('tenants', 'is_internal');
  if (!hasColumn) return;

  let tenant = await knex('tenants').where({ name: FLEETNEURON_TENANT_NAME }).first(['id', 'name']);

  if (!tenant) {
    tenant = await knex('tenants')
      .whereRaw("name ILIKE 'FleetNeuron%'")
      .orderBy('created_at', 'asc')
      .first(['id', 'name']);
  }

  if (!tenant) {
    console.warn(
      '[FN-1417] No FleetNeuron tenant row found — is_internal flag left at default false. ' +
      'Set manually via SQL once the FleetNeuron tenant is provisioned.'
    );
    return;
  }

  // Clear is_internal on any other rows first so the constraint of "exactly
  // one internal tenant" holds even if a prior run flagged a different row.
  await knex('tenants').whereNot({ id: tenant.id }).update({ is_internal: false });
  await knex('tenants').where({ id: tenant.id }).update({ is_internal: true });

  console.log(`[FN-1417] Marked tenant '${tenant.name}' (${tenant.id}) as is_internal=true.`);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('tenants', 'is_internal');
  if (!hasColumn) return;

  await knex('tenants').update({ is_internal: false });
};
