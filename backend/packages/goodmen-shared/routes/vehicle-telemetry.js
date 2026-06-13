const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const authMiddleware = require('../middleware/auth-middleware');
const tenantContextMiddleware = require('../middleware/tenant-context-middleware');
const requireActiveSubscription = require('../middleware/trial-enforcement-middleware')();

// Middleware chain applied per-route (NOT router.use / mount-level) so that
// non-matching `/api/*` paths fall straight through to the service's 404
// handler instead of getting a 401. Mirrors the gating on the sibling
// /api/equipment + /api/vehicles routes (auth -> tenant context -> active
// subscription) so an expired tenant is blocked here exactly as it is there.
const guard = [authMiddleware, tenantContextMiddleware, requireActiveSubscription];

/*
 * ============================================================================
 *  MOCK VEHICLE TELEMETRY  —  FN-1752 (parent story FN-1750)
 * ============================================================================
 *  All telemetry returned by this router is FABRICATED / STUBBED. FleetNeuron
 *  has no telematics ingestion today (no GPS pings, fuel, fault codes, odometer
 *  or last-moved data anywhere in the DB). These endpoints exist purely so the
 *  Vehicle Tracking page (FN-1751) has a stable, demoable data source behind a
 *  PROVIDER-AGNOSTIC contract, so a real telematics adapter (Samsara / Motive /
 *  Geotab, etc.) can be swapped in later WITHOUT changing this response shape.
 *
 *  See docs/design/telematics-tracking-research-2026-06-02.md for the future
 *  real-integration design (adapter pattern, webhook ingress, position-ping
 *  table with retention). NONE of that is built here — this is a stub only and
 *  there is intentionally NO `vehicle_telemetry` table (parent FN-1750 decision).
 *
 *  Values are DETERMINISTIC per vehicle (seeded from the vehicle id / unit
 *  number) so position, fuel and fault codes stay stable across page reloads —
 *  only the relative timestamps advance, which makes the stub feel "live".
 * ============================================================================
 */

// Response contract (do NOT change shape without updating the FE + story doc):
//   {
//     vehicle_id, latitude, longitude, city, state,
//     speed_mph, heading_deg, fuel_level_pct, odometer, engine_status,
//     last_moved_at, fault_codes: [{ code, description, severity }],
//     updated_at, source: 'mock'
//   }
// `city` (e.g. "Dallas") and `state` (2-letter, e.g. "TX") are deterministic per
// vehicle and always consistent with the returned latitude/longitude — the coords
// are a real US city from CITY_CATALOG with a small in-city jitter (FN-1777).

// Small catalog of realistic J1939 / OBD-II style diagnostic trouble codes used
// to fabricate a vehicle's active fault list. MOCK ONLY.
const FAULT_CATALOG = [
  { code: 'SPN-100', description: 'Engine oil pressure low', severity: 'high' },
  { code: 'SPN-110', description: 'Engine coolant temperature high', severity: 'high' },
  { code: 'SPN-190', description: 'Engine overspeed', severity: 'medium' },
  { code: 'SPN-84', description: 'Wheel speed sensor fault', severity: 'medium' },
  { code: 'SPN-1761', description: 'DEF (diesel exhaust fluid) level low', severity: 'low' },
  { code: 'SPN-639', description: 'J1939 network communication error', severity: 'low' },
  { code: 'P0420', description: 'Catalyst system efficiency below threshold', severity: 'medium' },
  { code: 'P0455', description: 'Evaporative emission system leak (large)', severity: 'low' }
];

const ENGINE_STATES = ['driving', 'idling', 'parked', 'off'];

