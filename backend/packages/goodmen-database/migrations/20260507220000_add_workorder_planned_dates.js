/**
 * FN-1523 — Add scheduled_date / start_date / completion_date to work_orders.
 *
 * These are user-entered planned/actual DATE values displayed on the Work Order
 * Basics tab. Distinct from the existing `completed_at TIMESTAMPTZ` audit column,
 * which remains untouched.
 */
exports.up = async function(knex) {
  const hasWorkOrders = await knex.schema.hasTable('work_orders');
  if (!hasWorkOrders) return;

  const addColumnIfMissing = async (column, callback) => {
    const exists = await knex.schema.hasColumn('work_orders', column);
    if (!exists) {
      await knex.schema.alterTable('work_orders', callback);
    }
  };

  await addColumnIfMissing('scheduled_date', table => table.date('scheduled_date').nullable());
  await addColumnIfMissing('start_date', table => table.date('start_date').nullable());
  await addColumnIfMissing('completion_date', table => table.date('completion_date').nullable());
};

exports.down = async function(knex) {
  const hasWorkOrders = await knex.schema.hasTable('work_orders');
  if (!hasWorkOrders) return;

  const dropColumnIfExists = async (column) => {
    const exists = await knex.schema.hasColumn('work_orders', column);
    if (exists) {
      await knex.schema.alterTable('work_orders', table => {
        table.dropColumn(column);
      });
    }
  };

  await dropColumnIfExists('completion_date');
  await dropColumnIfExists('start_date');
  await dropColumnIfExists('scheduled_date');
};
