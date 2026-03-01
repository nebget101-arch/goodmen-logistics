/**
 * Drop legacy work_orders vehicle FK (knex uses _foreign name)
 * and re-add FK to customer_vehicles.vehicle_uuid.
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('work_orders', table => {
    table.uuid('vehicle_id').nullable().alter();
  });

  await knex.raw('ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_vehicle_id_foreign');
  await knex.raw('ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_vehicle_id_fkey');

  await knex.raw(`
    ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_vehicle_id_foreign
    FOREIGN KEY (vehicle_id)
    REFERENCES customer_vehicles(vehicle_uuid)
    ON DELETE SET NULL
    NOT VALID
  `);
};

exports.down = async function(knex) {
  await knex.raw('ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_vehicle_id_foreign');
  await knex.raw('ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_vehicle_id_fkey');
};
