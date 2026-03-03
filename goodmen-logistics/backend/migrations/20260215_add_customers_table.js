exports.up = async function (knex) {
  const hasCustomers = await knex.schema.hasTable('customers');
  if (hasCustomers) {
    // Table already exists (from schema.sql/init), skip this migration.
    return;
  }

  return knex.schema.createTable('customers', table => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('name', 255).notNullable();
    table.string('dot_number', 255);
    table.string('address', 255);
    table.string('city', 255);
    table.string('state', 255);
    table.string('zip', 255);
    table.string('phone', 255);
    table.string('email', 255);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  const hasCustomers = await knex.schema.hasTable('customers');
  if (!hasCustomers) return;
  await knex.schema.dropTable('customers');
};