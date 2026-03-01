/**
 * Ensure customer_vehicles.vehicle_uuid exists and is populated.
 */
exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  const hasVehicleUuid = await knex.schema.hasColumn('customer_vehicles', 'vehicle_uuid');
  if (!hasVehicleUuid) {
    await knex.schema.alterTable('customer_vehicles', table => {
      table.uuid('vehicle_uuid').defaultTo(knex.raw('gen_random_uuid()')).unique();
    });
  }

  await knex.raw('UPDATE customer_vehicles SET vehicle_uuid = COALESCE(vehicle_uuid, gen_random_uuid())');
};

exports.down = async function(knex) {
  const hasVehicleUuid = await knex.schema.hasColumn('customer_vehicles', 'vehicle_uuid');
  if (hasVehicleUuid) {
    await knex.schema.alterTable('customer_vehicles', table => {
      table.dropColumn('vehicle_uuid');
    });
  }
};
