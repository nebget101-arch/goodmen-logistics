'use strict';

/**
 * FN-271: Backfill NULL string fields in vehicles table to empty strings.
 * Prevents frontend crashes when the app tries to call .trim() or .toLowerCase()
 * on null values returned from the database.
 */

const COLUMNS = ['vin', 'make', 'model', 'license_plate', 'state', 'unit_number'];

exports.up = async (knex) => {
  const hasVehicles = await knex.schema.hasTable('vehicles');
  if (!hasVehicles) return;

  const setClauses = COLUMNS.map((col) => `${col} = COALESCE(${col}, '')`).join(', ');
  const whereClauses = COLUMNS.map((col) => `${col} IS NULL`).join(' OR ');

  await knex.raw(`UPDATE vehicles SET ${setClauses} WHERE ${whereClauses}`);
};

exports.down = async () => {
  // No-op: we cannot distinguish original NULLs from backfilled empty strings
};
