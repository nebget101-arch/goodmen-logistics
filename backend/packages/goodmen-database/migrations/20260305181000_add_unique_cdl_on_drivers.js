/**
 * Add unique(cdl_number, cdl_state) on drivers.
 *
 * Safety guard:
 * - Aborts if duplicates exist and logs them with a clear error message.
 */

exports.up = async function up(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  if (!hasDrivers) return;

  // Check for duplicate (cdl_number, cdl_state) combinations ignoring nulls
  const duplicates = await knex.raw(`
    SELECT cdl_number, cdl_state, COUNT(*) AS count
    FROM drivers
    WHERE cdl_number IS NOT NULL
      AND cdl_state IS NOT NULL
    GROUP BY cdl_number, cdl_state
    HAVING COUNT(*) > 1
  `);

  if (duplicates.rows.length > 0) {
    // eslint-disable-next-line no-console
    console.error('❌ Cannot add unique(cdl_number, cdl_state) on drivers due to duplicates:');
    // eslint-disable-next-line no-console
    duplicates.rows.forEach((row) => {
      console.error(
        `  CDL ${row.cdl_number} / ${row.cdl_state} appears ${row.count} times in drivers table`
      );
    });
    throw new Error(
      'Duplicate driver CDL records detected. Resolve duplicates before adding unique(cdl_number, cdl_state).'
    );
  }

  // Add composite unique index if it doesn't already exist
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'drivers_cdl_number_cdl_state_unique'
      ) THEN
        CREATE UNIQUE INDEX drivers_cdl_number_cdl_state_unique
          ON drivers (cdl_number, cdl_state);
      END IF;
    END
    $$;
  `);
};

exports.down = async function down(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  if (!hasDrivers) return;

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'drivers_cdl_number_cdl_state_unique'
      ) THEN
        DROP INDEX drivers_cdl_number_cdl_state_unique;
      END IF;
    END
    $$;
  `);
};

