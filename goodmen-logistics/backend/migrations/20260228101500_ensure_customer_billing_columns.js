/**
 * Ensure customer billing-related columns exist.
 */
exports.up = async function(knex) {
  const addColumnIfMissing = async (column, callback) => {
    const exists = await knex.schema.hasColumn('customers', column);
    if (!exists) {
      await knex.schema.alterTable('customers', callback);
    }
  };

  await addColumnIfMissing('billing_address_line1', table => table.text('billing_address_line1'));
  await addColumnIfMissing('billing_address_line2', table => table.text('billing_address_line2'));
  await addColumnIfMissing('billing_city', table => table.text('billing_city'));
  await addColumnIfMissing('billing_state', table => table.text('billing_state'));
  await addColumnIfMissing('billing_zip', table => table.text('billing_zip'));
  await addColumnIfMissing('billing_country', table => table.text('billing_country'));
  await addColumnIfMissing('billing_notes', table => table.text('billing_notes'));
  await addColumnIfMissing('primary_contact_name', table => table.text('primary_contact_name'));
  await addColumnIfMissing('secondary_phone', table => table.text('secondary_phone'));
  await addColumnIfMissing('tax_id', table => table.text('tax_id'));
  await addColumnIfMissing('payment_terms', table => table.enu('payment_terms', ['DUE_ON_RECEIPT','NET_15','NET_30','CUSTOM']).defaultTo('DUE_ON_RECEIPT'));
  await addColumnIfMissing('payment_terms_custom_days', table => table.integer('payment_terms_custom_days'));
  await addColumnIfMissing('credit_limit', table => table.decimal('credit_limit', 12, 2));
  await addColumnIfMissing('tax_exempt', table => table.boolean('tax_exempt').defaultTo(false));
  await addColumnIfMissing('default_location_id', table => table.uuid('default_location_id').references('id').inTable('locations').onDelete('SET NULL'));
  await addColumnIfMissing('is_deleted', table => table.boolean('is_deleted').defaultTo(false));
};

exports.down = async function(knex) {
  await knex.schema.alterTable('customers', table => {
    table.dropColumn('billing_address_line1');
    table.dropColumn('billing_address_line2');
    table.dropColumn('billing_city');
    table.dropColumn('billing_state');
    table.dropColumn('billing_zip');
    table.dropColumn('billing_country');
    table.dropColumn('billing_notes');
    table.dropColumn('primary_contact_name');
    table.dropColumn('secondary_phone');
    table.dropColumn('tax_id');
    table.dropColumn('payment_terms');
    table.dropColumn('payment_terms_custom_days');
    table.dropColumn('credit_limit');
    table.dropColumn('tax_exempt');
    table.dropColumn('default_location_id');
    table.dropColumn('is_deleted');
  });
};