// Catalog of real US cities used to anchor a vehicle's mock position so the map
// marker and Google Maps link land on a recognizable place (instead of a random
// point in a bounding box). MOCK ONLY. All coords are kept within the historical
// continental-US box (lat 31..44 N, lng -118..-68 W) — with the ±0.03° jitter
// applied in buildMockTelemetry they stay comfortably inside it.
const CITY_CATALOG = [
  { city: 'Phoenix', state: 'AZ', lat: 33.4484, lng: -112.0740 },
  { city: 'Tucson', state: 'AZ', lat: 32.2226, lng: -110.9747 },
  { city: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398 },
  { city: 'Salt Lake City', state: 'UT', lat: 40.7608, lng: -111.8910 },
  { city: 'Albuquerque', state: 'NM', lat: 35.0844, lng: -106.6504 },
  { city: 'Denver', state: 'CO', lat: 39.7392, lng: -104.9903 },
  { city: 'Colorado Springs', state: 'CO', lat: 38.8339, lng: -104.8214 },
  { city: 'El Paso', state: 'TX', lat: 31.7619, lng: -106.4850 },
  { city: 'Amarillo', state: 'TX', lat: 35.2220, lng: -101.8313 },
  { city: 'Dallas', state: 'TX', lat: 32.7767, lng: -96.7970 },
  { city: 'Fort Worth', state: 'TX', lat: 32.7555, lng: -97.3308 },
  { city: 'Oklahoma City', state: 'OK', lat: 35.4676, lng: -97.5164 },
  { city: 'Tulsa', state: 'OK', lat: 36.1540, lng: -95.9928 },
  { city: 'Wichita', state: 'KS', lat: 37.6872, lng: -97.3301 },
  { city: 'Kansas City', state: 'MO', lat: 39.0997, lng: -94.5786 },
  { city: 'St. Louis', state: 'MO', lat: 38.6270, lng: -90.1994 },
  { city: 'Omaha', state: 'NE', lat: 41.2565, lng: -95.9345 },
  { city: 'Des Moines', state: 'IA', lat: 41.5868, lng: -93.6250 },
  { city: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298 },
  { city: 'Indianapolis', state: 'IN', lat: 39.7684, lng: -86.1581 },
  { city: 'Columbus', state: 'OH', lat: 39.9612, lng: -82.9988 },
  { city: 'Cleveland', state: 'OH', lat: 41.4993, lng: -81.6944 },
  { city: 'Detroit', state: 'MI', lat: 42.3314, lng: -83.0458 },
  { city: 'Milwaukee', state: 'WI', lat: 43.0389, lng: -87.9065 },
  { city: 'Memphis', state: 'TN', lat: 35.1495, lng: -90.0490 },
  { city: 'Nashville', state: 'TN', lat: 36.1627, lng: -86.7816 },
  { city: 'Louisville', state: 'KY', lat: 38.2527, lng: -85.7585 },
  { city: 'Birmingham', state: 'AL', lat: 33.5186, lng: -86.8104 },
  { city: 'Jackson', state: 'MS', lat: 32.2988, lng: -90.1848 },
  { city: 'Little Rock', state: 'AR', lat: 34.7465, lng: -92.2896 },
  { city: 'Atlanta', state: 'GA', lat: 33.7490, lng: -84.3880 },
  { city: 'Charlotte', state: 'NC', lat: 35.2271, lng: -80.8431 },
  { city: 'Raleigh', state: 'NC', lat: 35.7796, lng: -78.6382 },
  { city: 'Charleston', state: 'SC', lat: 32.7765, lng: -79.9311 },
  { city: 'Richmond', state: 'VA', lat: 37.5407, lng: -77.4360 },
  { city: 'Washington', state: 'DC', lat: 38.9072, lng: -77.0369 },
  { city: 'Baltimore', state: 'MD', lat: 39.2904, lng: -76.6122 },
  { city: 'Philadelphia', state: 'PA', lat: 39.9526, lng: -75.1652 },
  { city: 'Pittsburgh', state: 'PA', lat: 40.4406, lng: -79.9959 },
  { city: 'New York', state: 'NY', lat: 40.7128, lng: -74.0060 },
  { city: 'Hartford', state: 'CT', lat: 41.7658, lng: -72.6734 },
  { city: 'Boston', state: 'MA', lat: 42.3601, lng: -71.0589 }
];

/**
 * Deterministic 32-bit string hash (FNV-1a style). Same input -> same seed,
 * so a vehicle always renders at the same place with the same fuel/faults.
 */
