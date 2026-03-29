'use strict';

/**
 * Add skipped_rows column to fuel_import_batches for tracking
 * Money Code / non-fuel rows that are intentionally skipped.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('fuel_import_batches', (t) => {
    t.integer('skipped_rows').notNullable().defaultTo(0).after('failed_rows');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('fuel_import_batches', (t) => {
    t.dropColumn('skipped_rows');
  });
};
