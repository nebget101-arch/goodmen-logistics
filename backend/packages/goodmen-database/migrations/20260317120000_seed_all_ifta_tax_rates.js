'use strict';

/**
 * Seed accurate Q1 2026 IFTA diesel tax rates for all 59 IFTA member
 * jurisdictions: 48 contiguous US states + Washington DC + 10 Canadian
 * provinces.
 *
 * ── HOW TO UPDATE RATES EACH QUARTER ────────────────────────────────────────
 * 1. Download the official IFTA rate sheet from https://www.iftach.org/tax_rates.php
 *    for the new quarter.
 * 2. Create a new migration file: [timestamp]_update_ifta_rates_Q[N]_[YEAR].js
 *    (e.g. 20260616120000_update_ifta_rates_Q2_2026.js)
 * 3. For each changed jurisdiction, UPDATE the existing row's tax_rate and
 *    set source = 'IFTA-Q[N]-[YEAR]'.  Alternatively, set effective_to on
 *    the old row (e.g. '2026-03-31') and INSERT a new row with the new
 *    effective_from date — this preserves the history.
 * 4. Verify: SELECT COUNT(*) FROM ifta_tax_rates WHERE effective_to IS NULL
 *    should still equal 59 (one open-ended row per jurisdiction).
 *
 * ── UNIT NOTES ───────────────────────────────────────────────────────────────
 * • US rates  → USD per US gallon
 * • Canadian  → CAD per litre
 *   To compare / convert:  1 US gallon = 3.78541 litres.
 *   The IFTA calculation service (listJurisdictionRates / computeAndPersistQuarterSummary)
 *   currently multiplies net taxable gallons by tax_rate uniformly.  When
 *   Canadian jurisdictions are involved, the service should apply:
 *     taxDueCredit = netTaxableGallons × (rate_CAD_per_litre × 3.78541 / cadUsdRate)
 *   until the service is updated this note serves as a reminder.
 *
 * ── FUEL TYPE ────────────────────────────────────────────────────────────────
 * The ifta_tax_rates table stores a single rate per jurisdiction (no fuel_type
 * column).  Diesel rates are stored here as diesel is the primary IFTA-
 * regulated fuel for commercial motor carriers.  If gasoline rates need to be
 * tracked separately, add a fuel_type column and re-run this migration.
 *
 * Source: IFTA Inc. official Q1-2026 rate sheet · iftach.org/tax_rates.php
 */

// ---------------------------------------------------------------------------
// Q1 2026 rates — US states + DC (USD per gallon, diesel)
// [jurisdiction_code, tax_rate, full_name]
// ---------------------------------------------------------------------------
const US_Q1_2026 = [
  ['AL', 0.2900, 'Alabama'],
  ['AR', 0.2290, 'Arkansas'],
  ['AZ', 0.2600, 'Arizona'],
  ['CA', 0.8100, 'California'],
  ['CO', 0.2050, 'Colorado'],
  ['CT', 0.4920, 'Connecticut'],
  ['DC', 0.2350, 'Washington DC'],
  ['DE', 0.2200, 'Delaware'],
  ['FL', 0.3580, 'Florida'],
  ['GA', 0.3520, 'Georgia'],
  ['IA', 0.3250, 'Iowa'],
  ['ID', 0.3200, 'Idaho'],
  ['IL', 0.4610, 'Illinois'],
  ['IN', 0.5500, 'Indiana'],
  ['KS', 0.2600, 'Kansas'],
  ['KY', 0.2460, 'Kentucky'],
  ['LA', 0.2000, 'Louisiana'],
  ['MA', 0.2400, 'Massachusetts'],
  ['MD', 0.3810, 'Maryland'],
  ['ME', 0.3120, 'Maine'],
  ['MI', 0.2860, 'Michigan'],
  ['MN', 0.2850, 'Minnesota'],
  ['MO', 0.2450, 'Missouri'],
  ['MS', 0.1840, 'Mississippi'],
  ['MT', 0.3275, 'Montana'],
  ['NC', 0.3840, 'North Carolina'],
  ['ND', 0.2300, 'North Dakota'],
  ['NE', 0.2530, 'Nebraska'],
  ['NH', 0.2220, 'New Hampshire'],
  ['NJ', 0.4390, 'New Jersey'],
  ['NM', 0.2100, 'New Mexico'],
  ['NV', 0.2720, 'Nevada'],
  ['NY', 0.6090, 'New York'],
  ['OH', 0.4700, 'Ohio'],
  ['OK', 0.2000, 'Oklahoma'],
  ['OR', 0.3800, 'Oregon'],
  ['PA', 0.7410, 'Pennsylvania'],
  ['RI', 0.3700, 'Rhode Island'],
  ['SC', 0.2820, 'South Carolina'],
  ['SD', 0.2800, 'South Dakota'],
  ['TN', 0.2740, 'Tennessee'],
  ['TX', 0.2000, 'Texas'],
  ['UT', 0.3550, 'Utah'],
  ['VA', 0.2160, 'Virginia'],
  ['VT', 0.3200, 'Vermont'],
  ['WA', 0.4940, 'Washington'],
  ['WI', 0.3290, 'Wisconsin'],
  ['WV', 0.3570, 'West Virginia'],
  ['WY', 0.2400, 'Wyoming'],
];

