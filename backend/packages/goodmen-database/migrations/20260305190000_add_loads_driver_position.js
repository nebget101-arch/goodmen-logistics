/**
 * Add driver_position_city and driver_position_state to loads (driver location before picking up this load).
 */
exports.up = async function(knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  const addColumnIfMissing = async (column, cb) => {
    const exists = await knex.schema.hasColumn('loads', column);
    if (!exists) {
      await knex.schema.alterTable('loads', cb);
    }
  };

  await addColumnIfMissing('driver_position_city', (table) => {
    table.text('driver_position_city');
  });
  await addColumnIfMissing('driver_position_state', (table) => {
    table.text('driver_position_state');
  });
};

exports.down = async function(knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  const dropColumnIfExists = async (column) => {
    const exists = await knex.schema.hasColumn('loads', column);
    if (exists) {
      await knex.schema.alterTable('loads', (table) => table.dropColumn(column));
    }
  };
  await dropColumnIfExists('driver_position_state');
  await dropColumnIfExists('driver_position_city');
};
