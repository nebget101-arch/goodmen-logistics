'use strict';

/**
 * Fix all_vehicles view to include vehicle_type (was accidentally dropped in prior migration).
 * Also fixes the down migration to preserve trailer_details.
 */
exports.up = async function up(knex) {
  const hasVehicles = await knex.schema.hasTable('vehicles');
  const hasCustomerVehicles = await knex.schema.hasTable('customer_vehicles');
  if (!hasVehicles || !hasCustomerVehicles) {
    return;
  }

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
      v.tenant_id,
      v.company_owned,
      COALESCE(v.vehicle_type, 'truck') AS vehicle_type,
      NULL::uuid AS customer_id,
      'internal'::text AS source,
      v.operating_entity_id,
      v.trailer_details
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
      cv.tenant_id,
      false AS company_owned,
      'truck'::text AS vehicle_type,
      cv.customer_id,
      'customer'::text AS source,
      NULL::uuid AS operating_entity_id,
      NULL::jsonb AS trailer_details
    FROM customer_vehicles cv;
  `);
};

exports.down = async function down(knex) {
  const hasVehicles = await knex.schema.hasTable('vehicles');
  const hasCustomerVehicles = await knex.schema.hasTable('customer_vehicles');
  if (!hasVehicles || !hasCustomerVehicles) {
    return;
  }

  // Revert to previous view shape (without vehicle_type)
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
      v.tenant_id,
      v.company_owned,
      NULL::uuid AS customer_id,
      'internal'::text AS source,
      v.operating_entity_id,
      v.trailer_details
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
      cv.tenant_id,
      false AS company_owned,
      cv.customer_id,
      'customer'::text AS source,
      NULL::uuid AS operating_entity_id,
      NULL::jsonb AS trailer_details
    FROM customer_vehicles cv;
  `);
};
