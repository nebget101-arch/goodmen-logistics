exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  const hasVehicleUuid = await knex.schema.hasColumn('customer_vehicles', 'vehicle_uuid');
  if (!hasVehicleUuid) {
    await knex.schema.alterTable('customer_vehicles', table => {
      table.uuid('vehicle_uuid').defaultTo(knex.raw('gen_random_uuid()')).unique();
    });
  }
  await knex.raw('UPDATE customer_vehicles SET vehicle_uuid = COALESCE(vehicle_uuid, gen_random_uuid())');
  await knex.raw('ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_vehicle_id_fkey');
  await knex.raw('DROP VIEW IF EXISTS all_vehicles');
  await knex.raw(`
    CREATE VIEW all_vehicles AS
    SELECT
      v.id,
      v.unit_number,
      v.vin,
      v.make,
      v.model,
      v.year,
      v.license_plate,
      v.state,
      v.status,
      v.mileage,
      v.inspection_expiry,
      v.next_pm_due,
      v.next_pm_mileage,
      v.insurance_expiry,
      v.registration_expiry,
      v.oos_reason,
      v.created_at,
      v.updated_at,
      v.location_id,
      v.company_owned,
      NULL::uuid AS customer_id,
      'internal'::text AS source
    FROM vehicles v
    UNION ALL
    SELECT
      cv.vehicle_uuid AS id,
      cv.unit_number,
      cv.vin,
      cv.make,
      cv.model,
      cv.year,
      cv.license_plate,
      cv.state,
      'in-service'::text AS status,
      cv.mileage,
      cv.inspection_expiry,
      cv.next_pm_due,
      cv.next_pm_mileage,
      cv.insurance_expiry,
      NULL::date AS registration_expiry,
      NULL::text AS oos_reason,
      cv.created_at,
      cv.updated_at,
      NULL::uuid AS location_id,
      false AS company_owned,
      cv.customer_id,
      'customer'::text AS source
    FROM customer_vehicles cv
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP VIEW IF EXISTS all_vehicles');
};