function seedFrom(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32 PRNG — tiny deterministic generator. Returns a function yielding
 * floats in [0, 1). Seeded so the sequence is stable per vehicle.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

/**
 * Build the deterministic MOCK telemetry payload for a single vehicle row.
 * `row` only needs `id` (and optionally `unit_number`) to seed the values.
 */
function buildMockTelemetry(row, now) {
  const id = row.id;
  // Seed from unit_number when present (more human-stable), else the id.
  const rand = mulberry32(seedFrom(row.unit_number || id));

  // Engine state — weighted toward "driving" so the map looks active.
  const stateRoll = rand();
  let engineStatus;
  if (stateRoll < 0.55) engineStatus = 'driving';
  else if (stateRoll < 0.75) engineStatus = 'idling';
  else if (stateRoll < 0.9) engineStatus = 'parked';
  else engineStatus = 'off';

  // Position anchored to a real US city (deterministic per vehicle) with a tiny
  // in-city jitter so the marker looks live but the named city stays consistent
  // with the coordinates. Jitter is ±0.03° (~2 mi), well inside the US box.
  const city = CITY_CATALOG[Math.floor(rand() * CITY_CATALOG.length)];
  const latitude = round(city.lat + (rand() - 0.5) * 0.06, 5);
  const longitude = round(city.lng + (rand() - 0.5) * 0.06, 5);

  const heading = Math.floor(rand() * 360);
  const speed = engineStatus === 'driving' ? Math.floor(45 + rand() * 25) : 0; // 45-70 mph while driving

  const fuel = round(8 + rand() * 90, 1); // 8% .. 98%
  const odometer = Math.floor(45000 + rand() * 705000); // 45k .. 750k miles

  // Minutes since last movement, keyed to engine state so it reads sensibly.
  let movedMinutesAgo;
  if (engineStatus === 'driving') movedMinutesAgo = Math.floor(rand() * 2); // 0-1 min
  else if (engineStatus === 'idling') movedMinutesAgo = 2 + Math.floor(rand() * 8); // 2-9 min
  else if (engineStatus === 'parked') movedMinutesAgo = 30 + Math.floor(rand() * 600); // 0.5-10.5 h
  else movedMinutesAgo = 360 + Math.floor(rand() * 2160); // 6-42 h (off)
  const lastMovedAt = new Date(now.getTime() - movedMinutesAgo * 60000).toISOString();

  // Fault codes — most vehicles have none; a deterministic minority have 1-2.
  const faultRoll = rand();
  const faultCodes = [];
  if (faultRoll > 0.65) {
    const count = faultRoll > 0.88 ? 2 : 1;
    const used = new Set();
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(rand() * FAULT_CATALOG.length);
      if (!used.has(idx)) {
        used.add(idx);
        faultCodes.push(FAULT_CATALOG[idx]);
      }
    }
  }

  return {
    vehicle_id: id,
    latitude,
    longitude,
    city: city.city,
    state: city.state,
    speed_mph: speed,
    heading_deg: heading,
    fuel_level_pct: fuel,
    odometer,
    engine_status: engineStatus,
    last_moved_at: lastMovedAt,
    fault_codes: faultCodes,
    updated_at: now.toISOString(),
    source: 'mock'
  };
}

/**
 * @openapi
 * /api/vehicles/{id}/telemetry:
 *   get:
 *     summary: Mock telemetry for a single vehicle (STUBBED)
 *     description: >-
 *       Returns deterministic MOCK telemetry (position, city/state, speed, fuel,
 *       fault codes, last-moved) for one vehicle in a provider-agnostic shape.
 *       `city` (e.g. "Dallas") and `state` (2-letter) are consistent with the
 *       returned latitude/longitude. No real telematics integration exists yet —
 *       see FN-1750. The `:id` is resolved against the existing `all_vehicles`
 *       view (tenant-scoped).
 *     tags:
 *       - Vehicle Telemetry
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Mock telemetry payload
 *       404:
 *         description: Vehicle not found
 */