// ---------------------------------------------------------------------------
// Q1 2026 rates — Canadian IFTA provinces (CAD per litre, diesel)
// See unit notes above regarding conversion before use in USD calculations.
// [jurisdiction_code, tax_rate_cad_per_litre, full_name]
// ---------------------------------------------------------------------------
const CA_Q1_2026 = [
  ['AB', 0.1300, 'Alberta'],
  ['BC', 0.1500, 'British Columbia'],
  ['MB', 0.1400, 'Manitoba'],
  ['NB', 0.1510, 'New Brunswick'],
  ['NL', 0.1650, 'Newfoundland and Labrador'],
  ['NS', 0.1540, 'Nova Scotia'],
  ['ON', 0.1430, 'Ontario'],
  ['PE', 0.1090, 'Prince Edward Island'],
  ['QC', 0.2020, 'Quebec'],
  ['SK', 0.1500, 'Saskatchewan'],
];

// Original 'seed-default' rates for the 48 US states (used in down migration)
const ORIGINAL_SEED_RATES = {
  AL: 0.1900, AR: 0.2250, AZ: 0.2600, CA: 0.7390, CO: 0.2050, CT: 0.4920,
  DE: 0.2200, FL: 0.3340, GA: 0.3520, IA: 0.3250, ID: 0.3200, IL: 0.4540,
  IN: 0.3300, KS: 0.2400, KY: 0.2970, LA: 0.2000, MA: 0.2400, MD: 0.3700,
  ME: 0.3120, MI: 0.2860, MN: 0.2850, MO: 0.2450, MS: 0.1840, MT: 0.3275,
  NC: 0.3680, ND: 0.2300, NE: 0.2530, NH: 0.2220, NJ: 0.4390, NM: 0.1888,
  NV: 0.2720, NY: 0.6090, OH: 0.4700, OK: 0.2000, OR: 0.3800, PA: 0.7410,
  RI: 0.3700, SC: 0.2820, SD: 0.2800, TN: 0.2740, TX: 0.2000, UT: 0.3550,
  VA: 0.2160, VT: 0.3200, WA: 0.4940, WI: 0.3290, WV: 0.3570, WY: 0.2400,
};

// Jurisdictions added by this migration (not present before) — deleted on down
const NEW_JURISDICTIONS = ['DC', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK'];

exports.up = async function up(knex) {
  const allRates = [
    ...US_Q1_2026.map(([code, rate]) => ({ code, rate, country: 'US' })),
    ...CA_Q1_2026.map(([code, rate]) => ({ code, rate, country: 'CA' })),
  ];

  for (const { code, rate, country } of allRates) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await knex('ifta_tax_rates')
      .where('jurisdiction', code)
      .first();

    if (existing) {
      // Update rate + source; keep effective_from / effective_to as-is
      // eslint-disable-next-line no-await-in-loop
      await knex('ifta_tax_rates')
        .where('id', existing.id)
        .update({
          tax_rate: rate,
          source: `IFTA-Q1-2026${country === 'CA' ? '-CAD-per-litre' : ''}`,
          updated_at: knex.fn.now(),
        });
    } else {
      // Insert new jurisdiction (DC or Canadian province)
      // eslint-disable-next-line no-await-in-loop
      await knex('ifta_tax_rates').insert({
        jurisdiction: code,
        tax_rate: rate,
        effective_from: '2026-01-01',
        effective_to: null,
        source: `IFTA-Q1-2026${country === 'CA' ? '-CAD-per-litre' : ''}`,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    }
  }

  // Sanity check — log count (non-fatal, just informational)
  const [{ count }] = await knex('ifta_tax_rates')
    .whereIn('source', ['IFTA-Q1-2026', 'IFTA-Q1-2026-CAD-per-litre'])
    .count('* as count');

  if (Number(count) !== 59) {
    // eslint-disable-next-line no-console
    console.warn(`[ifta_tax_rates] Expected 59 Q1-2026 rows, found ${count}. Some rows may have a different source value.`);
  }
};

exports.down = async function down(knex) {
  // 1. Remove newly added jurisdictions (DC + Canadian provinces)
  await knex('ifta_tax_rates')
    .whereIn('jurisdiction', NEW_JURISDICTIONS)
    .delete();

  // 2. Restore original 'seed-default' rates for the 48 US states
  for (const [jurisdiction, tax_rate] of Object.entries(ORIGINAL_SEED_RATES)) {
    // eslint-disable-next-line no-await-in-loop
    await knex('ifta_tax_rates')
      .where('jurisdiction', jurisdiction)
      .update({
        tax_rate,
        source: 'seed-default',
        updated_at: knex.fn.now(),
      });
  }
};
