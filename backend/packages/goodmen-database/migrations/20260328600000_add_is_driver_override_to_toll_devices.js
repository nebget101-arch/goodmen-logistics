'use strict';

/**
 * FN-488: Add is_driver_override flag to toll_devices.
 *
 * When true the driver_id was explicitly set via the assign-driver endpoint
 * and should NOT be auto-synced when the truck's driver changes.
 * When false (default) the driver_id is auto-resolved from the truck.
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('toll_devices', 'is_driver_override');
  if (!hasColumn) {
    await knex.schema.alterTable('toll_devices', (t) => {
      t.boolean('is_driver_override').notNullable().defaultTo(false);
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('toll_devices', 'is_driver_override');
  if (hasColumn) {
    await knex.schema.alterTable('toll_devices', (t) => {
      t.dropColumn('is_driver_override');
    });
  }
};
