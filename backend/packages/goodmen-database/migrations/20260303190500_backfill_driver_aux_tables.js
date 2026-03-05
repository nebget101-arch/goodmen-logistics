/**
 * Backfill driver_licenses and driver_compliance from legacy drivers table.
 * Captures duplicate legacy CDL records into driver_license_conflicts.
 *
 * Safe to re-run using ON CONFLICT / NOT EXISTS guards.
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  const hasLicenses = await knex.schema.hasTable('driver_licenses');
  const hasCompliance = await knex.schema.hasTable('driver_compliance');

  if (!hasDrivers || !hasLicenses || !hasCompliance) {
    return;
  }

  // 1) Create conflict table if missing
  const hasConflicts = await knex.schema.hasTable('driver_license_conflicts');
  if (!hasConflicts) {
    await knex.schema.createTable('driver_license_conflicts', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table
        .uuid('driver_id')
        .notNullable()
        .references('id')
        .inTable('drivers')
        .onDelete('CASCADE');
      table.text('cdl_state').notNullable();
      table.text('cdl_number').notNullable();
      table.text('reason').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 2) Backfill driver_licenses from legacy drivers
  // Normalize CDL state/number and deterministically pick the earliest created_at per pair.
  // NOTE: endorsements in legacy schema is TEXT[]; we STRING_AGG them into a comma-separated string.
  await knex.raw(`
    WITH ranked AS (
      SELECT
        d.id AS driver_id,
        UPPER(TRIM(d.cdl_state)) AS norm_state,
        REGEXP_REPLACE(TRIM(d.cdl_number), '\\s+', '', 'g') AS norm_number,
        d.cdl_class,
        d.cdl_expiry,
        array_to_string(d.endorsements, ',') AS endorsements_str,
        d.created_at,
        ROW_NUMBER() OVER (
          PARTITION BY
            UPPER(TRIM(d.cdl_state)),
            REGEXP_REPLACE(TRIM(d.cdl_number), '\\s+', '', 'g')
          ORDER BY d.created_at ASC, d.id ASC
        ) AS rn
      FROM drivers d
      WHERE d.cdl_number IS NOT NULL
        AND d.cdl_state IS NOT NULL
    )
    INSERT INTO driver_licenses (
      driver_id,
      cdl_state,
      cdl_number,
      cdl_class,
      endorsements,
      cdl_expiry
    )
    SELECT
      r.driver_id,
      r.norm_state,
      r.norm_number,
      r.cdl_class,
      r.endorsements_str,
      r.cdl_expiry
    FROM ranked r
    WHERE r.rn = 1
      AND NOT EXISTS (
        SELECT 1
        FROM driver_licenses dl
        WHERE dl.driver_id = r.driver_id
      )
    ON CONFLICT (driver_id) DO NOTHING
  `);

  // 3) Capture legacy duplicates into driver_license_conflicts
  await knex.raw(`
    WITH ranked AS (
      SELECT
        d.id AS driver_id,
        UPPER(TRIM(d.cdl_state)) AS norm_state,
        REGEXP_REPLACE(TRIM(d.cdl_number), '\\s+', '', 'g') AS norm_number,
        d.created_at,
        ROW_NUMBER() OVER (
          PARTITION BY
            UPPER(TRIM(d.cdl_state)),
            REGEXP_REPLACE(TRIM(d.cdl_number), '\\s+', '', 'g')
          ORDER BY d.created_at ASC, d.id ASC
        ) AS rn
      FROM drivers d
      WHERE d.cdl_number IS NOT NULL
        AND d.cdl_state IS NOT NULL
    )
    INSERT INTO driver_license_conflicts (
      driver_id,
      cdl_state,
      cdl_number,
      reason
    )
    SELECT
      r.driver_id,
      r.norm_state,
      r.norm_number,
      'duplicate legacy CDL combination'
    FROM ranked r
    WHERE r.rn > 1
      AND NOT EXISTS (
        SELECT 1
        FROM driver_license_conflicts c
        WHERE c.driver_id = r.driver_id
          AND c.cdl_state = r.norm_state
          AND c.cdl_number = r.norm_number
      )
  `);

  // 4) Backfill driver_compliance from legacy drivers
  await knex.raw(`
    INSERT INTO driver_compliance (
      driver_id,
      medical_cert_expiry,
      last_mvr_check,
      clearinghouse_status
    )
    SELECT
      d.id,
      d.medical_cert_expiry,
      d.last_mvr_check,
      COALESCE(NULLIF(TRIM(d.clearinghouse_status), ''), 'unknown')
    FROM drivers d
    WHERE NOT EXISTS (
      SELECT 1
      FROM driver_compliance dc
      WHERE dc.driver_id = d.id
    )
    ON CONFLICT (driver_id) DO NOTHING
  `);
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down() {
  // This backfill is intentionally irreversible to avoid accidental data loss.
  // No-op on downgrade.
};

