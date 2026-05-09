/**
 * FN-1601: Add `loads.driver_name` text column for the spreadsheet importer's
 * fuzzy-match fallback. When the importer can't resolve `driver_id`, we still
 * want the raw mapped string visible on the load row instead of an empty
 * string from `concat_ws(d.first_name, d.last_name)`.
 *
 * This mirrors the existing `loads.broker_name` column, which already plays
 * the same role for brokers (see routes/loads.js list/detail projections that
 * COALESCE the joined broker name with `l.broker_name`).
 */
exports.up = async function (knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  const hasColumn = await knex.schema.hasColumn('loads', 'driver_name');
  if (!hasColumn) {
    await knex.schema.alterTable('loads', (table) => {
      table.text('driver_name');
    });
  }
};

exports.down = async function (knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;
  const hasColumn = await knex.schema.hasColumn('loads', 'driver_name');
  if (hasColumn) {
    await knex.schema.alterTable('loads', (table) => {
      table.dropColumn('driver_name');
    });
  }
};
