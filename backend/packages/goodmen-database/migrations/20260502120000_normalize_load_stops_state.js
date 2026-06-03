'use strict';

/**
 * FN-1050: Backfill load_stops.state to 2-letter uppercase codes.
 *
 * Idempotent: only updates rows where `state` is non-null and not already
 * a valid 2-letter code. Re-running on a clean DB is a no-op.
 *
 * Mapping mirrors backend/packages/goodmen-shared/utils/state-code.js.
 * Keep this list in sync if states are added (none expected). Inlined here
 * so the migration is self-contained — it must run on environments that
 * may not have the shared package available at migrate time.
 */

const STATE_NAME_TO_CODE = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR',
  CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI',
  IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME',
  MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE',
  NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM',
  'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH',
  OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX',
  UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
};

const VALID_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

function normalize(input) {
  if (input == null || typeof input !== 'string') return null;
  const cleaned = input.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!cleaned) return null;
  if (cleaned.length === 2 && VALID_CODES.has(cleaned)) return cleaned;
  if (Object.prototype.hasOwnProperty.call(STATE_NAME_TO_CODE, cleaned)) {
    return STATE_NAME_TO_CODE[cleaned];
  }
  return null;
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('load_stops');
  if (!hasTable) return;

  // Pull only rows that need work: state is non-null AND is not already an
  // uppercase 2-letter code. Avoids loading clean rows.
  const rows = await knex('load_stops')
    .select('id', 'state')
    .whereNotNull('state')
    .andWhere(function () {
      this.whereRaw('LENGTH(state) <> 2').orWhereRaw('state <> UPPER(state)');
    });

  let updated = 0;
  let cleared = 0;
  for (const row of rows) {
    const normalized = normalize(row.state);
    if (normalized === row.state) continue;
    await knex('load_stops').where({ id: row.id }).update({ state: normalized });
    if (normalized === null) cleared += 1;
    else updated += 1;
  }
  console.log(`[FN-1050] load_stops.state backfill: ${updated} normalized, ${cleared} cleared (unrecognized).`);
};

exports.down = async function down() {
  // Backfill is one-way — we cannot reconstruct the original casing or
  // full-name strings from a 2-letter code.
};
