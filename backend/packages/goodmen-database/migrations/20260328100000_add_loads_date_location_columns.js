/**
 * FN-383: Add missing pickup_date, delivery_date, pickup_location,
 * delivery_location columns to the loads table.
 *
 * These columns are referenced by multiple code paths (POST create,
 * PUT update, bulk upload, approve-draft, list query) but were never
 * included in the original loads migration.
 */
exports.up = async function (knex) {
  const addIfMissing = async (column, builder) => {
    const exists = await knex.schema.hasColumn('loads', column);
    if (!exists) {
      await knex.schema.alterTable('loads', builder);
    }
  };

  await addIfMissing('pickup_date', (table) => {
    table.date('pickup_date');
  });

  await addIfMissing('delivery_date', (table) => {
    table.date('delivery_date');
  });

  await addIfMissing('pickup_location', (table) => {
    table.text('pickup_location');
  });

  await addIfMissing('delivery_location', (table) => {
    table.text('delivery_location');
  });
};

exports.down = async function (knex) {
  const dropIfExists = async (column) => {
    const exists = await knex.schema.hasColumn('loads', column);
    if (exists) {
      await knex.schema.alterTable('loads', (table) => {
        table.dropColumn(column);
      });
    }
  };

  await dropIfExists('delivery_location');
  await dropIfExists('pickup_location');
  await dropIfExists('delivery_date');
  await dropIfExists('pickup_date');
};
