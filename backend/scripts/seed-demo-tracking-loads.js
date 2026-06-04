#!/usr/bin/env node
/**
 * FN-1683 (Story H / FN-1682) — Seed demo tracking loads.
 *
 * Creates a handful of IN_TRANSIT loads whose `load_number` is prefixed with
 * `DEMO-` so the teardown script can find and remove them unambiguously. These
 * loads drive `demo-tracking-simulator.js`, which writes interpolated pings into
 * `vehicle_position_pings`; Story D's WebSocket broadcast then pushes them to the
 * live map at `/tracking` with NO frontend changes.
 *
 * What it does (all idempotent — safe to re-run):
 *   1. Upserts the well-known US zip codes used by the demo routes into
 *      `zip_codes` (the table ships empty on a fresh DB, and the simulator
 *      resolves pickup/delivery lat/lng from it). Existing rows are left alone.
 *   2. Resolves a target tenant (see "Tenant" below) and picks in-service trucks
 *      + active drivers belonging to it. The live map is tenant-scoped on
 *      `vehicles.tenant_id`, so the demo trucks MUST belong to the tenant the
 *      presenter logs in as — otherwise the markers never appear.
 *   3. Creates/refreshes the `DEMO-` loads (IN_TRANSIT) and their PICKUP/DELIVERY
 *      stops at the route zips.
 *
 * Tenant selection (in priority order):
 *   --tenant=<uuid>           CLI flag
 *   DEMO_TENANT_ID=<uuid>     env var
 *   otherwise                 the tenant that owns the most in-service vehicles
 *   if no vehicle has a tenant_id   falls back to in-service vehicles regardless
 *                                   of tenant and prints a loud warning (those
 *                                   markers won't show on a tenant-scoped map).
 *
 * This script reuses the shared knex client (`goodmen-shared/config/knex`) — the
 * same connection the services use — rather than creating a new DB helper.
 *
 * Usage (from repo root):
 *   node backend/scripts/seed-demo-tracking-loads.js
 *   node backend/scripts/seed-demo-tracking-loads.js --tenant=<uuid> --count=4
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

const DEMO_PREFIX = 'DEMO-';

// Well-known US zip codes with hand-entered coordinates. Upserted into zip_codes
// so the simulator can resolve pickup/delivery lat/lng even on a fresh DB.
const ZIP_CODES = {
  '60601': { city: 'Chicago', state: 'IL', latitude: 41.8855, longitude: -87.6221 },
  '75201': { city: 'Dallas', state: 'TX', latitude: 32.7876, longitude: -96.7993 },
  '30303': { city: 'Atlanta', state: 'GA', latitude: 33.7527, longitude: -84.3915 },
  '33131': { city: 'Miami', state: 'FL', latitude: 25.7663, longitude: -80.1917 },
  '90012': { city: 'Los Angeles', state: 'CA', latitude: 34.0614, longitude: -118.2385 },
  '85004': { city: 'Phoenix', state: 'AZ', latitude: 33.4515, longitude: -112.0703 },
  '10001': { city: 'New York', state: 'NY', latitude: 40.7506, longitude: -73.9972 },
  '98101': { city: 'Seattle', state: 'WA', latitude: 47.6109, longitude: -122.3358 },
  '80202': { city: 'Denver', state: 'CO', latitude: 39.7525, longitude: -104.9995 },
  '64106': { city: 'Kansas City', state: 'MO', latitude: 39.1015, longitude: -94.5760 }
};

// Demo routes (pickup zip → delivery zip). The seed creates `--count` of these
// (default = all five), one DEMO- load each.
const ROUTES = [
  { suffix: '0001', pickup: '60601', delivery: '75201' }, // Chicago → Dallas
  { suffix: '0002', pickup: '30303', delivery: '33131' }, // Atlanta → Miami
  { suffix: '0003', pickup: '90012', delivery: '85004' }, // Los Angeles → Phoenix
  { suffix: '0004', pickup: '98101', delivery: '80202' }, // Seattle → Denver
  { suffix: '0005', pickup: '90012', delivery: '10001' }  // Los Angeles → New York (coast-to-coast)
];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function upsertZipCodes() {
  const rows = Object.entries(ZIP_CODES).map(([zip, z]) => ({
    zip,
    city: z.city,
    state: z.state,
    latitude: z.latitude,
    longitude: z.longitude
  }));
  // Don't clobber real zip data if it already exists — only insert what's missing.
  await knex('zip_codes').insert(rows).onConflict('zip').ignore();
  return rows.length;
}

/**
 * Resolve which tenant's trucks/drivers the demo loads should use. The live map
 * is tenant-scoped, so this determines which login sees the moving markers.
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
  return { tenantId: null, source: 'none (no in-service vehicle has a tenant_id)' };
}

/** Pick up to `count` in-service trucks for the tenant, with a driver each. */
async function pickFleet(tenantId, count) {
  const vehicleQuery = knex('vehicles')
    .where('status', 'in-service')
    .whereNot('is_deleted', true)
    .where('vehicle_type', 'truck')
    .orderBy('unit_number', 'asc')
    .limit(count)
    .select('id', 'unit_number', 'tenant_id', 'leased_driver_id');
  if (tenantId) vehicleQuery.where('tenant_id', tenantId);

  let trucks = await vehicleQuery;

  // Fallback: a fresh seed.sql DB has trucks but no tenant_id. Use them anyway so
  // the seed is runnable locally; warn that they may be invisible on the map.
  if (trucks.length === 0 && tenantId === null) {
    trucks = await knex('vehicles')
      .where('status', 'in-service')
      .whereNot('is_deleted', true)
      .orderBy('unit_number', 'asc')
      .limit(count)
      .select('id', 'unit_number', 'tenant_id', 'leased_driver_id');
  }

  // Active drivers for the tenant (to populate loads.driver_id).
  const driverQuery = knex('drivers').where('status', 'active').orderBy('created_at', 'asc');
  if (tenantId) driverQuery.where('tenant_id', tenantId);
  const drivers = await driverQuery.select('id', 'first_name', 'last_name');

  return { trucks, drivers };
}

