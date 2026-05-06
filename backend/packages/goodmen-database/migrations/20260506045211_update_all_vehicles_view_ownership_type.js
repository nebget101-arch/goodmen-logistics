'use strict';

/**
 * FN-1385: Expose vehicles.ownership_type on the all_vehicles view.
 *
 * Recreates `all_vehicles` to add the new `ownership_type` column to the
 * fleet branch. The shop_client (customer_vehicles) branch returns
 * NULL::text — ownership classification only applies to fleet equipment.
 *
 * View shape otherwise matches
 * 20260317110000_update_all_vehicles_view_vehicle_source_and_is_deleted.js
 * (vehicle_source rename, is_deleted filter, customer_vehicle/active
 * mapping for shop-client rows). Down migration restores that prior shape.
 */

exports.up = async function up(knex) {
  const hasVehicles = await knex.schema.hasTable('vehicles');
  const hasCustomerVehicles = await knex.schema.hasTable('customer_vehicles');
  if (!hasVehicles || !hasCustomerVehicles) return;

  await knex.raw('DROP VIEW IF EXISTS all_vehicles');
  await knex.raw(`
    CREATE VIEW all_vehicles AS

    -- Fleet-owned vehicles
    SELECT
      v.id,
      v.unit_number,
      v.vin,
      v.make,
      v.model,
      v.year,
      v.license_plate,
      v.state,
      COALESCE(v.vehicle_type, 'truck'::character varying) AS vehicle_type,
      v.status,
      v.mileage,
      v.inspection_expiry,
      v.next_pm_due,
      v.next_pm_mileage,
      v.insurance_expiry,
      v.registration_expiry,
      v.tenant_id,
      v.operating_entity_id,
      'fleet'::text            AS vehicle_source,
      NULL::uuid               AS shop_client_id,
      v.oos_reason,
      v.created_at,
      v.updated_at,
      v.location_id,
      v.company_owned,
      v.ownership_type,
      v.trailer_details
    FROM vehicles v
    WHERE v.is_deleted IS NOT TRUE

    UNION ALL

    -- Shop-client (customer) owned vehicles
    SELECT
      cv.vehicle_uuid          AS id,
      cv.unit_number,
      cv.vin,
      cv.make,
      cv.model,
      cv.year,
      cv.license_plate,
      cv.state,
      'customer_vehicle'::text AS vehicle_type,
      'active'::text           AS status,
      cv.mileage,
      cv.inspection_expiry,
      cv.next_pm_due,
      cv.next_pm_mileage,
      cv.insurance_expiry,
      NULL::date               AS registration_expiry,
      cv.tenant_id,
      NULL::uuid               AS operating_entity_id,
      'shop_client'::text      AS vehicle_source,
      cv.shop_client_id,
      NULL::text               AS oos_reason,
      cv.created_at,
      cv.updated_at,
      NULL::uuid               AS location_id,
      false                    AS company_owned,
      NULL::text               AS ownership_type,
      NULL::jsonb              AS trailer_details
    FROM customer_vehicles cv;
  `);
};

exports.down = async function down(knex) {
  const hasVehicles = await knex.schema.hasTable('vehicles');
  const hasCustomerVehicles = await knex.schema.hasTable('customer_vehicles');
  if (!hasVehicles || !hasCustomerVehicles) return;

  // Restore the pre-FN-1385 view shape
  // (mirrors 20260317110000_update_all_vehicles_view_vehicle_source_and_is_deleted.js up())
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
      COALESCE(v.vehicle_type, 'truck'::character varying) AS vehicle_type,
      v.status,
      v.mileage,
      v.inspection_expiry,
      v.next_pm_due,
      v.next_pm_mileage,
      v.insurance_expiry,
      v.registration_expiry,
      v.tenant_id,
      v.operating_entity_id,
      'fleet'::text            AS vehicle_source,
      NULL::uuid               AS shop_client_id,
      v.oos_reason,
      v.created_at,
      v.updated_at,
      v.location_id,
      v.company_owned,
      v.trailer_details
    FROM vehicles v
    WHERE v.is_deleted IS NOT TRUE

    UNION ALL

    SELECT
      cv.vehicle_uuid          AS id,
      cv.unit_number,
      cv.vin,
      cv.make,
      cv.model,
      cv.year,
      cv.license_plate,
      cv.state,
      'customer_vehicle'::text AS vehicle_type,
      'active'::text           AS status,
      cv.mileage,
      cv.inspection_expiry,
      cv.next_pm_due,
      cv.next_pm_mileage,
      cv.insurance_expiry,
      NULL::date               AS registration_expiry,
      cv.tenant_id,
      NULL::uuid               AS operating_entity_id,
      'shop_client'::text      AS vehicle_source,
      cv.shop_client_id,
      NULL::text               AS oos_reason,
      cv.created_at,
      cv.updated_at,
      NULL::uuid               AS location_id,
      false                    AS company_owned,
      NULL::jsonb              AS trailer_details
    FROM customer_vehicles cv;
  `);
};
