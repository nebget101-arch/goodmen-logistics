'use strict';

/**
 * Link app user to driver for driver-role users (driver app: view loads, upload documents).
 */

exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('users', 'driver_id');
  if (!hasColumn) {
    await knex.schema.alterTable('users', (table) => {
      table.uuid('driver_id').references('id').inTable('drivers').onDelete('SET NULL');
    });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('users', 'driver_id')) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('driver_id');
    });
  }
};
