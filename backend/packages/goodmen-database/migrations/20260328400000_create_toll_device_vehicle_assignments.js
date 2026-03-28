/**
 * FN-467: Create toll_device_vehicle_assignments table for transponder history.
 * Tracks which vehicle had which transponder on what dates,
 * enabling date-range-aware matching during toll import.
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('toll_device_vehicle_assignments'))) {
    await knex.schema.createTable('toll_device_vehicle_assignments', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('toll_device_id').notNullable().references('id').inTable('toll_devices').onDelete('CASCADE');
      t.uuid('truck_id').notNullable();
      t.text('plate_number').nullable();
      t.date('assigned_date').notNullable().defaultTo(knex.fn.now());
      t.date('removed_date').nullable();
      t.text('status').notNullable().defaultTo('active');
      t.uuid('assigned_by').nullable();
      t.uuid('removed_by').nullable();
      t.text('notes').nullable();
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_tdva_tenant ON toll_device_vehicle_assignments(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_tdva_device ON toll_device_vehicle_assignments(toll_device_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_tdva_truck ON toll_device_vehicle_assignments(truck_id)');
    await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tdva_active ON toll_device_vehicle_assignments(toll_device_id, status) WHERE status = 'active'`);
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('toll_device_vehicle_assignments');
};
