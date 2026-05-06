'use strict';

/**
 * FN-1417: Add `tenants.is_internal` flag.
 *
 * Used by FN-1415 to gate the manual FMCSA import trigger so that only the
 * internal FleetNeuron tenant can kick off ingest jobs from the UI. Other
 * tenants will see FMCSA data read-only.
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('tenants', 'is_internal');
  if (hasColumn) return;

  await knex.schema.alterTable('tenants', (t) => {
    t.boolean('is_internal').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('tenants', 'is_internal');
  if (!hasColumn) return;

  await knex.schema.alterTable('tenants', (t) => {
    t.dropColumn('is_internal');
  });
};
