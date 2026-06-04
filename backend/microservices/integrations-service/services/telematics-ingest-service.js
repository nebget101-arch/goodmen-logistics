'use strict';

/**
 * Telematics ingest service — FN-1661
 *
 * Persists normalized pings (from the webhook ingress or the polling fallback)
 * into `vehicle_position_pings` after resolving the provider's device to a
 * fleet vehicle. Every DB access is schema-defensive: when a table or column is
 * missing (pre-migration), the call no-ops rather than throwing, mirroring the
 * inbound-email service.
 *
 * Schema contract (coded against FN-1660's migrations — see story doc):
 *   telematics_providers (id, code, name)            -- code ∈ {samsara, motive}
 *   telematics_devices   (id, vehicle_id, provider_id, external_device_id,
 *                         serial, paired_at, last_seen_at, tenant_id?)
 *   vehicle_position_pings (id, vehicle_id, ts, lat, lng, speed_mph,
 *                         heading_deg, source_event_id, payload jsonb,
 *                         provider_id?, tenant_id?, created_at)
 */

const knex = require('@goodmen/shared/config/knex');
const dtLogger = require('@goodmen/shared/utils/logger');
const { emitVehiclePosition } = require('@goodmen/shared/services/websocket.service');

const PINGS_TABLE = 'vehicle_position_pings';
const DEVICES_TABLE = 'telematics_devices';
const PROVIDERS_TABLE = 'telematics_providers';
const VEHICLES_TABLE = 'vehicles';

// Cache column introspection so we only pay it once per process.
const _columnCache = new Map();

// vehicle_id → tenant_id, cached for the live-map broadcast (FN-1672). A vehicle
// never changes tenant in practice, so memoizing for the process lifetime keeps
// the hot ingest path from re-querying `vehicles` on every ping.
const _vehicleTenantCache = new Map();

async function tableColumns(table) {
  if (_columnCache.has(table)) return _columnCache.get(table);
  let cols = new Set();
  try {
    const info = await knex(table).columnInfo();
    cols = new Set(Object.keys(info));
  } catch (_err) {
    cols = new Set();
  }
  _columnCache.set(table, cols);
  return cols;
}

/** Reset the column cache (tests). */
function _resetColumnCache() {
  _columnCache.clear();
  _vehicleTenantCache.clear();
}

/**
 * Resolve a vehicle's tenant_id for the live-map broadcast. Memoized and
 * schema-defensive: returns null (broadcast no-ops) when the table/column is
 * missing or the vehicle is unknown, rather than throwing on the ingest path.
 */
async function resolveVehicleTenant(vehicleId) {
  if (vehicleId == null) return null;
  if (_vehicleTenantCache.has(vehicleId)) return _vehicleTenantCache.get(vehicleId);
  let tenantId = null;
  try {
    const cols = await tableColumns(VEHICLES_TABLE);
    if (cols.has('tenant_id')) {
      const row = await knex(VEHICLES_TABLE)
        .where('id', vehicleId)
        .select('tenant_id')
        .first();
      tenantId = row ? row.tenant_id : null;
    }
  } catch (err) {
    dtLogger.error('telematics_vehicle_tenant_resolve_failed', err, { vehicleId });
    tenantId = null;
  }
  _vehicleTenantCache.set(vehicleId, tenantId);
  return tenantId;
}

/**
 * Broadcast a freshly-persisted ping to the tenant's live map (FN-1672).
 * Fire-and-forget: never awaited by ingestion, never throws.
 */
async function broadcastPing(vehicleId, ping) {
  try {
    const tenantId = await resolveVehicleTenant(vehicleId);
    if (!tenantId) return;
    await emitVehiclePosition({
      tenantId,
      position: {
        vehicleId,
        lat: ping.lat,
        lng: ping.lng,
        speedMph: ping.speedMph ?? null,
        headingDeg: ping.headingDeg ?? null,
        ts: ping.ts || null
      }
    });
  } catch (err) {
    dtLogger.warn('telematics_ping_broadcast_failed', {
      vehicleId,
      error: err.message
    });
  }
}

async function hasTable(table) {
  return knex.schema.hasTable(table).catch(() => false);
}

/**
 * Resolve a provider code → telematics_providers.id. Returns null when the
 * table or row is missing.
 */
async function resolveProviderId(providerCode) {
  if (!(await hasTable(PROVIDERS_TABLE))) return null;
  try {
    const row = await knex(PROVIDERS_TABLE)
      .whereRaw('LOWER(code) = ?', [String(providerCode).toLowerCase()])
      .select('id')
      .first();
    return row ? row.id : null;
  } catch (err) {
    dtLogger.error('telematics_provider_resolve_failed', err, { providerCode });
    return null;
  }
}

/**
 * Resolve a provider device → device row (incl. vehicle_id). Looks up by
 * (provider_id, external_device_id). Returns null when unmatched.
 */
