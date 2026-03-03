/**
 * Final cleanup for legacy CDL / compliance columns on drivers.
 *
 * This migration is SAFE by default: it only drops columns when the
 * environment variable DROP_LEGACY_DRIVER_COLUMNS is explicitly set to 'true'.
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  if (!hasDrivers) return;

  const shouldDrop =
    (process.env.DROP_LEGACY_DRIVER_COLUMNS || '').toString().toLowerCase() === 'true';
  if (!shouldDrop) {
    // Leave legacy columns in place until explicitly enabled.
    return;
  }

  const dropColumnIfExists = async (columnName) => {
    const hasCol = await knex.schema.hasColumn('drivers', columnName);
    if (hasCol) {
      await knex.schema.alterTable('drivers', (table) => {
        table.dropColumn(columnName);
      });
    }
  };

  await dropColumnIfExists('cdl_number');
  await dropColumnIfExists('cdl_state');
  await dropColumnIfExists('cdl_class');
  await dropColumnIfExists('endorsements');
  await dropColumnIfExists('cdl_expiry');
  await dropColumnIfExists('medical_cert_expiry');
  await dropColumnIfExists('last_mvr_check');
  await dropColumnIfExists('clearinghouse_status');
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down() {
  // Non-reversible: columns and their data are dropped in up-phase only
  // when explicitly enabled; we do not attempt to recreate them.
};

