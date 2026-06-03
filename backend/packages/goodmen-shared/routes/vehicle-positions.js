'use strict';

/**
 * FN-1672 — Vehicle positions read API (Story D — Live map UI).
 *
 * Backs the live fleet map (FN-1671). Two reads, both tenant-scoped via
 * tenantContextMiddleware (req.context.tenantId):
 *
 *   GET /api/vehicle-positions
 *     Latest known position per vehicle — the map's marker layer. Filters:
 *     status, driverId, vehicleIds, bbox, geofenceId. Returns a lean
 *     `{ data, meta }` envelope; one row per vehicle that has a recent ping.
 *
 *   GET /api/vehicle-positions/:vehicleId/breadcrumbs?hours=4
 *     The recent trail (default 4h, capped 24h) for a single vehicle — the
 *     hover breadcrumb layer. Fetched per-vehicle on demand rather than for the
 *     whole fleet, which keeps the marker read cheap at 500 vehicles.
 *
 * Live updates (the third leg of the AC) are NOT served here: new pings are
 * broadcast over the `vehicle:position` WebSocket event from the telematics
 * ingest path (websocket.service.emitVehiclePosition →
 * integrations-service/telematics-ingest-service). The client seeds markers
 * from this endpoint, then patches them from the socket.
 *
 * Data source: `vehicle_position_pings` (FN-1660, RANGE-partitioned by ts).
 * The latest-per-vehicle query is bounded to the last LOOKBACK_HOURS so it only
 * touches the newest day-partitions and rides the (vehicle_id, ts DESC) index;
 * a vehicle silent longer than that simply drops off the live map.
 *
 * Tenant scoping: pings carry no tenant_id (write-optimized ingest), so the
 * tenant boundary is the `vehicles` table — we resolve the tenant's vehicles
 * first and constrain the ping read to those ids.
 *
 * Mounted by vehicles-maintenance-service:
 *   app.use('/api/vehicle-positions', authMiddleware, tenantContextMiddleware, router)
 */

const express = require('express');
const router = express.Router();
const dbModule = require('../internal/db');
const geofenceService = require('../services/geofence-service');
const dtLogger = require('../utils/logger');

const PINGS_TABLE = 'vehicle_position_pings';
const VEHICLES_TABLE = 'vehicles';

// A vehicle whose last ping is older than this is considered offline and is
// omitted from the live map. Also bounds the partition scan for the latest
// query (only the newest day-partitions are touched).
const LOOKBACK_HOURS = 24;
// Breadcrumb trail defaults / ceiling.
const DEFAULT_BREADCRUMB_HOURS = 4;
const MAX_BREADCRUMB_HOURS = 24;
// Safety cap on breadcrumb rows returned for a single vehicle (≈ one row / 30s
// over 24h ≈ 2880; this bounds a misbehaving device or a wide window).
const MAX_BREADCRUMB_ROWS = 5000;

function getDb() {
  return dbModule.knex;
}

function getTenantContext(req) {
  return req.context && req.context.tenantId ? req.context : null;
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Map a vehicle row + its latest ping into the wire position shape. */
function toWirePosition(vehicle, ping) {
  const ts = ping.ts instanceof Date ? ping.ts.toISOString() : ping.ts || null;
  const lastPingAgeSeconds =
    ts != null ? Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000)) : null;
  return {
    vehicleId: vehicle.id,
    unitNumber: vehicle.unit_number || null,
    make: vehicle.make || null,
    model: vehicle.model || null,
    year: vehicle.year != null ? vehicle.year : null,
    vehicleType: vehicle.vehicle_type || null,
    status: vehicle.status || null,
    driverId: vehicle.leased_driver_id || null,
    lat: toNumber(ping.lat),
    lng: toNumber(ping.lng),
    speedMph: toNumber(ping.speed_mph),
    headingDeg: toNumber(ping.heading_deg),
    ts,
    lastPingAgeSeconds
  };
}

/** Parse `bbox=minLng,minLat,maxLng,maxLat` into bounds, or null if absent/invalid. */
function parseBbox(raw) {
  if (raw === undefined || raw === '') return null;
  const parts = String(raw).split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  return { minLng, minLat, maxLng, maxLat };
}

function withinBbox(position, bbox) {
  if (position.lat == null || position.lng == null) return false;
  return (
    position.lng >= bbox.minLng &&
    position.lng <= bbox.maxLng &&
    position.lat >= bbox.minLat &&
    position.lat <= bbox.maxLat
  );
}

/**
 * Tenant's vehicles, narrowed by the SQL-cheap filters (status, driverId,
 * vehicleIds). Returns a Map keyed by vehicle id so positions can be joined to
 * metadata without a second pass.
 */
async function loadTenantVehicles(db, tenantId, filters) {
  const qb = db(VEHICLES_TABLE).where('tenant_id', tenantId);
  if (filters.status) qb.where('status', filters.status);
  if (filters.driverId) qb.where('leased_driver_id', filters.driverId);
  if (filters.vehicleIds && filters.vehicleIds.length) {
    qb.whereIn('id', filters.vehicleIds);
  }
  const rows = await qb.select(
    'id',
    'unit_number',
    'make',
    'model',
    'year',
    'vehicle_type',
    'status',
    'leased_driver_id'
  );
  const byId = new Map();
  for (const row of rows) byId.set(row.id, row);
  return byId;
}

