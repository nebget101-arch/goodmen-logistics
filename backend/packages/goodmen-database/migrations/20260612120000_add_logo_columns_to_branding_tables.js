/**
 * FN-1741: Adds branding-logo storage columns to operating_entities, locations,
 * and tenants. Foundation for the customer-logo branding feature (FN-1737 / epic
 * FN-1736). Each table gets:
 *   - logo_storage_key  (text, null)        R2 object key
 *   - logo_mime_type    (text, null)        e.g. image/png
 *   - logo_uploaded_at  (timestamptz, null) when the current logo was stored
 *
 * Columns are nullable with no default. No data backfill. tenants carries the
 * same columns as a tenant-level fallback for shop invoices.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const BRANDING_TABLES = ['operating_entities', 'locations', 'tenants'];
const LOGO_COLUMNS = ['logo_storage_key', 'logo_mime_type', 'logo_uploaded_at'];

exports.up = async function up(knex) {
  for (const tableName of BRANDING_TABLES) {
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) continue;

    const hasStorageKey = await knex.schema.hasColumn(tableName, 'logo_storage_key');
    if (hasStorageKey) continue;

    await knex.schema.alterTable(tableName, (table) => {
      table.text('logo_storage_key').nullable();
      table.text('logo_mime_type').nullable();
      table.timestamp('logo_uploaded_at', { useTz: true }).nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  for (const tableName of BRANDING_TABLES) {
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) continue;

    const hasStorageKey = await knex.schema.hasColumn(tableName, 'logo_storage_key');
    if (!hasStorageKey) continue;

    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('logo_storage_key');
      table.dropColumn('logo_mime_type');
      table.dropColumn('logo_uploaded_at');
    });
  }
};
