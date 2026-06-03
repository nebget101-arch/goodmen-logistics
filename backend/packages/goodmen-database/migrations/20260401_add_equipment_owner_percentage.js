'use strict';

/**
 * FN-554: Add equipment_owner_percentage column to driver_compensation_profiles.
 *
 * - Adds DECIMAL(5,2) nullable column to store the percentage of gross revenue
 *   allocated to the equipment owner (separate from the driver's percentage_rate).
 * - Backfills non-owner_operator rows: equipment_owner_percentage = 100 - percentage_rate
 *   where percentage_rate is non-null. This represents the historical assumption that
 *   whatever the driver doesn't earn, the equipment owner receives.
 * - Owner operator rows are left NULL — an owner operator is their own equipment owner
 *   and this field is not applicable to them.
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('driver_compensation_profiles');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn(
    'driver_compensation_profiles',
    'equipment_owner_percentage'
  );

  if (!hasColumn) {
    await knex.schema.alterTable('driver_compensation_profiles', (table) => {
      table.decimal('equipment_owner_percentage', 5, 2).nullable();
    });
  }

  // Backfill: non-owner_operator rows where percentage_rate is set and
  // equipment_owner_percentage has not already been populated.
  await knex.raw(`
    UPDATE driver_compensation_profiles
    SET equipment_owner_percentage = 100 - percentage_rate
    WHERE equipment_owner_percentage IS NULL
      AND profile_type != 'owner_operator'
      AND percentage_rate IS NOT NULL
  `);
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('driver_compensation_profiles');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn(
    'driver_compensation_profiles',
    'equipment_owner_percentage'
  );

  if (hasColumn) {
    await knex.schema.alterTable('driver_compensation_profiles', (table) => {
      table.dropColumn('equipment_owner_percentage');
    });
  }
};
