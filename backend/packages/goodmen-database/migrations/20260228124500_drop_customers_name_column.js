/**
 * Drop legacy customers.name column (use company_name).
 */
exports.up = async function(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== 'true') {
    return;
  }
	const hasCustomers = await knex.schema.hasTable('customers');
	if (!hasCustomers) return;

  const hasName = await knex.schema.hasColumn('customers', 'name');
  if (hasName) {
    await knex.schema.alterTable('customers', table => {
      table.dropColumn('name');
    });
  }
};

exports.down = async function(knex) {
	const hasCustomers = await knex.schema.hasTable('customers');
	if (!hasCustomers) return;

  const hasName = await knex.schema.hasColumn('customers', 'name');
  if (!hasName) {
    await knex.schema.alterTable('customers', table => {
      table.text('name');
    });
  }
};