/** Create or refresh one DEMO- load + its two stops inside a transaction. */
async function upsertDemoLoad(trx, { loadNumber, route, truck, driver }) {
  const loadRow = {
    load_number: loadNumber,
    status: 'IN_TRANSIT',
    driver_id: driver ? driver.id : null,
    truck_id: truck ? truck.id : null,
    broker_name: 'FleetNeuron Demo',
    notes: 'Synthetic demo load for live-tracking demo (FN-1682). Safe to delete via teardown-demo-tracking.js.',
    updated_at: trx.fn.now()
  };

  // Idempotent upsert on the unique load_number.
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
      city: ZIP_CODES[route.pickup].city,
      state: ZIP_CODES[route.pickup].state
    },
    {
      load_id: loadId,
      stop_type: 'DELIVERY',
      sequence: 2,
      zip: route.delivery,
      city: ZIP_CODES[route.delivery].city,
      state: ZIP_CODES[route.delivery].state
    }
  ]);

  return loadId;
}

async function main() {
  const args = parseArgs(process.argv);
  const count = Math.max(1, Math.min(ROUTES.length, parseInt(args.count, 10) || ROUTES.length));

  console.log('— Demo tracking seed (FN-1683) —');

  const zipCount = await upsertZipCodes();
  console.log(`zip_codes: ensured ${zipCount} demo zips exist (existing rows untouched).`);

  const { tenantId, source } = await resolveTenantId(args);
  console.log(`Target tenant: ${tenantId || '(none)'} — ${source}`);

  const { trucks, drivers } = await pickFleet(tenantId, count);
  if (trucks.length === 0) {
    console.error('✗ No in-service trucks found. Seed the fleet (seed.sql) first, or pass --tenant=<uuid>.');
    process.exitCode = 1;
    return;
  }
  if (!tenantId) {
    console.warn(
      '⚠  Using trucks with NO tenant_id. The /tracking map is tenant-scoped — these markers will NOT appear ' +
        'until the trucks have a tenant_id. Re-run with --tenant=<uuid> against a real DB for the live demo.'
    );
  }
  if (trucks.length < count) {
    console.warn(`⚠  Only ${trucks.length} in-service truck(s) available; seeding ${trucks.length} load(s).`);
  }

  const routes = ROUTES.slice(0, Math.min(count, trucks.length));
  const created = [];

  await knex.transaction(async (trx) => {
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const truck = trucks[i];
      const driver = drivers.length ? drivers[i % drivers.length] : null;
      const loadNumber = `${DEMO_PREFIX}${route.suffix}`;
      await upsertDemoLoad(trx, { loadNumber, route, truck, driver });
      created.push({
        loadNumber,
        route: `${ZIP_CODES[route.pickup].city} → ${ZIP_CODES[route.delivery].city}`,
        truck: truck.unit_number,
        driver: driver ? `${driver.first_name} ${driver.last_name}` : '(none)'
      });
    }
  });

  console.log(`\n✓ Seeded ${created.length} demo load(s):`);
  for (const c of created) {
    console.log(`  ${c.loadNumber}  ${c.route.padEnd(28)} truck=${c.truck}  driver=${c.driver}`);
  }
  console.log('\nNext: node backend/scripts/demo-tracking-simulator.js   (then open /tracking)');
}

main()
  .catch((err) => {
    console.error('✗ Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => knex.destroy());
