/**
 * Recreate all_vehicles view.
 */
exports.up = async function(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== 'true') {
    return;
  }
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');
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
