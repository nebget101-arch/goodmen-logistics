exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('communication_consents');
  if (hasTable) return;

  await knex.schema.createTable('communication_consents', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('identifier_type', 20).notNullable();
    table.string('identifier_value', 255).notNullable();
    table.boolean('opt_in_email').notNullable().defaultTo(true);
    table.boolean('opt_in_sms').notNullable().defaultTo(true);
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['identifier_type', 'identifier_value']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('communication_consents');
};
