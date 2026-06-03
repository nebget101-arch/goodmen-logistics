#!/usr/bin/env node
/**
 * FN-1683 (Story H / FN-1682) — Teardown demo tracking data.
 *
 * Removes everything the demo seed + simulator created, and NOTHING else:
 *   1. Deletes `vehicle_position_pings` written by the simulator
 *      (source_event_id = 'demo-sim') for the trucks assigned to `DEMO-` loads.
 *      Scoping by source_event_id means real telematics pings for the same truck
 *      are left intact.
 *   2. Deletes the `DEMO-` loads. Their `load_stops` are removed automatically by
 *      the ON DELETE CASCADE foreign key (deleted explicitly too, for a clean
 *      count in the summary and in case the FK ever changes).
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
const SOURCE_EVENT_ID = 'demo-sim';

async function main() {
  console.log('— Demo tracking teardown (FN-1683) —');

  const loads = await knex('loads')
    .where('load_number', 'like', `${DEMO_PREFIX}%`)
    .select('id', 'load_number', 'truck_id');

  if (loads.length === 0) {
    console.log('Nothing to remove — no DEMO- loads found.');
    return;
  }

  const loadIds = loads.map((l) => l.id);
  const vehicleIds = [...new Set(loads.map((l) => l.truck_id).filter(Boolean))];

  let pingsDeleted = 0;
  if (vehicleIds.length) {
    pingsDeleted = await knex('vehicle_position_pings')
      .whereIn('vehicle_id', vehicleIds)
      .where('source_event_id', SOURCE_EVENT_ID)
      .del();
  }

  const stopsDeleted = await knex('load_stops').whereIn('load_id', loadIds).del();
  const loadsDeleted = await knex('loads').whereIn('id', loadIds).del();

  console.log('\n✓ Removed:');
  console.log(`  ${loadsDeleted} demo load(s): ${loads.map((l) => l.load_number).join(', ')}`);
  console.log(`  ${stopsDeleted} load stop(s)`);
  console.log(`  ${pingsDeleted} demo ping(s) (source_event_id='${SOURCE_EVENT_ID}')`);
  console.log('\nzip_codes left untouched (reference data).');
}

main()
  .catch((err) => {
    console.error('✗ Teardown failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
