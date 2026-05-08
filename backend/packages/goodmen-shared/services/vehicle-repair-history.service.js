'use strict';

/**
 * FN-1446: server-to-server orchestrator for the VIN repair-history-summary
 * feature (FN-1433). Pulls work-order history for a vehicle within a tenant,
 * caps the row count to control AI token cost, and forwards to the
 * ai-service handler at POST /api/ai/vehicles/repair-history-summary
 * (FN-1445). The route layer (vehicles.js) wraps this in HTTP semantics.
 *
 * Responses are short-cached in process for 5 minutes keyed by
 * tenantId + vehicleId + windowDays. The ai-service has its own VIN cache
 * with a longer TTL — this layer just absorbs duplicate requests inside a
 * single Render instance during a session.
 */

const axios = require('axios');
const dbBridge = require('../internal/db');

const WINDOW_DAYS_DEFAULT = 365;
const WINDOW_DAYS_MIN = 30;
const WINDOW_DAYS_MAX = 1825;
const MAX_AI_ROWS = 50;
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const AI_TIMEOUT_MS = Number(process.env.AI_REPAIR_HISTORY_TIMEOUT_MS || 12000);
const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || 'http://localhost:4100').replace(/\/$/, '');

const routeCache = new Map();

function clampWindowDays(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return WINDOW_DAYS_DEFAULT;
  if (num < WINDOW_DAYS_MIN) return WINDOW_DAYS_MIN;
  if (num > WINDOW_DAYS_MAX) return WINDOW_DAYS_MAX;
  return num;
}

async function resolveVehicleSource() {
  try {
    const viewResult = await dbBridge.query("SELECT to_regclass('public.all_vehicles') AS rel");
    if (viewResult?.rows?.[0]?.rel) return 'all_vehicles';
    const tableResult = await dbBridge.query("SELECT to_regclass('public.vehicles') AS rel");
    if (tableResult?.rows?.[0]?.rel) return 'vehicles';
    return 'none';
  } catch {
    return 'none';
  }
}

/**
 * Fetch the AI-bound WO history slice for a vehicle. Mirrors the resolution
 * flow used by getVehicleMaintenanceHistory (FN-1389) — vehicle row → VIN →
 * customer_vehicles UUIDs → work_orders — but selects the columns the AI
 * handler actually needs, applies the windowDays filter at the SQL layer,
 * and caps the result at `capRows` (default 50) sent to the model.
 *
 * Vehicle resolution order (FN-1500): the WO form sends a vehicleId sourced
 * from customer_vehicles, while the legacy fleet UI sends a vehicles.id. Try
 * the vehicles/all_vehicles table first; on miss, fall back to
 * customer_vehicles.vehicle_uuid. Only return null when neither resolves.
 *
 * Returns `null` when the vehicle is not visible to the tenant — caller maps
 * that to 404. Returns `{ vin, history: [] }` when the vehicle exists but no
 * work orders fall in the window; the orchestrator short-circuits that to
 * `insufficientHistory: true` without calling the AI service.
 */
