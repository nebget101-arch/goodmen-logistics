#!/usr/bin/env node
/**
 * FN-1683 (Story H / FN-1682) — base; FN-1718 (Story I / FN-1716) — scale to 50.
 * Seed demo tracking trucks + loads.
 *
 * Creates a fleet of dedicated demo trucks and IN_TRANSIT loads whose identifiers
 * are prefixed with `DEMO-TRUCK-` / `DEMO-` so the teardown script can find and
 * remove them unambiguously. These loads drive `demo-tracking-simulator.js`, which
 * writes interpolated pings into `vehicle_position_pings`; Story D's WebSocket
 * broadcast then pushes them to the live map at `/tracking` with NO frontend
 * changes.
 *
 * FN-1718 change vs the original 3–5-load seed: instead of borrowing whatever
 * in-service trucks happen to exist, the seed now MINTS its own demo fleet —
 * `DEMO_TRUCK_COUNT` trucks (default 50), unit numbers `DEMO-TRUCK-001`…`050`,
 * each on its own geographically varied pickup→delivery route. This makes the
 * demo self-contained (no dependence on the DB already having 50 real trucks) and
 * makes teardown exact (delete vehicles whose unit_number starts `DEMO-TRUCK-`).
 *
 * What it does (all idempotent — safe to re-run):
 *   1. Upserts the well-known US route zip codes into `zip_codes` (the simulator
 *      resolves pickup/delivery lat/lng from this table). Existing rows untouched.
 *   2. Resolves a target tenant (see "Tenant" below). The live map is tenant-scoped
 *      on `vehicles.tenant_id`, so the demo trucks MUST belong to the tenant the
 *      presenter logs in as — otherwise the markers never appear.
 *   3. Upserts `DEMO_TRUCK_COUNT` demo trucks (unit `DEMO-TRUCK-NNN`) for that
 *      tenant and one `DEMO-TRUCK-NNN` IN_TRANSIT load each, with PICKUP/DELIVERY
 *      stops on routes spread across the country (not stacked on one corridor).
 *
 * Tenant selection (in priority order):
 *   --tenant=<uuid>           CLI flag
 *   DEMO_TENANT_ID=<uuid>     env var
 *   otherwise                 the tenant that owns the most in-service vehicles
 *   otherwise                 the first tenant in `tenants`
 *   if still none             seeds trucks with NULL tenant_id and prints a loud
 *                             warning (those markers won't show on a scoped map).
 *
 * This script reuses the shared knex client (`goodmen-shared/config/knex`) — the
 * same connection the services use — rather than creating a new DB helper.
 *
 * Usage (from repo root):
 *   node backend/scripts/seed-demo-tracking-loads.js
 *   node backend/scripts/seed-demo-tracking-loads.js --tenant=<uuid> --count=20
 *   DEMO_TRUCK_COUNT=10 node backend/scripts/seed-demo-tracking-loads.js
 *
 * Env: DATABASE_URL (Render Internal Database URL) or the PG_* / DB_* vars the
 * knexfile understands. Loads `.env` / `.env.production` like the sibling scripts.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..');
const repoRoot = path.join(backendDir, '..');
process.chdir(repoRoot);

// Load .env exactly like the other backend/scripts (dotenv resolved from goodmen-shared).
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
  /* dotenv optional — env may already be set (e.g. Render shell) */
}

const knex = require('../packages/goodmen-shared/config/knex');

// Identifiers — both prefixed `DEMO-` so teardown's `DEMO-%` load match still works;
// demo trucks additionally carry the `DEMO-TRUCK-` unit prefix for exact removal.
const DEMO_LOAD_PREFIX = 'DEMO-';
const DEMO_UNIT_PREFIX = 'DEMO-TRUCK-';
const DEMO_VIN_PREFIX = 'DEMOVIN'; // 7 chars; + 10-digit pad = 17 (vin is CHAR(17))

// Single knob for fleet size. CLI --count wins, then DEMO_TRUCK_COUNT, then 50.
const DEFAULT_TRUCK_COUNT = parseInt(process.env.DEMO_TRUCK_COUNT, 10) || 50;

