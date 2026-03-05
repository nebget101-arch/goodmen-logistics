/**
 * Add missing customer contact columns.
 */
exports.up = async function(knex) {
  const addColumnIfMissing = async (column, callback) => {
    const exists = await knex.schema.hasColumn('customers', column);
    if (!exists) {
      await knex.schema.alterTable('customers', callback);
    }
  };

  await addColumnIfMissing('primary_contact_name', table => table.text('primary_contact_name'));
  await addColumnIfMissing('secondary_phone', table => table.text('secondary_phone'));
  await addColumnIfMissing('tax_id', table => table.text('tax_id'));
  await addColumnIfMissing('website', table => table.text('website'));
};

exports.down = async function(knex) {
  await knex.schema.alterTable('customers', table => {
    table.dropColumn('primary_contact_name');
    table.dropColumn('secondary_phone');
    table.dropColumn('tax_id');
    table.dropColumn('website');
  });
};
