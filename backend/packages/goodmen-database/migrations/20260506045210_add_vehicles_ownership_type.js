'use strict';

/**
 * FN-1385: Add structured ownership classification to vehicles.
 *
 * Adds vehicles.ownership_type with CHECK constraint values
 * ('company','oo','leased') and DEFAULT 'company'. Backfills from existing
 * signals so callers (settlements, work-order routing, list filters) can
 * rely on a single column instead of inferring ownership from
 * `company_owned` + `trailer_details->>'ownership'`.
 *
 * Backfill rules (applied in order; later wins):
 *   1. 'oo'      where company_owned = false
 *   2. 'leased'  where trailer_details->>'ownership' = 'leased'
 * Defaults to 'company' otherwise.
 *
 * Adds composite index (tenant_id, ownership_type) for tenant-scoped
 * list filters introduced in FN-1383.
 *
 * `company_owned` is preserved for settlements backward compatibility
 * per FN-1381 acceptance criteria.
 */

const COLUMN = 'ownership_type';
const CHECK_NAME = 'vehicles_ownership_type_check';
const INDEX_NAME = 'vehicles_tenant_id_ownership_type_idx';

exports.up = async function up(knex) {
  const hasVehicles = await knex.schema.hasTable('vehicles');
  if (!hasVehicles) return;

  const hasColumn = await knex.schema.hasColumn('vehicles', COLUMN);
  if (!hasColumn) {
    await knex.schema.alterTable('vehicles', (table) => {
      table.text(COLUMN).notNullable().defaultTo('company');
    });

    await knex.raw(
      `ALTER TABLE vehicles
         ADD CONSTRAINT ?? CHECK (?? IN ('company', 'oo', 'leased'))`,
      [CHECK_NAME, COLUMN]
    );
  }

  // Backfill: company_owned = false → 'oo'
  await knex.raw(`
    UPDATE vehicles
       SET ownership_type = 'oo'
     WHERE company_owned = false
       AND ownership_type = 'company'
  `);

  // Backfill: trailer_details->>'ownership' = 'leased' → 'leased' (overrides 'oo')
  await knex.raw(`
    UPDATE vehicles
       SET ownership_type = 'leased'
     WHERE trailer_details->>'ownership' = 'leased'
       AND ownership_type <> 'leased'
  `);

  // Composite index for tenant-scoped list filters
  const hasIndex = await knex.raw(
    `SELECT 1 FROM pg_indexes WHERE indexname = ?`,
    [INDEX_NAME]
  );
  if (hasIndex.rowCount === 0) {
    await knex.raw(
      `CREATE INDEX ?? ON vehicles (tenant_id, ownership_type)`,
      [INDEX_NAME]
    );
  }
};

exports.down = async function down(knex) {
  const hasVehicles = await knex.schema.hasTable('vehicles');
  if (!hasVehicles) return;

  await knex.raw(`DROP INDEX IF EXISTS ??`, [INDEX_NAME]);

  const hasColumn = await knex.schema.hasColumn('vehicles', COLUMN);
  if (hasColumn) {
    await knex.raw(
      `ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS ??`,
      [CHECK_NAME]
    );
    await knex.schema.alterTable('vehicles', (table) => {
      table.dropColumn(COLUMN);
    });
  }
};