// Well-known US metros with hand-entered downtown coordinates, ordered loosely
// West → Central → South → Midwest → East so the route generator below (which
// jumps across the list) naturally produces long, cross-country legs rather than
// neighbours. Upserted into zip_codes so the simulator can resolve coords on a
// fresh DB. Adding cities here automatically widens the route pool.
const CITIES = [
  { zip: '90012', city: 'Los Angeles', state: 'CA', latitude: 34.0614, longitude: -118.2385 },
  { zip: '92101', city: 'San Diego', state: 'CA', latitude: 32.7174, longitude: -117.1628 },
  { zip: '94103', city: 'San Francisco', state: 'CA', latitude: 37.7726, longitude: -122.4099 },
  { zip: '95814', city: 'Sacramento', state: 'CA', latitude: 38.5816, longitude: -121.4944 },
  { zip: '97204', city: 'Portland', state: 'OR', latitude: 45.5189, longitude: -122.677 },
  { zip: '98101', city: 'Seattle', state: 'WA', latitude: 47.6109, longitude: -122.3358 },
  { zip: '89101', city: 'Las Vegas', state: 'NV', latitude: 36.1716, longitude: -115.1391 },
  { zip: '85004', city: 'Phoenix', state: 'AZ', latitude: 33.4515, longitude: -112.0703 },
  { zip: '84101', city: 'Salt Lake City', state: 'UT', latitude: 40.7608, longitude: -111.891 },
  { zip: '80202', city: 'Denver', state: 'CO', latitude: 39.7525, longitude: -104.9995 },
  { zip: '73102', city: 'Oklahoma City', state: 'OK', latitude: 35.4676, longitude: -97.5164 },
  { zip: '75201', city: 'Dallas', state: 'TX', latitude: 32.7876, longitude: -96.7993 },
  { zip: '78205', city: 'San Antonio', state: 'TX', latitude: 29.4246, longitude: -98.4936 },
  { zip: '78701', city: 'Austin', state: 'TX', latitude: 30.2711, longitude: -97.7437 },
  { zip: '77002', city: 'Houston', state: 'TX', latitude: 29.7589, longitude: -95.3677 },
  { zip: '70112', city: 'New Orleans', state: 'LA', latitude: 29.9584, longitude: -90.0644 },
  { zip: '64106', city: 'Kansas City', state: 'MO', latitude: 39.1015, longitude: -94.576 },
  { zip: '63101', city: 'St. Louis', state: 'MO', latitude: 38.627, longitude: -90.1994 },
  { zip: '55401', city: 'Minneapolis', state: 'MN', latitude: 44.9778, longitude: -93.265 },
  { zip: '53202', city: 'Milwaukee', state: 'WI', latitude: 43.0389, longitude: -87.9065 },
  { zip: '60601', city: 'Chicago', state: 'IL', latitude: 41.8855, longitude: -87.6221 },
  { zip: '46204', city: 'Indianapolis', state: 'IN', latitude: 39.7684, longitude: -86.1581 },
  { zip: '48226', city: 'Detroit', state: 'MI', latitude: 42.3314, longitude: -83.0458 },
  { zip: '43215', city: 'Columbus', state: 'OH', latitude: 39.9612, longitude: -82.9988 },
  { zip: '44114', city: 'Cleveland', state: 'OH', latitude: 41.5051, longitude: -81.6934 },
  { zip: '38103', city: 'Memphis', state: 'TN', latitude: 35.1495, longitude: -90.049 },
  { zip: '37203', city: 'Nashville', state: 'TN', latitude: 36.1561, longitude: -86.7901 },
  { zip: '35203', city: 'Birmingham', state: 'AL', latitude: 33.5207, longitude: -86.8025 },
  { zip: '30303', city: 'Atlanta', state: 'GA', latitude: 33.7527, longitude: -84.3915 },
  { zip: '28202', city: 'Charlotte', state: 'NC', latitude: 35.2271, longitude: -80.8431 },
  { zip: '32202', city: 'Jacksonville', state: 'FL', latitude: 30.3268, longitude: -81.6567 },
  { zip: '32801', city: 'Orlando', state: 'FL', latitude: 28.5421, longitude: -81.379 },
  { zip: '33602', city: 'Tampa', state: 'FL', latitude: 27.9489, longitude: -82.4569 },
  { zip: '33131', city: 'Miami', state: 'FL', latitude: 25.7663, longitude: -80.1917 },
  { zip: '20001', city: 'Washington', state: 'DC', latitude: 38.9101, longitude: -77.0147 },
  { zip: '21201', city: 'Baltimore', state: 'MD', latitude: 39.2904, longitude: -76.6122 },
  { zip: '19103', city: 'Philadelphia', state: 'PA', latitude: 39.9526, longitude: -75.1652 },
  { zip: '15222', city: 'Pittsburgh', state: 'PA', latitude: 40.4406, longitude: -79.9959 },
  { zip: '10001', city: 'New York', state: 'NY', latitude: 40.7506, longitude: -73.9972 },
  { zip: '14202', city: 'Buffalo', state: 'NY', latitude: 42.8864, longitude: -78.8784 },
  { zip: '02108', city: 'Boston', state: 'MA', latitude: 42.3576, longitude: -71.0636 }
];