async function resolveDevice(providerId, externalDeviceId) {
  if (!(await hasTable(DEVICES_TABLE))) return null;
  if (externalDeviceId === null || externalDeviceId === undefined) return null;
  try {
    const cols = await tableColumns(DEVICES_TABLE);
    const q = knex(DEVICES_TABLE).where(
      'external_device_id',
      String(externalDeviceId)
    );
    if (providerId !== null && cols.has('provider_id')) {
      q.where('provider_id', providerId);
    }
    return (await q.first()) || null;
  } catch (err) {
    dtLogger.error('telematics_device_resolve_failed', err, {
      providerId,
      externalDeviceId
    });
    return null;
  }
}

/**
 * Update a device's last_seen_at watermark (best-effort).
 */
async function touchDevice(deviceId, ts) {
  if (!deviceId) return;
  try {
    const cols = await tableColumns(DEVICES_TABLE);
    if (!cols.has('last_seen_at')) return;
    await knex(DEVICES_TABLE)
      .where('id', deviceId)
      .update({ last_seen_at: ts || knex.fn.now() });
  } catch (err) {
    dtLogger.error('telematics_device_touch_failed', err, { deviceId });
  }
}

/**
 * Insert one normalized ping. Returns
 *   { inserted: true, pingId }                 — persisted
 *   { inserted: false, reason }                — skipped (no schema / no device / dup)
 *
 * `provider` is the provider code; `ping` is a NormalizedPing from an adapter.
 */
async function persistPing(provider, ping) {
  if (!ping) return { inserted: false, reason: 'empty_ping' };
  if (!(await hasTable(PINGS_TABLE))) {
    return { inserted: false, reason: 'no_pings_table' };
  }

  const providerId = await resolveProviderId(provider);
  const device = await resolveDevice(providerId, ping.externalDeviceId);
  if (!device || device.vehicle_id == null) {
    return { inserted: false, reason: 'device_not_paired' };
  }

  const cols = await tableColumns(PINGS_TABLE);

  // Dedup on (vehicle_id, source_event_id) when the provider supplies an id.
  if (ping.sourceEventId && cols.has('source_event_id')) {
    try {
      const existing = await knex(PINGS_TABLE)
        .where('vehicle_id', device.vehicle_id)
        .where('source_event_id', String(ping.sourceEventId))
        .select('id')
        .first();
      if (existing) {
        await touchDevice(device.id, ping.ts);
        return { inserted: false, reason: 'duplicate', pingId: existing.id };
      }
    } catch (err) {
      // Non-fatal: fall through and attempt the insert.
      dtLogger.error('telematics_ping_dedup_failed', err, {
        vehicleId: device.vehicle_id
      });
    }
  }

  // Build the row from AC-required columns, adding optional ones only when the
  // table actually has them (keeps us forward-compatible with FN-1660).
  const row = { vehicle_id: device.vehicle_id };
  if (cols.has('ts')) row.ts = ping.ts || knex.fn.now();
  if (cols.has('lat')) row.lat = ping.lat;
  if (cols.has('lng')) row.lng = ping.lng;
  if (cols.has('speed_mph')) row.speed_mph = ping.speedMph ?? null;
  if (cols.has('heading_deg')) row.heading_deg = ping.headingDeg ?? null;
  if (cols.has('source_event_id')) {
    row.source_event_id = ping.sourceEventId ? String(ping.sourceEventId) : null;
  }
  if (cols.has('payload')) {
    row.payload = ping.payload ? JSON.stringify(ping.payload) : null;
  }
  if (cols.has('provider_id') && providerId != null) row.provider_id = providerId;
  if (cols.has('tenant_id') && device.tenant_id != null) {
    row.tenant_id = device.tenant_id;
  }

  try {
    const inserted = await knex(PINGS_TABLE).insert(row).returning(['id']);
    const pingId = Array.isArray(inserted)
      ? inserted[0]?.id ?? inserted[0] ?? null
      : null;
    await touchDevice(device.id, ping.ts);
    // Live-map broadcast (FN-1672) — fire-and-forget; must not block or fail
    // ingestion. emitVehiclePosition no-ops when the WS bridge is unconfigured.
    broadcastPing(device.vehicle_id, ping).catch(() => {});
    return { inserted: true, pingId };
  } catch (err) {
    dtLogger.error('telematics_ping_insert_failed', err, {
      provider,
      vehicleId: device.vehicle_id
    });
    return { inserted: false, reason: 'insert_error', error: err.message };
  }
}

/**
 * Persist a batch of normalized pings. Returns aggregate counters.
 */
async function persistPings(provider, pings = []) {
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;
  let unpaired = 0;
  for (const ping of pings) {
    const result = await persistPing(provider, ping);
    if (result.inserted) inserted += 1;
    else if (result.reason === 'duplicate') duplicates += 1;
    else if (result.reason === 'device_not_paired') unpaired += 1;
    else skipped += 1;
  }
  return { received: pings.length, inserted, duplicates, unpaired, skipped };
}

module.exports = {
  persistPing,
  persistPings,
  resolveProviderId,
  resolveDevice,
  resolveVehicleTenant,
  touchDevice,
  broadcastPing,
  _resetColumnCache,
  PINGS_TABLE,
  DEVICES_TABLE,
  PROVIDERS_TABLE,
  VEHICLES_TABLE
};
