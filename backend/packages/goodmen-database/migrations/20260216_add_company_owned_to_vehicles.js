exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('vehicles', 'company_owned');
  if (hasColumn) return;

  return knex.schema.table('vehicles', table => {
    table.boolean('company_owned').defaultTo(true); // true = company, false = customer
  });
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('vehicles', 'company_owned');
  if (!hasColumn) return;

  return knex.schema.table('vehicles', table => {
    table.dropColumn('company_owned');
  });
};