async function fetchVehicleWorkOrderHistory(vehicleId, { tenantId, windowDays, capRows = MAX_AI_ROWS } = {}) {
  if (!vehicleId || !tenantId) return null;

  const vehicleSource = await resolveVehicleSource();
  if (vehicleSource === 'none') return null;

  let vin = null;
  const vehicleResult = await dbBridge.query(
    `SELECT vin FROM ${vehicleSource} WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [vehicleId, tenantId]
  );
  if (vehicleResult.rows.length) {
    vin = vehicleResult.rows[0].vin;
  } else {
    const cvDirect = await dbBridge.query(
      'SELECT vin FROM customer_vehicles WHERE vehicle_uuid = $1 AND tenant_id = $2 LIMIT 1',
      [vehicleId, tenantId]
    );
    if (!cvDirect.rows.length) return null;
    vin = cvDirect.rows[0].vin;
  }
  if (!vin) return { vin: null, history: [] };

  const cvResult = await dbBridge.query(
    'SELECT vehicle_uuid FROM customer_vehicles WHERE vin = $1 AND tenant_id = $2',
    [vin, tenantId]
  );
  const vehicleUuids = cvResult.rows.map((r) => r.vehicle_uuid).filter(Boolean);
  if (!vehicleUuids.length) return { vin, history: [] };

  const safeCap = Math.max(1, Math.min(Number(capRows) || MAX_AI_ROWS, MAX_AI_ROWS));
  const safeWindow = clampWindowDays(windowDays);

  const rowResult = await dbBridge.query(
    `SELECT
        wo.id                 AS work_order_id,
        wo.work_order_number  AS work_order_number,
        wo.type               AS type,
        wo.status             AS status,
        wo.description        AS title,
        wo.created_at::date   AS request_date,
        wo.completed_at::date AS completion_date,
        wo.total_amount::numeric AS grand_total
       FROM work_orders wo
      WHERE wo.vehicle_id = ANY($1::uuid[])
        AND wo.tenant_id = $2
        AND wo.created_at >= NOW() - ($3 || ' days')::interval
      ORDER BY wo.created_at DESC
      LIMIT $4`,
    [vehicleUuids, tenantId, String(safeWindow), safeCap]
  );

  const history = rowResult.rows.map((r) => ({
    work_order_id: r.work_order_id,
    work_order_number: r.work_order_number,
    type: r.type,
    status: r.status,
    title: r.title,
    request_date: r.request_date,
    completion_date: r.completion_date,
    grand_total: r.grand_total === null || r.grand_total === undefined ? null : Number(r.grand_total)
  }));

  return { vin, history };
}

function pickBearer(req) {
  if (!req || !req.headers) return null;
  const raw = req.headers.authorization || req.headers.Authorization;
  if (typeof raw === 'string' && raw.startsWith('Bearer ')) return raw;
  return null;
}

async function requestRepairHistorySummary(req, { vin, history }) {
  const headers = { 'Content-Type': 'application/json' };
  const bearer = pickBearer(req);
  if (bearer) headers.Authorization = bearer;

  // FN-1500: validateStatus only suppresses HTTP-status errors. Network-layer
  // failures (DNS, ECONNREFUSED, ECONNRESET, timeout) still throw, so the
  // route catch turned an AI-down event into a 500 instead of letting the
  // orchestrator surface { ok: false, reason: 'ai_unavailable' } → 502. Wrap
  // the call and translate any throw into a synthetic non-200 response.
  try {
    return await axios.post(
      `${AI_SERVICE_URL}/api/ai/vehicles/repair-history-summary`,
      { vin, history },
      { headers, timeout: AI_TIMEOUT_MS, validateStatus: () => true }
    );
  } catch (_err) {
    return { status: 0, data: null };
  }
}

function cacheKey(tenantId, vehicleId, windowDays) {
  return `${tenantId}::${vehicleId}::${windowDays}`;
}

function readCache(key, now) {
  const entry = routeCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    routeCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key, value, now) {
  routeCache.set(key, { value, expiresAt: now + ROUTE_CACHE_TTL_MS });
}

/**
 * Orchestrate: cache lookup → DB fetch → AI call → cache write. Returns one of:
 *   - `null` — vehicle not visible to tenant (caller → 404)
 *   - `{ ok: false, reason: 'ai_unavailable', status }` — AI call failed
 *   - `{ ok: true, body, fromCache }` — happy path; body is the AI handler payload
 */
async function getRepairHistorySummary(vehicleId, { tenantId, windowDays, req } = {}) {
  if (!vehicleId || !tenantId) return null;
  const safeWindow = clampWindowDays(windowDays);
  const key = cacheKey(tenantId, vehicleId, safeWindow);
  const now = Date.now();

  const cached = readCache(key, now);
  if (cached) return { ok: true, body: cached, fromCache: true };

  const fetched = await fetchVehicleWorkOrderHistory(vehicleId, {
    tenantId,
    windowDays: safeWindow,
    capRows: MAX_AI_ROWS
  });
  if (fetched === null) return null;

  // FN-1500: short-circuit empty history without round-tripping the AI
  // service. The widget renders this as a neutral "Not enough history" pill,
  // and we still cache so a re-render within TTL doesn't repeat the DB work.
  if (!Array.isArray(fetched.history) || fetched.history.length === 0) {
    const emptyBody = {
      insufficientHistory: true,
      count: 0,
      vin: fetched.vin,
      windowDays: safeWindow
    };
    writeCache(key, emptyBody, now);
    return { ok: true, body: emptyBody, fromCache: false };
  }

  const aiResponse = await requestRepairHistorySummary(req, {
    vin: fetched.vin,
    history: fetched.history
  });
  if (aiResponse.status !== 200 || !aiResponse.data || typeof aiResponse.data !== 'object') {
    return { ok: false, reason: 'ai_unavailable', status: aiResponse.status };
  }

  writeCache(key, aiResponse.data, now);
  return { ok: true, body: aiResponse.data, fromCache: false };
}

function _resetCacheForTests() {
  routeCache.clear();
}

module.exports = {
  clampWindowDays,
  fetchVehicleWorkOrderHistory,
  requestRepairHistorySummary,
  getRepairHistorySummary,
  WINDOW_DAYS_DEFAULT,
  WINDOW_DAYS_MIN,
  WINDOW_DAYS_MAX,
  MAX_AI_ROWS,
  ROUTE_CACHE_TTL_MS,
  _resetCacheForTests
};