const ZIP_BY_CODE = Object.fromEntries(CITIES.map((c) => [c.zip, c]));

// A few realistic truck makes/models to cycle through so the demo fleet doesn't
// look copy-pasted. Cosmetic only.
const TRUCK_MODELS = [
  { make: 'Freightliner', model: 'Cascadia' },
  { make: 'Kenworth', model: 'T680' },
  { make: 'Peterbilt', model: '579' },
  { make: 'Volvo', model: 'VNL 760' },
  { make: 'International', model: 'LT' },
  { make: 'Mack', model: 'Anthem' }
];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Build `count` geographically varied routes by pairing cities from CITIES.
 * Multiplying the index by a stride that's coprime with the list length walks the
 * (region-ordered) list in big jumps, so pickup and delivery land in different
 * regions — long, spread-out legs instead of neighbouring cities. Deterministic,
 * so re-running the seed reproduces the same routes for the same load numbers.
 */
function buildRoutes(count) {
  const n = CITIES.length;
  const stride = 17; // coprime with 41; large jumps across the region-ordered list
  const routes = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const pIdx = i % n;
    // Walk the delivery index forward until the (pickup,delivery) pair is unique
    // and not self-referential, so no two trucks share an identical corridor (and
    // sit superimposed on the map). With n·(n-1) possible pairs this never starves
    // for the demo's fleet sizes.
    let dIdx = (i * stride + 7) % n;
    for (let guard = 0; guard < n; guard++) {
      const key = `${pIdx}-${dIdx}`;
      if (dIdx !== pIdx && !seen.has(key)) break;
      dIdx = (dIdx + 1) % n;
    }
    seen.add(`${pIdx}-${dIdx}`);
    routes.push({ pickup: CITIES[pIdx].zip, delivery: CITIES[dIdx].zip });
  }
  return routes;
}

async function upsertZipCodes() {
  const rows = CITIES.map((c) => ({
    zip: c.zip,
    city: c.city,
    state: c.state,
    latitude: c.latitude,
    longitude: c.longitude
  }));
  // These 41 metros have authoritative downtown coords; correct any stale/wrong
  // rows on conflict so demo trucks resolve to real US locations (FN-1718 fix:
  // a pre-existing zip_codes row with bad coords was scattering trucks globally).
  await knex('zip_codes')
    .insert(rows)
    .onConflict('zip')
    .merge(['latitude', 'longitude', 'city', 'state']);
  return rows.length;
}

/**
 * Resolve which tenant the demo trucks/loads should belong to. The live map is
 * tenant-scoped, so this determines which login sees the moving markers.
 */
async function resolveTenantId(args) {
  const explicit = args.tenant || process.env.DEMO_TENANT_ID;
  if (explicit) return { tenantId: explicit, source: 'explicit (--tenant / DEMO_TENANT_ID)' };

  const ranked = await knex('vehicles')
    .whereNotNull('tenant_id')
    .where('status', 'in-service')
    .whereNot('is_deleted', true)
    .groupBy('tenant_id')
    .select('tenant_id')
    .count('* as n')
    .orderBy('n', 'desc')
    .first();
  if (ranked && ranked.tenant_id) {
    return { tenantId: ranked.tenant_id, source: `auto (tenant with most in-service trucks: ${ranked.n})` };
  }

  // No vehicle carries a tenant yet (fresh DB) — fall back to any tenant so the
  // minted demo trucks are at least scoped to a real tenant the presenter can log
  // in as.
  if (await knex.schema.hasTable('tenants')) {
    const t = await knex('tenants').orderBy('created_at', 'asc').select('id').first();
    if (t && t.id) return { tenantId: t.id, source: 'fallback (first tenant in tenants table)' };
  }
  return { tenantId: null, source: 'none (no tenant found)' };
}

/** Active drivers for the tenant, used to populate loads.driver_id (cycled). */
async function pickDrivers(tenantId) {
  const q = knex('drivers').where('status', 'active').orderBy('created_at', 'asc');
  if (tenantId) q.where('tenant_id', tenantId);
  return q.select('id', 'first_name', 'last_name');
}

/** Upsert one demo truck and return its id. Idempotent on unit_number. */
async function upsertDemoTruck(trx, { unitNumber, vin, model, tenantId }) {
  const row = {
    unit_number: unitNumber,
    vin,
    make: model.make,
    model: model.model,
    year: 2023,
    vehicle_type: 'truck',
    status: 'in-service',
    company_owned: true,
    is_deleted: false,
    tenant_id: tenantId,
    updated_at: trx.fn.now()
  };
  const [v] = await trx('vehicles')
    .insert(row)
    .onConflict('unit_number')
    .merge(['status', 'vehicle_type', 'is_deleted', 'tenant_id', 'updated_at'])
    .returning('id');
  return v.id || v;
}

