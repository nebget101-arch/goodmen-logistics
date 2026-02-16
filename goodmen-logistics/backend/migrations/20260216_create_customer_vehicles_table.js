exports.up = function(knex) {
  return knex.schema.createTable('customer_vehicles', function(table) {
    table.increments('id').primary();
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

exports.down = function(knex) {
  return knex.schema.dropTable('customer_vehicles');
};
