/**
 * Move inventory rows from Garland to Garland Main Warehouse.
 */
exports.up = async function(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== 'true') {
    return;
  }
  const oldLocation = await knex('locations')
    .whereRaw('LOWER(name) = ?', ['garland'])
    .first();
  const newLocation = await knex('locations')
    .whereRaw('LOWER(name) = ?', ['garland main warehouse'])
    .first();

  if (!oldLocation || !newLocation) {
    return;
  }

  await knex('inventory')
    .where({ location_id: oldLocation.id })
    .update({ location_id: newLocation.id });

  await knex('inventory_by_location')
    .where({ location_id: oldLocation.id })
    .update({ location_id: newLocation.id });
};

exports.down = async function(knex) {
  const oldLocation = await knex('locations')
    .whereRaw('LOWER(name) = ?', ['garland'])
    .first();
  const newLocation = await knex('locations')
    .whereRaw('LOWER(name) = ?', ['garland main warehouse'])
    .first();

  if (!oldLocation || !newLocation) {
    return;
  }

  await knex('inventory')
    .where({ location_id: newLocation.id })
    .update({ location_id: oldLocation.id });

  await knex('inventory_by_location')
    .where({ location_id: newLocation.id })
    .update({ location_id: oldLocation.id });
};
