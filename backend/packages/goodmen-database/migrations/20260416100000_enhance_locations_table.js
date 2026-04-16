/**
 * FN-686 — Enhance locations table (fields + location_type CHECK)
 *
 * Up:
 *   1. Add 8 new columns (city, state, zip, phone, email, contact_name,
 *      timezone, operating_hours) where they don't already exist.
 *   2. Backfill location_type: uppercase existing values and map to the
 *      nearest valid enum or NULL. Log any unmapped values.
 *   3. Add CHECK constraint on location_type after backfill so existing
 *      data never violates it.
 *
 * Down:
 *   Drop the CHECK constraint then drop the 8 added columns.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const VALID_TYPES = ['SHOP', 'YARD', 'DROP_YARD', 'WAREHOUSE', 'OFFICE', 'TERMINAL'];

/**
 * Mapping from common free-text values to the nearest valid type.
 * Keys are uppercase.
 */
const TYPE_MAP = {
  SHOP: 'SHOP',
  'REPAIR SHOP': 'SHOP',
  'SERVICE CENTER': 'SHOP',
  YARD: 'YARD',
  'TRUCK YARD': 'YARD',
  'DROP YARD': 'DROP_YARD',
  DROPYARD: 'DROP_YARD',
  'DROP LOT': 'DROP_YARD',
  WAREHOUSE: 'WAREHOUSE',
  STORAGE: 'WAREHOUSE',
  OFFICE: 'OFFICE',
  HEADQUARTERS: 'OFFICE',
  HQ: 'OFFICE',
  TERMINAL: 'TERMINAL',
  'FREIGHT TERMINAL': 'TERMINAL',
};

exports.up = async function (knex) {
  // ── 1. Add new columns idempotently ────────────────────────────────────────
  const addCol = async (col, builder) => {
    const exists = await knex.schema.hasColumn('locations', col);
    if (!exists) {
      await knex.schema.alterTable('locations', (t) => builder(t));
    }
  };

  await addCol('city',           (t) => t.string('city', 100));
  await addCol('state',          (t) => t.string('state', 50));
  await addCol('zip',            (t) => t.string('zip', 20));
  await addCol('phone',          (t) => t.string('phone', 30));
  await addCol('email',          (t) => t.string('email', 255));
  await addCol('contact_name',   (t) => t.string('contact_name', 255));
  await addCol('timezone',       (t) => t.string('timezone', 100).defaultTo('America/New_York'));
  await addCol('operating_hours',(t) => t.jsonb('operating_hours'));

  // ── 2. Backfill location_type (idempotent) ──────────────────────────────────
  const hasLocationType = await knex.schema.hasColumn('locations', 'location_type');
  if (hasLocationType) {
    const rows = await knex('locations').select('id', 'location_type').whereNotNull('location_type');

    const unmapped = [];

    for (const row of rows) {
      const raw = (row.location_type || '').trim().toUpperCase();
      const mapped = TYPE_MAP[raw] || (VALID_TYPES.includes(raw) ? raw : null);

      if (mapped !== row.location_type) {
        if (mapped === null) {
          unmapped.push({ id: row.id, original: row.location_type });
        }
        await knex('locations').where('id', row.id).update({ location_type: mapped });
      }
    }

    if (unmapped.length > 0) {
      console.warn(
        `[FN-686] ${unmapped.length} location_type value(s) could not be mapped to a valid type and were set to NULL:`,
        unmapped.map((r) => `id=${r.id} original="${r.original}"`).join(', ')
      );
    }
  }

  // ── 3. Add CHECK constraint (after backfill, so existing data is clean) ─────
  // Use raw so we can give it a stable name for the down migration.
  await knex.raw(`
    ALTER TABLE locations
    DROP CONSTRAINT IF EXISTS locations_location_type_check
  `);
  await knex.raw(`
    ALTER TABLE locations
    ADD CONSTRAINT locations_location_type_check
    CHECK (location_type IS NULL OR location_type IN (
      'SHOP', 'YARD', 'DROP_YARD', 'WAREHOUSE', 'OFFICE', 'TERMINAL'
    ))
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // Drop the CHECK constraint first
  await knex.raw(`
    ALTER TABLE locations
    DROP CONSTRAINT IF EXISTS locations_location_type_check
  `);

  // Drop the 8 added columns if they exist
  const dropCol = async (col) => {
    const exists = await knex.schema.hasColumn('locations', col);
    if (exists) {
      await knex.schema.alterTable('locations', (t) => t.dropColumn(col));
    }
  };

  await dropCol('operating_hours');
  await dropCol('timezone');
  await dropCol('contact_name');
  await dropCol('email');
  await dropCol('phone');
  await dropCol('zip');
  await dropCol('state');
  await dropCol('city');
};
