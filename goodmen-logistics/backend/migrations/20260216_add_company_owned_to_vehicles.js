exports.up = function(knex) {
  return knex.schema.table('vehicles', function(table) {
    table.boolean('company_owned').defaultTo(true); // true = company, false = customer
  });
};

exports.down = function(knex) {
  return knex.schema.table('vehicles', function(table) {
    table.dropColumn('company_owned');
  });
};
