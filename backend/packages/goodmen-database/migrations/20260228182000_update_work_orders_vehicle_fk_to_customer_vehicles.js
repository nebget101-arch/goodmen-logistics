/**
 * Point work_orders.vehicle_id to customer_vehicles.vehicle_uuid.
 * Use NOT VALID to avoid failing on legacy rows that still reference vehicles(id).
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('work_orders', table => {
    table.uuid('vehicle_id').nullable().alter();
  });

  await knex.raw('ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_vehicle_id_fkey');

  await knex.raw(`
    ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_vehicle_id_fkey
    FOREIGN KEY (vehicle_id)
    REFERENCES customer_vehicles(vehicle_uuid)
    ON DELETE SET NULL
    NOT VALID
  `);
};

exports.down = async function(knex) {
  // No-op: reintroducing the previous FK is not safe without data migration.
  await knex.raw('ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_vehicle_id_fkey');
};
