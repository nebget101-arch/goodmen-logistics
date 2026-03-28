/**
 * FN-383: Add missing pickup_date, delivery_date, pickup_location,
 * and delivery_location columns to the loads table.
 *
 * These columns are referenced by loads.js in POST, PUT, GET, and
 * approve-draft endpoints but were never added in the initial migration.
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('loads');
  if (!hasTable) return;

  const hasPickupDate = await knex.schema.hasColumn('loads', 'pickup_date');
  if (!hasPickupDate) {
    await knex.schema.alterTable('loads', (table) => {
      table.date('pickup_date').nullable();
    });
  }

  const hasDeliveryDate = await knex.schema.hasColumn('loads', 'delivery_date');
  if (!hasDeliveryDate) {
    await knex.schema.alterTable('loads', (table) => {
      table.date('delivery_date').nullable();
    });
  }

  const hasPickupLocation = await knex.schema.hasColumn('loads', 'pickup_location');
  if (!hasPickupLocation) {
    await knex.schema.alterTable('loads', (table) => {
      table.text('pickup_location').nullable();
    });
  }

  const hasDeliveryLocation = await knex.schema.hasColumn('loads', 'delivery_location');
  if (!hasDeliveryLocation) {
    await knex.schema.alterTable('loads', (table) => {
      table.text('delivery_location').nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('loads');
  if (!hasTable) return;

  const columns = ['pickup_date', 'delivery_date', 'pickup_location', 'delivery_location'];
  for (const col of columns) {
    const has = await knex.schema.hasColumn('loads', col);
    if (has) {
      await knex.schema.alterTable('loads', (table) => {
        table.dropColumn(col);
      });
    }
  }
};
