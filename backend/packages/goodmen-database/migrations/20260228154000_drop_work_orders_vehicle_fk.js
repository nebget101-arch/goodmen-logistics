/**
 * Drop work_orders_vehicle_id_fkey to allow customer vehicle UUIDs.
 */
exports.up = async function(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== 'true') {
    return;
  }
  await knex.raw('ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_vehicle_id_fkey');
};

exports.down = async function(knex) {
  // No-op: cannot safely re-add without knowing intended reference
};