router.get('/vehicles/:id/telemetry', guard, async (req, res) => {
  try {
    const params = [req.params.id];
    let sql = `
      SELECT av.id, av.unit_number, av.vehicle_type
      FROM all_vehicles av
      WHERE av.id = $1
    `;
    if (req.context?.tenantId) {
      params.push(req.context.tenantId);
      sql += ` AND av.tenant_id = $${params.length}`;
    }
    sql += ' LIMIT 1';

    const result = await query(sql, params);
    const row = result.rows && result.rows[0];
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }
    // MOCK telemetry — fabricated, deterministic per vehicle.
    return res.json({ success: true, data: buildMockTelemetry(row, new Date()) });
  } catch (error) {
    const code = error && error.code ? String(error.code) : '';
    const message = (error && error.message) ? String(error.message) : '';
    console.error('[vehicle-telemetry] single query error — code=%s message=%s', code, message, error);
    // If the all_vehicles view is missing/stale (unmigrated schema), the vehicle
    // simply can't be resolved — surface a 404 rather than a 500.
    if (code === '42P01' || message.includes('does not exist') || message.includes('all_vehicles')) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch vehicle telemetry' });
  }
});

/**
 * @openapi
 * /api/fleet/telemetry:
 *   get:
 *     summary: Mock telemetry for the whole fleet (STUBBED)
 *     description: >-
 *       Returns an array of deterministic MOCK telemetry payloads, one per
 *       vehicle, for the all-trucks map layer. Each payload includes `city` and
 *       2-letter `state` consistent with its latitude/longitude. `type=truck`
 *       filters to trucks (anything that is not a trailer — aligned with the
 *       equipment endpoint). MOCK data only — see FN-1750.
 *     tags:
 *       - Vehicle Telemetry
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [truck, trailer]
 *         description: Filter by vehicle type
 *     responses:
 *       200:
 *         description: Array of mock telemetry payloads
 */
router.get('/fleet/telemetry', guard, async (req, res) => {
  try {
    const type = (req.query.type || '').toString().trim().toLowerCase();
    const params = [];
    let sql = `
      SELECT av.id, av.unit_number, av.vehicle_type
      FROM all_vehicles av
      WHERE 1=1
    `;
    if (req.context?.tenantId) {
      params.push(req.context.tenantId);
      sql += ` AND av.tenant_id = $${params.length}`;
    }
    // "truck" = any unit that is not a trailer — matches goodmen-shared/routes/equipment.js
    // so this map layer stays in sync with the truck filter dropdown (FN-1751).
    if (type === 'trailer') {
      params.push('trailer');
      sql += ` AND LOWER(COALESCE(av.vehicle_type, '')) = $${params.length}`;
    } else if (type === 'truck') {
      sql += ` AND LOWER(COALESCE(av.vehicle_type, '')) <> 'trailer'`;
    } else if (type) {
      params.push(type);
      sql += ` AND LOWER(COALESCE(av.vehicle_type, '')) = $${params.length}`;
    }
    sql += ' ORDER BY av.unit_number NULLS LAST';

    const result = await query(sql, params);
    const now = new Date();
    // MOCK telemetry — one fabricated, deterministic payload per vehicle.
    const data = (result.rows || []).map((row) => buildMockTelemetry(row, now));
    return res.json({ success: true, data });
  } catch (error) {
    const code = error && error.code ? String(error.code) : '';
    const message = (error && error.message) ? String(error.message) : '';
    console.error('[vehicle-telemetry] fleet query error — code=%s message=%s', code, message, error);
    // Unmigrated schema (missing all_vehicles view) -> empty list, not a 500,
    // so the map layer degrades gracefully (mirrors the equipment endpoint).
    if (code === '42P01' || message.includes('does not exist') || message.includes('all_vehicles')) {
      return res.json({ success: true, data: [] });
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch fleet telemetry' });
  }
});

module.exports = router;
// Exported for unit testing the deterministic mock generator (FN-1752 tests).
module.exports.buildMockTelemetry = buildMockTelemetry;
module.exports.FAULT_CATALOG = FAULT_CATALOG;
module.exports.CITY_CATALOG = CITY_CATALOG;
