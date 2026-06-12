#!/usr/bin/env node
/**
 * FN-1683 (Story H / FN-1682) — base; FN-1718 (Story I / FN-1716) — also remove
 * the minted demo trucks. Teardown demo tracking data.
 *
 * Removes everything the demo seed + simulator created, and NOTHING else, in one
 * transaction so there are no orphans on a partial failure:
 *   1. Deletes `vehicle_position_pings` written by the simulator
 *      (source_event_id = 'demo-sim') for the demo trucks. Scoping by
 *      source_event_id means real telematics pings are left intact.
 *   2. Deletes the `DEMO-` loads + their `load_stops`.
 *   3. Deletes the minted demo trucks (unit_number `DEMO-TRUCK-%`). This MUST come
 *      after the loads, since `loads.truck_id` references `vehicles` (ON DELETE
 *      RESTRICT) — deleting the loads first frees the trucks. Pre-FN-1718 demo
 *      loads that borrowed real trucks have no `DEMO-TRUCK-` vehicles, so those
 *      real trucks are correctly left untouched.
 *
 * It does NOT touch the `zip_codes` rows the seed upserted — those are harmless
 * reference data and may overlap with real zips.
 *
 * Usage (from repo root):
 *   node backend/scripts/teardown-demo-tracking.js
 *
 * Env: DATABASE_URL or PG_* / DB_* vars (same as the seed/simulator).
 */

'use strict';

const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..');
const repoRoot = path.join(backendDir, '..');
process.chdir(repoRoot);

try {
  const dotenvPath = require.resolve('dotenv', {
    paths: [path.join(backendDir, 'packages', 'goodmen-shared')]
  });
  const dotenv = require(dotenvPath);
  const envFile =
    process.env.NODE_ENV === 'production' && fs.existsSync(path.join(repoRoot, '.env.production'))
      ? path.join(repoRoot, '.env.production')
      : path.join(repoRoot, '.env');
  dotenv.config({ path: envFile });
} catch (_) {
  /* dotenv optional */
}

const knex = require('../packages/goodmen-shared/config/knex');

const DEMO_PREFIX = 'DEMO-';
const DEMO_UNIT_PREFIX = 'DEMO-TRUCK-';
const SOURCE_EVENT_ID = 'demo-sim';

async function main() {
  console.log('— Demo tracking teardown (FN-1716: 50-truck scale) —');

  const loads = await knex('loads')
    .where('load_number', 'like', `${DEMO_PREFIX}%`)
    .select('id', 'load_number', 'truck_id');

  // Minted demo trucks (FN-1718). Discovered independently of loads so they're
  // still cleaned up even if their loads were already removed.
  const demoTrucks = await knex('vehicles')
    .where('unit_number', 'like', `${DEMO_UNIT_PREFIX}%`)
    .select('id', 'unit_number');

  if (loads.length === 0 && demoTrucks.length === 0) {
    console.log('Nothing to remove — no DEMO- loads or DEMO-TRUCK- vehicles found.');
    return;
  }

  const loadIds = loads.map((l) => l.id);
  // Pings to purge: any demo truck, plus the trucks borrowed by pre-FN-1718 demo
  // loads (scoped to source_event_id='demo-sim', so real pings are untouched).
  const vehicleIds = [
    ...new Set([
      ...demoTrucks.map((v) => v.id),
      ...loads.map((l) => l.truck_id).filter(Boolean)
    ])
  ];

  let pingsDeleted = 0;
  let stopsDeleted = 0;
  let loadsDeleted = 0;
  let trucksDeleted = 0;

  await knex.transaction(async (trx) => {
    if (vehicleIds.length) {
      pingsDeleted = await trx('vehicle_position_pings')
        .whereIn('vehicle_id', vehicleIds)
        .where('source_event_id', SOURCE_EVENT_ID)
        .del();
    }
    if (loadIds.length) {
      stopsDeleted = await trx('load_stops').whereIn('load_id', loadIds).del();
      loadsDeleted = await trx('loads').whereIn('id', loadIds).del();
    }
    // Trucks last — loads.truck_id (ON DELETE RESTRICT) is now cleared.
    if (demoTrucks.length) {
      trucksDeleted = await trx('vehicles')
        .whereIn('id', demoTrucks.map((v) => v.id))
        .del();
    }
  });

  console.log('\n✓ Removed:');
  console.log(`  ${loadsDeleted} demo load(s)`);
  console.log(`  ${stopsDeleted} load stop(s)`);
  console.log(`  ${pingsDeleted} demo ping(s) (source_event_id='${SOURCE_EVENT_ID}')`);
  console.log(`  ${trucksDeleted} demo truck(s) (unit_number '${DEMO_UNIT_PREFIX}%')`);
  console.log('\nzip_codes left untouched (reference data).');
}

main()
  .catch((err) => {
    console.error('✗ Teardown failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
