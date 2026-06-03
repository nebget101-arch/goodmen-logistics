#!/usr/bin/env node
/**
 * FN-1683 (Story H / FN-1682) — Demo tracking simulator.
 *
 * Drives the real Phase 1 live map with synthetic GPS. On a `setInterval` loop it
 * walks every `DEMO-` IN_TRANSIT load along the line from its pickup zip to its
 * delivery zip and inserts a row into `vehicle_position_pings`. Story D's ingest
 * path broadcasts those pings over the `vehicle:position` WebSocket event, so the
 * markers move on `/tracking` with NO frontend changes and NO new WS code here.
 *
 * Position math — INTENTIONALLY SIMPLE: straight linear interpolation of lat/lng
 * between pickup and delivery. This is a demo, not navigation; we do NOT do true
 * Vincenty/haversine geodesics. `heading_deg` is the initial great-circle bearing
 * of the segment (good enough to point the marker the right way); `speed_mph` is a
 * random 50–65. Distances (for the arrival check) use the haversine formula since
 * it's cheap and makes the "within ~1km" threshold meaningful.
 *
 * Trip pacing: each load advances a fixed fraction per tick so a full trip takes
 * ~TRIP_DURATION_MS (default 5 min) of wall-clock regardless of real distance —
 * tuned for a watchable demo. Faster ticks ⇒ smaller steps, same total duration.
 *
 * Lifecycle per load:
 *   IN_TRANSIT → interpolate toward delivery → on arrival (~1km) mark DELIVERED.
 *   --mode=loop (default): after a 30s pause, reset to pickup and resume forever.
 *   --mode=once:           leave it DELIVERED and stop simulating it.
 * New loads seeded mid-run are picked up automatically on the next tick.
 *
 * Usage (from repo root):
 *   node backend/scripts/demo-tracking-simulator.js
 *   node backend/scripts/demo-tracking-simulator.js --interval=5000 --mode=loop
 *   node backend/scripts/demo-tracking-simulator.js --mode=once
 *
 * Ctrl+C stops cleanly ("Simulator stopped"). Env: DATABASE_URL or PG_* / DB_* vars.
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
const DEFAULT_INTERVAL_MS = 5000;
const TRIP_DURATION_MS = 5 * 60 * 1000; // a full pickup→delivery trip takes ~5 min
const ARRIVAL_KM = 1; // "reached delivery" threshold
const LOOP_PAUSE_MS = 30 * 1000; // pause at delivery before looping back

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial great-circle bearing from A to B, in degrees [0,360). */
function bearingDeg(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(aLat);
  const φ2 = toRad(bLat);
  const Δλ = toRad(bLng - aLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function randomSpeedMph() {
  return Math.round((50 + Math.random() * 15) * 10) / 10; // 50.0–65.0
}

/**
 * Load the active demo loads with their pickup/delivery coordinates resolved from
 * zip_codes. Skips (with a warning) any load missing a truck, stops, or zip coords.
 */
async function loadDemoRoutes() {
  const loads = await knex('loads')
    .where('status', 'IN_TRANSIT')
    .where('load_number', 'like', `${DEMO_PREFIX}%`)
    .whereNotNull('truck_id')
    .select('id', 'load_number', 'truck_id');

  const routes = [];
  for (const load of loads) {
    const stops = await knex('load_stops')
      .where('load_id', load.id)
      .whereIn('stop_type', ['PICKUP', 'DELIVERY'])
      .select('stop_type', 'zip');
    const pickup = stops.find((s) => s.stop_type === 'PICKUP');
    const delivery = stops.find((s) => s.stop_type === 'DELIVERY');
    if (!pickup || !delivery || !pickup.zip || !delivery.zip) {
      console.warn(`⚠  ${load.load_number}: missing pickup/delivery stop — skipping.`);
      continue;
    }
    const zips = await knex('zip_codes')
      .whereIn('zip', [pickup.zip, delivery.zip])
      .select('zip', 'latitude', 'longitude');
    const p = zips.find((z) => z.zip === pickup.zip);
    const d = zips.find((z) => z.zip === delivery.zip);
    if (!p || !d || p.latitude == null || d.latitude == null) {
      console.warn(`⚠  ${load.load_number}: zip coords not in zip_codes (re-run the seed) — skipping.`);
      continue;
    }
    routes.push({
      loadId: load.id,
      loadNumber: load.load_number,
      vehicleId: load.truck_id,
      pickup: { lat: Number(p.latitude), lng: Number(p.longitude) },
      delivery: { lat: Number(d.latitude), lng: Number(d.longitude) }
    });
  }
  return routes;
}

async function main() {
  const args = parseArgs(process.argv);
  const intervalMs = Math.max(250, parseInt(args.interval, 10) || DEFAULT_INTERVAL_MS);
  const mode = args.mode === 'once' ? 'once' : 'loop';
  const fractionStep = intervalMs / TRIP_DURATION_MS;

  console.log('— Demo tracking simulator (FN-1683) —');
  console.log(`interval=${intervalMs}ms  mode=${mode}  trip≈${Math.round(TRIP_DURATION_MS / 1000)}s/leg`);

  // Per-load progress state (in memory). Keyed by loadId.
  //   fraction: 0..1 along pickup→delivery
  //   pausedUntil: epoch ms; while > now the load sits at delivery (loop mode)
  const state = new Map();
  let ticking = false;

  async function tick() {
    if (ticking) return; // skip overlap if a tick runs long
    ticking = true;
    try {
      const routes = await loadDemoRoutes();
      if (routes.length === 0) {
        console.log('… no DEMO- IN_TRANSIT loads — run the seed script first.');
        return;
      }
      const now = Date.now();
      const pings = [];

      for (const r of routes) {
        let st = state.get(r.loadId);
        if (!st) {
          st = { fraction: 0, pausedUntil: 0 };
          state.set(r.loadId, st);
        }
        if (st.pausedUntil > now) continue; // sitting at delivery during loop pause

        const { pickup, delivery } = r;
        const lat = pickup.lat + (delivery.lat - pickup.lat) * st.fraction;
        const lng = pickup.lng + (delivery.lng - pickup.lng) * st.fraction;
        const heading = bearingDeg(pickup.lat, pickup.lng, delivery.lat, delivery.lng);

        pings.push({
          vehicle_id: r.vehicleId,
          ts: new Date(now),
          lat,
          lng,
          speed_mph: randomSpeedMph(),
          heading_deg: heading,
          source_event_id: SOURCE_EVENT_ID,
          payload: JSON.stringify({ demo: true, loadNumber: r.loadNumber, fraction: Number(st.fraction.toFixed(4)) })
        });

        const distToDelivery = haversineKm(lat, lng, delivery.lat, delivery.lng);
        if (st.fraction >= 1 || distToDelivery <= ARRIVAL_KM) {
          // Arrived. Mark DELIVERED.
          await knex('loads').where('id', r.loadId).update({ status: 'DELIVERED', updated_at: knex.fn.now() });
          console.log(`✓ ${r.loadNumber} reached delivery — marked DELIVERED.`);
          if (mode === 'loop') {
            st.fraction = 0;
            st.pausedUntil = now + LOOP_PAUSE_MS;
            // Reset to IN_TRANSIT so the next tick (after the pause) keeps moving it.
            await knex('loads').where('id', r.loadId).update({ status: 'IN_TRANSIT', updated_at: knex.fn.now() });
          } else {
            state.delete(r.loadId); // once-mode: stop simulating this load
          }
        } else {
          st.fraction = Math.min(1, st.fraction + fractionStep);
        }
      }

      if (pings.length) {
        // ts is the partition key and differs each tick, so the (vehicle_id,
        // source_event_id, ts) unique index never collides; onConflict.ignore is
        // a belt-and-suspenders guard against a same-ms double tick.
        await knex('vehicle_position_pings')
          .insert(pings)
          .onConflict(['vehicle_id', 'source_event_id', 'ts'])
          .ignore();
        console.log(`tick: inserted ${pings.length} ping(s) @ ${new Date(now).toISOString()}`);
      }
    } catch (err) {
      console.error('tick error:', err.message);
    } finally {
      ticking = false;
    }
  }

  await tick(); // fire immediately so the demo starts without waiting one interval
  const handle = setInterval(tick, intervalMs);

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(handle);
    // Let an in-flight tick settle before tearing down the connection.
    await new Promise((res) => setTimeout(res, 50));
    await knex.destroy();
    console.log('\nSimulator stopped');
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err) => {
  console.error('✗ Simulator failed to start:', err.message);
  await knex.destroy();
  process.exit(1);
});
