/**
 * Ensure work_orders.customer_id exists.
 */
exports.up = async function(knex) {
  const hasWorkOrders = await knex.schema.hasTable('work_orders');
  if (!hasWorkOrders) return;

  const hasCustomer = await knex.schema.hasColumn('work_orders', 'customer_id');
  if (!hasCustomer) {
    await knex.schema.alterTable('work_orders', table => {
      table.uuid('customer_id').references('id').inTable('customers').onDelete('SET NULL');
    });
  }
};

exports.down = async function(knex) {
  const hasWorkOrders = await knex.schema.hasTable('work_orders');
  if (!hasWorkOrders) return;

  const hasCustomer = await knex.schema.hasColumn('work_orders', 'customer_id');
  if (hasCustomer) {
    await knex.schema.alterTable('work_orders', table => {
      table.dropColumn('customer_id');
    });
  }
};
