exports.up = async function(knex) {
  const hasTable = await knex.schema.hasTable('customer_vehicles');
  if (hasTable) return;

  return knex.schema.createTable('customer_vehicles', table => {
    table.increments('id').primary();
    table.uuid('vehicle_uuid').defaultTo(knex.raw('gen_random_uuid()')).unique();
    table.string('unit_number');
    table.string('vin').notNullable();
    table.string('make');
    table.string('model');
    table.integer('year');
    table.string('license_plate');
    table.string('state');
    table.integer('mileage');
    table.date('inspection_expiry');
    table.date('next_pm_due');
    table.integer('next_pm_mileage');
    table.date('insurance_expiry');
    table.uuid('customer_id').references('id').inTable('customers').onDelete('CASCADE');
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  const hasTable = await knex.schema.hasTable('customer_vehicles');
  if (!hasTable) return;
  return knex.schema.dropTable('customer_vehicles');
};
