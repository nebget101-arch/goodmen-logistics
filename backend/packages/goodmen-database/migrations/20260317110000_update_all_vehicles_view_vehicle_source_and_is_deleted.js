'use strict';

/**
 * Update all_vehicles view:
 *  - Add `is_deleted` soft-delete column to the `vehicles` table
 *  - Filter soft-deleted fleet vehicles (WHERE is_deleted IS NOT TRUE)
 *  - Rename `source` column to `vehicle_source` with updated values:
 *      'internal' → 'fleet'   (fleet-owned vehicles)
 *      'customer' → 'shop_client'  (customer-owned vehicles)
 *  - Change customer vehicle `vehicle_type` from 'truck' to 'customer_vehicle'
 *  - Change customer vehicle `status` from 'in-service' to 'active'
 *  - Backward-compat columns (location_id, created_at, updated_at, oos_reason,
 *    company_owned, trailer_details) are preserved so existing report/invoice
 *    queries continue to work without modification.
 */

exports.up = async function up(knex) {
  const hasVehicles = await knex.schema.hasTable('vehicles');
  const hasCustomerVehicles = await knex.schema.hasTable('customer_vehicles');
  if (!hasVehicles || !hasCustomerVehicles) return;

  // 1. Add is_deleted to vehicles if it doesn't exist yet
  const hasCol = await knex.schema.hasColumn('vehicles', 'is_deleted');
  if (!hasCol) {
    await knex.schema.table('vehicles', (t) => {
      t.boolean('is_deleted').defaultTo(false);
    });
  }

  // 2. Recreate view
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
      NULL::jsonb              AS trailer_details
    FROM customer_vehicles cv;
  `);
};

exports.down = async function down(knex) {
  const hasVehicles = await knex.schema.hasTable('vehicles');
  const hasCustomerVehicles = await knex.schema.hasTable('customer_vehicles');
  if (!hasVehicles || !hasCustomerVehicles) return;

  // Restore view to pre-migration shape
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
      COALESCE(v.vehicle_type, 'truck'::character varying) AS vehicle_type,
      NULL::uuid               AS shop_client_id,
      'internal'::text         AS source,
      v.operating_entity_id,
      v.trailer_details
    FROM vehicles v

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
      'in-service'::text       AS status,
      cv.mileage,
      cv.inspection_expiry,
      cv.next_pm_due,
      cv.next_pm_mileage,
      cv.insurance_expiry,
      NULL::date               AS registration_expiry,
      NULL::text               AS oos_reason,
      cv.created_at,
      cv.updated_at,
      NULL::uuid               AS location_id,
      cv.tenant_id,
      false                    AS company_owned,
      'truck'::text            AS vehicle_type,
      cv.shop_client_id,
      'customer'::text         AS source,
      NULL::uuid               AS operating_entity_id,
      NULL::jsonb              AS trailer_details
    FROM customer_vehicles cv;
  `);

  // Remove is_deleted column (only drop if we added it — safe to check)
  const hasCol = await knex.schema.hasColumn('vehicles', 'is_deleted');
  if (hasCol) {
    await knex.schema.table('vehicles', (t) => {
      t.dropColumn('is_deleted');
    });
  }
};
