/**
 * Ensure work_orders financial columns exist.
 */
exports.up = async function(knex) {
  const addColumnIfMissing = async (column, callback) => {
    const exists = await knex.schema.hasColumn('work_orders', column);
    if (!exists) {
      await knex.schema.alterTable('work_orders', callback);
    }
  };

  await addColumnIfMissing('discount_type', table => table.enu('discount_type', ['NONE', 'PERCENT', 'AMOUNT']).defaultTo('NONE'));
  await addColumnIfMissing('discount_value', table => table.decimal('discount_value', 12, 2).defaultTo(0));
  await addColumnIfMissing('tax_rate_percent', table => table.decimal('tax_rate_percent', 6, 3).defaultTo(0));
  await addColumnIfMissing('tax_amount', table => table.decimal('tax_amount', 12, 2).defaultTo(0));
  await addColumnIfMissing('labor_subtotal', table => table.decimal('labor_subtotal', 12, 2).defaultTo(0));
  await addColumnIfMissing('parts_subtotal', table => table.decimal('parts_subtotal', 12, 2).defaultTo(0));
  await addColumnIfMissing('fees_subtotal', table => table.decimal('fees_subtotal', 12, 2).defaultTo(0));
  await addColumnIfMissing('total_amount', table => table.decimal('total_amount', 12, 2).defaultTo(0));
};

exports.down = async function(knex) {
  await knex.schema.alterTable('work_orders', table => {
    table.dropColumn('discount_type');
    table.dropColumn('discount_value');
    table.dropColumn('tax_rate_percent');
    table.dropColumn('tax_amount');
    table.dropColumn('labor_subtotal');
    table.dropColumn('parts_subtotal');
    table.dropColumn('fees_subtotal');
    table.dropColumn('total_amount');
  });
};