/** Latest ping per vehicle id, within the lookback window. */
async function loadLatestPings(db, vehicleIds) {
  if (!vehicleIds.length) return [];
  return db(PINGS_TABLE)
    .whereIn('vehicle_id', vehicleIds)
    .where('ts', '>=', hoursAgoIso(LOOKBACK_HOURS))
    .distinctOn('vehicle_id')
    .orderBy([
      { column: 'vehicle_id' },
      { column: 'ts', order: 'desc' }
    ])
    .select('vehicle_id', 'lat', 'lng', 'speed_mph', 'heading_deg', 'ts');
}

/**
 * @openapi
 * /api/vehicle-positions:
 *   get:
 *     summary: Latest position per vehicle for the live map
 *     description: >
 *       One row per vehicle with a ping in the last 24h, tenant-scoped. Filters —
 *       status, driverId (matches vehicles.leased_driver_id), vehicleIds (comma
 *       list), bbox (minLng,minLat,maxLng,maxLat), geofenceId (only vehicles
 *       currently inside that geofence).
 *     tags: [VehiclePositions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string } }
 *       - { in: query, name: driverId, schema: { type: string } }
 *       - { in: query, name: vehicleIds, description: "comma-separated vehicle ids", schema: { type: string } }
 *       - { in: query, name: bbox, description: "minLng,minLat,maxLng,maxLat", schema: { type: string } }
 *       - { in: query, name: geofenceId, schema: { type: string } }
 *     responses:
 *       200: { description: "{ data, meta } latest positions" }
 *       403: { description: Tenant context missing }
 */
router.get('/', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });

  const filters = {
    status: req.query.status ? String(req.query.status) : null,
    driverId: req.query.driverId ? String(req.query.driverId) : null,
    vehicleIds:
      req.query.vehicleIds !== undefined && req.query.vehicleIds !== ''
        ? String(req.query.vehicleIds).split(',').map((s) => s.trim()).filter(Boolean)
        : null
  };
  const bbox = parseBbox(req.query.bbox);

  try {
    const db = getDb();
    const vehiclesById = await loadTenantVehicles(db, context.tenantId, filters);
    if (vehiclesById.size === 0) {
      return res.json({ data: [], meta: makeMeta(0, bbox, req.query.geofenceId) });
    }

    const pings = await loadLatestPings(db, Array.from(vehiclesById.keys()));

    let positions = [];
    for (const ping of pings) {
      const vehicle = vehiclesById.get(ping.vehicle_id);
      if (!vehicle) continue; // ping for a vehicle filtered out above
      positions.push(toWirePosition(vehicle, ping));
    }

    if (bbox) positions = positions.filter((p) => withinBbox(p, bbox));

    if (req.query.geofenceId) {
      positions = await filterByGeofence(db, context.tenantId, req.query.geofenceId, positions);
    }

    return res.json({ data: positions, meta: makeMeta(positions.length, bbox, req.query.geofenceId) });
  } catch (err) {
    dtLogger.error('vehicle_positions_list_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to list vehicle positions' });
  }
});

function makeMeta(total, bbox, geofenceId) {
  return {
    total,
    lookbackHours: LOOKBACK_HOURS,
    bbox: bbox || null,
    geofenceId: geofenceId || null,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Keep only positions whose point falls inside the given tenant geofence.
 * Reuses the geofence service's app-side containment math (no PostGIS) against
 * the STORED GeoJSON row — the wire geofence from getGeofence() drops the
 * geometry field, so we read the row directly here.
 */
async function filterByGeofence(db, tenantId, geofenceId, positions) {
  const row = await db('geofences')
    .where({ id: geofenceId, tenant_id: tenantId })
    .first();
  if (!row) return []; // unknown/foreign geofence → nothing matches
  const stored = { kind: row.kind, geometry: row.geometry };
  return positions.filter((p) => {
    if (p.lat == null || p.lng == null) return false;
    return geofenceService.geofenceContainsPoint(stored, [p.lng, p.lat]);
  });
}

/**
 * @openapi
 * /api/vehicle-positions/{vehicleId}/breadcrumbs:
 *   get:
 *     summary: Recent position trail for one vehicle (hover breadcrumbs)
 *     description: Chronological pings over the last `hours` (default 4, max 24), tenant-scoped.
 *     tags: [VehiclePositions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vehicleId, required: true, schema: { type: string } }
 *       - { in: query, name: hours, schema: { type: number, default: 4 } }
 *     responses:
 *       200: { description: "{ data, meta } breadcrumb trail" }
 *       403: { description: Tenant context missing }
 *       404: { description: Vehicle not found in tenant }
 */
router.get('/:vehicleId/breadcrumbs', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });

  let hours = toNumber(req.query.hours);
  if (hours == null || hours <= 0) hours = DEFAULT_BREADCRUMB_HOURS;
  hours = Math.min(hours, MAX_BREADCRUMB_HOURS);

  try {
    const db = getDb();
    const vehicle = await db(VEHICLES_TABLE)
      .where({ id: req.params.vehicleId, tenant_id: context.tenantId })
      .first();
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const rows = await db(PINGS_TABLE)
      .where('vehicle_id', req.params.vehicleId)
      .where('ts', '>=', hoursAgoIso(hours))
      .orderBy('ts', 'asc')
      .limit(MAX_BREADCRUMB_ROWS)
      .select('lat', 'lng', 'speed_mph', 'heading_deg', 'ts');

    const data = rows.map((r) => ({
      lat: toNumber(r.lat),
      lng: toNumber(r.lng),
      speedMph: toNumber(r.speed_mph),
      headingDeg: toNumber(r.heading_deg),
      ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts
    }));

    return res.json({
      data,
      meta: {
        vehicleId: req.params.vehicleId,
        hours,
        total: data.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    dtLogger.error('vehicle_positions_breadcrumbs_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch breadcrumbs' });
  }
});

module.exports = router;