/** Create or refresh one DEMO- load + its two stops. Idempotent on load_number. */
async function upsertDemoLoad(trx, { loadNumber, route, truckId, driver }) {
  const loadRow = {
    load_number: loadNumber,
    status: 'IN_TRANSIT',
    driver_id: driver ? driver.id : null,
    truck_id: truckId,
    broker_name: 'FleetNeuron Demo',
    notes: 'Synthetic demo load for live-tracking demo (FN-1716). Safe to delete via teardown-demo-tracking.js.',
    updated_at: trx.fn.now()
  };

  const [load] = await trx('loads')
    .insert(loadRow)
    .onConflict('load_number')
    .merge(['status', 'driver_id', 'truck_id', 'broker_name', 'notes', 'updated_at'])
    .returning('id');
  const loadId = load.id || load;

  // Rebuild stops deterministically (load_stops has no natural unique key).
  await trx('load_stops').where('load_id', loadId).del();
  await trx('load_stops').insert([
    {
      load_id: loadId,
      stop_type: 'PICKUP',
      sequence: 1,
      zip: route.pickup,
      city: ZIP_BY_CODE[route.pickup].city,
      state: ZIP_BY_CODE[route.pickup].state
    },
    {
      load_id: loadId,
      stop_type: 'DELIVERY',
      sequence: 2,
      zip: route.delivery,
      city: ZIP_BY_CODE[route.delivery].city,
      state: ZIP_BY_CODE[route.delivery].state
    }
  ]);
  return loadId;
}

async function main() {
  const args = parseArgs(process.argv);
  const count = Math.max(1, Math.min(999, parseInt(args.count, 10) || DEFAULT_TRUCK_COUNT));

  console.log('— Demo tracking seed (FN-1716: 50-truck scale) —');
  console.log(`Fleet size: ${count} truck(s)  (override with --count=<n> or DEMO_TRUCK_COUNT)`);

  const zipCount = await upsertZipCodes();
  console.log(`zip_codes: ensured ${zipCount} demo metros exist (existing rows untouched).`);

  const { tenantId, source } = await resolveTenantId(args);
  console.log(`Target tenant: ${tenantId || '(none)'} — ${source}`);
  if (!tenantId) {
    console.warn(
      '⚠  No tenant resolved. The /tracking map is tenant-scoped — these markers will NOT appear ' +
        'until the trucks have a tenant_id. Re-run with --tenant=<uuid> against a real DB for the live demo.'
    );
  }

  const drivers = await pickDrivers(tenantId);
  const routes = buildRoutes(count);
  const created = [];

  await knex.transaction(async (trx) => {
    for (let i = 0; i < count; i++) {
      const seq = String(i + 1).padStart(3, '0'); // 001..NNN
      const unitNumber = `${DEMO_UNIT_PREFIX}${seq}`; // DEMO-TRUCK-001
      const loadNumber = `${DEMO_LOAD_PREFIX}TRUCK-${seq}`; // DEMO-TRUCK-001 (matches DEMO-%)
      const vin = `${DEMO_VIN_PREFIX}${String(i + 1).padStart(10, '0')}`; // 17 chars
      const model = TRUCK_MODELS[i % TRUCK_MODELS.length];
      const route = routes[i];
      const driver = drivers.length ? drivers[i % drivers.length] : null;

      const truckId = await upsertDemoTruck(trx, { unitNumber, vin, model, tenantId });
      await upsertDemoLoad(trx, { loadNumber, route, truckId, driver });

      created.push({
        unitNumber,
        loadNumber,
        route: `${ZIP_BY_CODE[route.pickup].city} → ${ZIP_BY_CODE[route.delivery].city}`,
        driver: driver ? `${driver.first_name} ${driver.last_name}` : '(none)'
      });
    }
  });

  console.log(`\n✓ Seeded ${created.length} demo truck(s) + load(s). Sample:`);
  for (const c of created.slice(0, 5)) {
    console.log(`  ${c.unitNumber}  ${c.route.padEnd(30)} driver=${c.driver}`);
  }
  if (created.length > 5) console.log(`  … and ${created.length - 5} more.`);
  console.log('\nNext: node backend/scripts/demo-tracking-simulator.js   (then open /tracking)');
}

main()
  .catch((err) => {
    console.error('✗ Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
