exports.up = async function(knex) {
  await knex.schema.createTable('customers', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('name').notNullable();
    table.string('dot_number').unique();
    table.string('address');
    table.string('city');
    table.string('state');
    table.string('zip');
    table.string('phone');
    table.string('email');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Add customer_id to maintenance_records (work orders)
  await knex.schema.alterTable('maintenance_records', function(table) {
    table.uuid('customer_id').references('id').inTable('customers').onDelete('SET NULL');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('maintenance_records', function(table) {
    table.dropColumn('customer_id');
  });
  await knex.schema.dropTableIfExists('customers');
};
