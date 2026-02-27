exports.up = async function(knex) {
  const hasVehicleType = await knex.schema.hasColumn('vehicles', 'vehicle_type');
  if (!hasVehicleType) {
    await knex.schema.alterTable('vehicles', table => {
      table.string('vehicle_type', 20).defaultTo('truck');
    });
    await knex.raw("UPDATE vehicles SET vehicle_type = 'truck' WHERE vehicle_type IS NULL");
  }
};

exports.down = async function(knex) {
  const hasVehicleType = await knex.schema.hasColumn('vehicles', 'vehicle_type');
  if (hasVehicleType) {
    await knex.schema.alterTable('vehicles', table => {
      table.dropColumn('vehicle_type');
    });
  }
};
