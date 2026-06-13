'use strict';

/**
 * FN-1665 — Geofence service (Story B — Geofence schema + CRUD).
 *
 * Data access + geometry logic for dispatcher-defined geofences and their
 * triggers. Backs the `/api/geofences` REST routes (routes/geofences.js).
 *
 * Two coordinate worlds, bridged here:
 *   • Wire shape (the FN-1666 frontend contract, see docs/stories/FN-1654.md):
 *       circle  → { center: { lat, lng }, radiusMeters }
 *       polygon → { vertices: [{ lat, lng }, ...] }  (open ring, ≤40)
 *     plus camelCase trigger fields (eventKind, dwellMinutes, targetUrl, ...).
 *   • Stored shape (FN-1664 — prod has NO PostGIS, so geometry is GeoJSON in a
 *     `jsonb` column and containment is computed app-side here):
 *       circle  → { type: 'Circle',  center: [lng, lat], radius_m }
 *       polygon → { type: 'Polygon', coordinates: [[[lng, lat], ...]] }
 *
 * The geometry math (haversineMeters, pointInCircle, pointInPolygon,
 * geofenceContainsPoint, distanceToGeofenceMeters) operates on the STORED
 * GeoJSON shape and is exported so Story C (FN-1655 event computation) reuses
 * it rather than re-deriving point-in-polygon.
 */

const dbModule = require('../internal/db');

/**
 * Resolve the knex handle lazily. Consumers call setDatabase() at startup; some
 * callers (and tests) require this module before that happens, so we must read
 * the live getter per-call rather than capture it once at module load.
 */
function getDb() {
  return dbModule.knex;
}

const GEOFENCE_KINDS = ['circle', 'polygon'];
const TRIGGER_EVENT_KINDS = ['enter', 'exit', 'dwell'];
const TRIGGER_ACTIONS = ['notify', 'update_load_status', 'webhook'];
// FN-1758: notify-trigger recipients (geofence_trigger_recipients).
const TRIGGER_RECIPIENT_TYPES = ['user', 'email', 'broker'];
const RECIPIENT_CHANNELS = ['email', 'in_app', 'both'];
const DEFAULT_RECIPIENT_CHANNEL = 'both';
const MAX_POLYGON_VERTICES = 40;
const EARTH_RADIUS_M = 6371008.8; // mean Earth radius (meters), matches GeoJSON tooling

// ─── Geometry math (operates on STORED GeoJSON; reused by Story C) ───────────

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance in meters between two [lng, lat] points.
 * Returns Infinity if either point is malformed so callers fail "not near".
 */
function haversineMeters(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  if (![lng1, lat1, lng2, lat2].every((v) => Number.isFinite(Number(v)))) {
    return Infinity;
  }
  const dLat = toRadians(Number(lat2) - Number(lat1));
  const dLng = toRadians(Number(lng2) - Number(lng1));
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRadians(Number(lat1))) *
      Math.cos(toRadians(Number(lat2))) *
      sinLng *
      sinLng;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Outer ring of a GeoJSON polygon geometry, or [] if malformed. */
function polygonRing(geometry) {
  const ring = geometry && geometry.coordinates && geometry.coordinates[0];
  return Array.isArray(ring) ? ring : [];
}

/** True when [lng, lat] is within `radius_m` of a circle geometry's center. */
function pointInCircle(point, geometry) {
  if (!geometry || !Array.isArray(geometry.center)) return false;
  const radius = Number(geometry.radius_m);
  if (!Number.isFinite(radius) || radius <= 0) return false;
  return haversineMeters(point, geometry.center) <= radius;
}

/**
 * Ray-casting point-in-polygon over a GeoJSON ring of [lng, lat] vertices.
 * Works whether or not the ring is explicitly closed (first === last).
 */
function pointInPolygon(point, geometry) {
  const ring = polygonRing(geometry);
  if (ring.length < 3) return false;
  const [x, y] = [Number(point[0]), Number(point[1])];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True when a geofence (circle or polygon) contains the [lng, lat] point. */
function geofenceContainsPoint(geofence, point) {
  if (!geofence) return false;
  const geometry = normalizeGeometry(geofence.geometry);
  if (geofence.kind === 'circle') return pointInCircle(point, geometry);
  if (geofence.kind === 'polygon') return pointInPolygon(point, geometry);
  return false;
}

/**
 * Approximate distance in meters from a point to a geofence: 0 when the point
 * is inside; otherwise distance to the circle edge, or the nearest polygon
 * vertex. Used to rank/scope the `near-point` list filter — not a precise
 * point-to-edge measure, which app-side math without PostGIS does not warrant.
 */
function distanceToGeofenceMeters(geofence, point) {
  if (geofenceContainsPoint(geofence, point)) return 0;
  const geometry = normalizeGeometry(geofence && geofence.geometry);
  if (geofence && geofence.kind === 'circle' && geometry) {
    const toCenter = haversineMeters(point, geometry.center);
    const radius = Number(geometry.radius_m) || 0;
    return Math.max(0, toCenter - radius);
  }
  const ring = polygonRing(geometry);
  if (!ring.length) return Infinity;
  return ring.reduce(
    (min, vertex) => Math.min(min, haversineMeters(point, vertex)),
    Infinity
  );
}

// ─── Validation (validates the WIRE payload) ─────────────────────────────────

function isFiniteNumber(v) {
  return Number.isFinite(Number(v));
}

function isLatLng(point) {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return false;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Validate the circle/polygon geometry fields for a given kind. Returns string[]. */
function validateGeometryFields(kind, body) {
  const errors = [];
  if (kind === 'circle') {
    if (!isLatLng(body.center)) {
      errors.push('center must be { lat, lng } for a circle geofence');
    }
    if (!isFiniteNumber(body.radiusMeters) || Number(body.radiusMeters) <= 0) {
      errors.push('radiusMeters must be a positive number for a circle geofence');
    }
  } else if (kind === 'polygon') {
    if (!Array.isArray(body.vertices)) {
      errors.push('vertices must be an array of { lat, lng } for a polygon geofence');
    } else {
      if (body.vertices.length < 3) {
        errors.push('polygon must have at least 3 vertices');
      }
      if (body.vertices.length > MAX_POLYGON_VERTICES) {
        errors.push(`polygon must have at most ${MAX_POLYGON_VERTICES} vertices`);
      }
      if (!body.vertices.every(isLatLng)) {
        errors.push('every polygon vertex must be { lat, lng }');
      }
    }
  }
  return errors;
}

/**
 * Validate a create/update payload (wire shape). With { partial: true } (PUT)
 * only the fields present are validated; geometry fields are validated whenever
 * `kind` is supplied so the two stay consistent.
 */
function validateGeofenceInput(body, { partial = false } = {}) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['request body must be an object'];
  }

  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      errors.push('name is required and must be a non-empty string');
    }
  }

  const hasKind = body.kind !== undefined;
  if (!partial || hasKind) {
    if (!GEOFENCE_KINDS.includes(body.kind)) {
      errors.push(`kind must be one of: ${GEOFENCE_KINDS.join(', ')}`);
    } else {
      errors.push(...validateGeometryFields(body.kind, body));
    }
  }

  if (body.triggers !== undefined) {
    errors.push(...validateTriggers(body.triggers));
  }
  return errors;
}

/** Validate a single wire trigger object. Returns string[] of errors. */
function validateTrigger(trigger, index) {
  const prefix = index === undefined ? 'trigger' : `triggers[${index}]`;
  const errors = [];
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
    return [`${prefix} must be an object`];
  }
  if (!TRIGGER_EVENT_KINDS.includes(trigger.eventKind)) {
    errors.push(`${prefix}.eventKind must be one of: ${TRIGGER_EVENT_KINDS.join(', ')}`);
  }
  if (!TRIGGER_ACTIONS.includes(trigger.action)) {
    errors.push(`${prefix}.action must be one of: ${TRIGGER_ACTIONS.join(', ')}`);
  }
  if (trigger.eventKind === 'dwell') {
    if (!isFiniteNumber(trigger.dwellMinutes) || Number(trigger.dwellMinutes) <= 0) {
      errors.push(`${prefix}.dwellMinutes must be a positive number when eventKind is 'dwell'`);
    }
  }
  if (trigger.action === 'webhook') {
    if (typeof trigger.targetUrl !== 'string' || !/^https?:\/\//i.test(trigger.targetUrl)) {
      errors.push(`${prefix}.targetUrl must be an http(s) URL when action is 'webhook'`);
    }
  }
  if (trigger.recipients !== undefined) {
    errors.push(...validateRecipients(trigger.recipients, prefix));
  }
  return errors;
}

function validateTriggers(triggers) {
  if (!Array.isArray(triggers)) return ['triggers must be an array'];
  return triggers.flatMap((t, i) => validateTrigger(t, i));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate one wire recipient (FN-1758). Exactly one identity field must be
 * set, matching recipient_type: user→userId, email→email, broker→brokerId.
 * channel is optional and defaults to 'both'.
 */
function validateRecipient(recipient, label) {
  const prefix = label || 'recipient';
  const errors = [];
  if (!recipient || typeof recipient !== 'object' || Array.isArray(recipient)) {
    return [`${prefix} must be an object`];
  }
  if (!TRIGGER_RECIPIENT_TYPES.includes(recipient.recipientType)) {
    errors.push(`${prefix}.recipientType must be one of: ${TRIGGER_RECIPIENT_TYPES.join(', ')}`);
  }
  if (recipient.channel !== undefined && !RECIPIENT_CHANNELS.includes(recipient.channel)) {
    errors.push(`${prefix}.channel must be one of: ${RECIPIENT_CHANNELS.join(', ')}`);
  }
  if (recipient.recipientType === 'user') {
    if (!recipient.userId) errors.push(`${prefix}.userId is required when recipientType is 'user'`);
  } else if (recipient.recipientType === 'email') {
    if (typeof recipient.email !== 'string' || !EMAIL_RE.test(recipient.email)) {
      errors.push(`${prefix}.email must be a valid email address when recipientType is 'email'`);
    }
  } else if (recipient.recipientType === 'broker') {
    if (!recipient.brokerId) errors.push(`${prefix}.brokerId is required when recipientType is 'broker'`);
  }
  return errors;
}

function validateRecipients(recipients, triggerPrefix) {
  if (!Array.isArray(recipients)) return [`${triggerPrefix || 'trigger'}.recipients must be an array`];
  return recipients.flatMap((r, i) => validateRecipient(r, `${triggerPrefix || 'trigger'}.recipients[${i}]`));
}

// ─── Wire ↔ storage mapping ──────────────────────────────────────────────────

/** pg returns jsonb as an object, but stubs/older drivers may hand back a string. */
function normalizeGeometry(geometry) {
  if (typeof geometry === 'string') {
    try {
      return JSON.parse(geometry);
    } catch (_err) {
      return null;
    }
  }
  return geometry || null;
}

/** Wire payload → stored GeoJSON geometry. Polygon ring is closed for valid GeoJSON. */
function geometryFromPayload(body) {
  if (body.kind === 'circle') {
    return {
      type: 'Circle',
      center: [Number(body.center.lng), Number(body.center.lat)],
      radius_m: Number(body.radiusMeters),
    };
  }
  const ring = body.vertices.map((v) => [Number(v.lng), Number(v.lat)]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]); // close the ring (GeoJSON requirement)
  }
  return { type: 'Polygon', coordinates: [ring] };
}

/** Stored geofence row (+ trigger rows + recipients-by-trigger) → wire Geofence object. */
function toWireGeofence(row, triggerRows = [], recipientsByTrigger = {}) {
  if (!row) return null;
  const geometry = normalizeGeometry(row.geometry) || {};
  const wire = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    active: row.is_active,
    addressId: row.address_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    triggers: triggerRows.map((t) => toWireTrigger(t, recipientsByTrigger[t.id] || [])),
  };
  if (row.kind === 'circle' && Array.isArray(geometry.center)) {
    wire.center = { lng: geometry.center[0], lat: geometry.center[1] };
    wire.radiusMeters = geometry.radius_m;
  } else if (row.kind === 'polygon') {
    const ring = polygonRing(geometry).slice();
    // Present an OPEN ring on the wire (drop the GeoJSON closing vertex) so the
    // UI's vertex count and ≤40 guard match what the user actually drew.
    if (ring.length > 1) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) ring.pop();
    }
    wire.vertices = ring.map((p) => ({ lng: p[0], lat: p[1] }));
  }
  return wire;
}

/** Stored trigger row (+ recipient rows) → wire trigger object. */
function toWireTrigger(row, recipientRows = []) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id || null,
    eventKind: row.event_kind,
    dwellMinutes: row.dwell_minutes != null ? row.dwell_minutes : null,
    action: row.action,
    targetUrl: row.target_url || null,
    recipients: recipientRows.map(toWireRecipient),
  };
}

/** Stored geofence_trigger_recipients row → wire recipient object (FN-1758). */
function toWireRecipient(row) {
  return {
    id: row.id,
    recipientType: row.recipient_type,
    userId: row.user_id || null,
    email: row.email || null,
    brokerId: row.broker_id || null,
    channel: row.channel || DEFAULT_RECIPIENT_CHANNEL,
  };
}

/** Wire trigger → insertable geofence_triggers row. */
function triggerInsertRow(geofenceId, trigger) {
  return {
    geofence_id: geofenceId,
    vehicle_id: trigger.vehicleId || null,
    event_kind: trigger.eventKind,
    dwell_minutes: trigger.eventKind === 'dwell' ? Number(trigger.dwellMinutes) : null,
    action: trigger.action,
    target_url: trigger.action === 'webhook' ? trigger.targetUrl : null,
  };
}

/** Wire recipient → insertable geofence_trigger_recipients row (FN-1758). */
function recipientInsertRow(triggerId, recipient) {
  const type = recipient.recipientType;
  return {
    trigger_id: triggerId,
    recipient_type: type,
    user_id: type === 'user' ? recipient.userId : null,
    email: type === 'email' ? recipient.email : null,
    broker_id: type === 'broker' ? recipient.brokerId : null,
    channel: recipient.channel || DEFAULT_RECIPIENT_CHANNEL,
  };
}

/**
 * Load recipients for a set of trigger ids → { [triggerId]: rows[] } (FN-1758).
 * Returns {} when there are no triggers. Safe before the FN-1757 migration is
 * applied: a missing `geofence_trigger_recipients` table yields no recipients
 * rather than throwing, so geofence reads keep working.
 */
async function loadRecipients(triggerIds, conn = getDb()) {
  if (!triggerIds.length) return {};
  let rows;
  try {
    rows = await conn('geofence_trigger_recipients').whereIn('trigger_id', triggerIds);
  } catch (_err) {
    return {};
  }
  return rows.reduce((acc, row) => {
    (acc[row.trigger_id] = acc[row.trigger_id] || []).push(row);
    return acc;
  }, {});
}

/** Insert the recipients of one trigger (no-op when none). */
async function insertTriggerRecipients(triggerId, recipients, conn) {
  if (!Array.isArray(recipients) || !recipients.length) return;
  await conn('geofence_trigger_recipients').insert(
    recipients.map((r) => recipientInsertRow(triggerId, r))
  );
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * List geofences for the tenant (wire shape), with optional filters:
 *   active:           boolean — restrict to is_active = value
 *   ownedBy:          user id — restrict to created_by = value
 *   near:             { lng, lat } — keep geofences containing the point, or
 *                     (with nearRadiusMeters) within that distance
 *   nearRadiusMeters: number — distance bound for the near filter
 * Results are nearest-first when `near` is supplied; each carries its triggers.
 */
async function listGeofences(context, filters = {}, conn = getDb()) {
  const tenantId = context && context.tenantId;
  if (!tenantId) return [];

  const qb = conn('geofences').where({ tenant_id: tenantId });
  if (typeof filters.active === 'boolean') {
    qb.andWhere('is_active', filters.active);
  }
  if (filters.ownedBy) {
    qb.andWhere('created_by', filters.ownedBy);
  }
  qb.orderBy('created_at', 'desc');

  const rows = (await qb).map((r) => ({ ...r, geometry: normalizeGeometry(r.geometry) }));

  let selected = rows;
  const near = filters.near;
  if (near && isFiniteNumber(near.lng) && isFiniteNumber(near.lat)) {
    const point = [Number(near.lng), Number(near.lat)];
    const radius = isFiniteNumber(filters.nearRadiusMeters)
      ? Number(filters.nearRadiusMeters)
      : null;
    selected = rows
      .map((g) => ({ g, distance: distanceToGeofenceMeters(g, point) }))
      .filter(({ distance }) => (radius == null ? distance === 0 : distance <= radius))
      .sort((a, b) => a.distance - b.distance)
      .map(({ g }) => g);
  }

  const ids = selected.map((g) => g.id);
  const triggersByGeofence = await loadTriggers(ids, conn);
  const allTriggerIds = Object.values(triggersByGeofence).flat().map((t) => t.id);
  const recipientsByTrigger = await loadRecipients(allTriggerIds, conn);
  return selected.map((g) =>
    toWireGeofence(g, triggersByGeofence[g.id] || [], recipientsByTrigger)
  );
}

async function loadTriggers(geofenceIds, conn = getDb()) {
  if (!geofenceIds.length) return {};
  const rows = await conn('geofence_triggers').whereIn('geofence_id', geofenceIds);
  return rows.reduce((acc, row) => {
    (acc[row.geofence_id] = acc[row.geofence_id] || []).push(row);
    return acc;
  }, {});
}

/** Fetch a single tenant-scoped geofence (wire shape) with its triggers, or null. */
async function getGeofence(context, id, conn = getDb()) {
  const tenantId = context && context.tenantId;
  if (!tenantId) return null;
  const row = await conn('geofences').where({ id, tenant_id: tenantId }).first();
  if (!row) return null;
  const triggers = await conn('geofence_triggers').where({ geofence_id: id });
  const recipientsByTrigger = await loadRecipients(triggers.map((t) => t.id), conn);
  return toWireGeofence(row, triggers, recipientsByTrigger);
}

/** Create a geofence (+ optional triggers) atomically. Returns the wire record. */
async function createGeofence(context, userId, body) {
  const tenantId = context && context.tenantId;
  return getDb().transaction(async (trx) => {
    const insertRow = {
      tenant_id: tenantId,
      name: body.name.trim(),
      kind: body.kind,
      geometry: JSON.stringify(geometryFromPayload(body)),
      address_id: body.addressId || null,
      is_active: body.active === undefined ? true : !!body.active,
      created_by: userId,
    };
    const [created] = await trx('geofences').insert(insertRow).returning('*');

    const triggers = Array.isArray(body.triggers) ? body.triggers : [];
    for (const trigger of triggers) {
      const [insertedTrigger] = await trx('geofence_triggers')
        .insert(triggerInsertRow(created.id, trigger))
        .returning('*');
      await insertTriggerRecipients(insertedTrigger.id, trigger.recipients, trx);
    }
    const insertedTriggers = await trx('geofence_triggers').where({ geofence_id: created.id });
    const recipientsByTrigger = await loadRecipients(insertedTriggers.map((t) => t.id), trx);
    return toWireGeofence(created, insertedTriggers, recipientsByTrigger);
  });
}

/**
 * Update a tenant-scoped geofence. Only supplied fields change. When `triggers`
 * is present it fully replaces the existing trigger set. Returns the wire
 * record, or null if no such geofence in the tenant.
 */
async function updateGeofence(context, id, body) {
  const tenantId = context && context.tenantId;
  if (!tenantId) return null;
  return getDb().transaction(async (trx) => {
    const existing = await trx('geofences').where({ id, tenant_id: tenantId }).first();
    if (!existing) return null;

    const patch = { updated_at: trx.fn.now() };
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.kind !== undefined) {
      patch.kind = body.kind;
      patch.geometry = JSON.stringify(geometryFromPayload(body));
    }
    if (body.addressId !== undefined) patch.address_id = body.addressId || null;
    if (body.active !== undefined) patch.is_active = !!body.active;

    const [updated] = await trx('geofences')
      .where({ id, tenant_id: tenantId })
      .update(patch)
      .returning('*');

    if (body.triggers !== undefined) {
      // Clear recipients of the existing triggers first (the DB cascades on the
      // trigger delete, but we delete explicitly so the in-memory test stub and
      // pre-FN-1757 environments behave the same).
      const existingTriggers = await trx('geofence_triggers').where({ geofence_id: id });
      await deleteRecipientsForTriggers(existingTriggers.map((t) => t.id), trx);
      await trx('geofence_triggers').where({ geofence_id: id }).del();
      if (Array.isArray(body.triggers) && body.triggers.length) {
        for (const trigger of body.triggers) {
          const [insertedTrigger] = await trx('geofence_triggers')
            .insert(triggerInsertRow(id, trigger))
            .returning('*');
          await insertTriggerRecipients(insertedTrigger.id, trigger.recipients, trx);
        }
      }
    }
    const triggers = await trx('geofence_triggers').where({ geofence_id: id });
    const recipientsByTrigger = await loadRecipients(triggers.map((t) => t.id), trx);
    return toWireGeofence(updated, triggers, recipientsByTrigger);
  });
}

/** Delete all recipients belonging to the given trigger ids (no-op when empty). */
async function deleteRecipientsForTriggers(triggerIds, conn) {
  if (!triggerIds.length) return;
  try {
    await conn('geofence_trigger_recipients').whereIn('trigger_id', triggerIds).del();
  } catch (_err) {
    // table may not exist yet (pre-FN-1757) — nothing to clear
  }
}

/** Delete a tenant-scoped geofence (triggers cascade). Returns true if deleted. */
async function deleteGeofence(context, id, conn = getDb()) {
  const tenantId = context && context.tenantId;
  if (!tenantId) return false;
  const count = await conn('geofences').where({ id, tenant_id: tenantId }).del();
  return count > 0;
}

// ─── Trigger management ────────────────────────────────────────────────────────

/** Add a trigger to a tenant-scoped geofence. Returns the wire trigger, or null. */
async function addTrigger(context, geofenceId, trigger, conn = getDb()) {
  const tenantId = context && context.tenantId;
  if (!tenantId) return null;
  const geofence = await conn('geofences').where({ id: geofenceId, tenant_id: tenantId }).first();
  if (!geofence) return null;
  const [created] = await conn('geofence_triggers')
    .insert(triggerInsertRow(geofenceId, trigger))
    .returning('*');
  await insertTriggerRecipients(created.id, trigger.recipients, conn);
  const recipientsByTrigger = await loadRecipients([created.id], conn);
  return toWireTrigger(created, recipientsByTrigger[created.id] || []);
}

/** Update a trigger that belongs to a tenant-scoped geofence. Returns the wire trigger, or null. */
async function updateTrigger(context, geofenceId, triggerId, trigger, conn = getDb()) {
  const tenantId = context && context.tenantId;
  if (!tenantId) return null;
  const geofence = await conn('geofences').where({ id: geofenceId, tenant_id: tenantId }).first();
  if (!geofence) return null;
  const patch = { ...triggerInsertRow(geofenceId, trigger), updated_at: conn.fn.now() };
  const [updated] = await conn('geofence_triggers')
    .where({ id: triggerId, geofence_id: geofenceId })
    .update(patch)
    .returning('*');
  if (!updated) return null;
  // When `recipients` is supplied it fully replaces this trigger's recipient set.
  if (trigger.recipients !== undefined) {
    await deleteRecipientsForTriggers([triggerId], conn);
    await insertTriggerRecipients(triggerId, trigger.recipients, conn);
  }
  const recipientsByTrigger = await loadRecipients([triggerId], conn);
  return toWireTrigger(updated, recipientsByTrigger[triggerId] || []);
}

/** Remove a trigger from a tenant-scoped geofence. Returns true if removed. */
async function removeTrigger(context, geofenceId, triggerId, conn = getDb()) {
  const tenantId = context && context.tenantId;
  if (!tenantId) return false;
  const geofence = await conn('geofences').where({ id: geofenceId, tenant_id: tenantId }).first();
  if (!geofence) return false;
  const count = await conn('geofence_triggers')
    .where({ id: triggerId, geofence_id: geofenceId })
    .del();
  return count > 0;
}

module.exports = {
  // constants
  GEOFENCE_KINDS,
  TRIGGER_EVENT_KINDS,
  TRIGGER_ACTIONS,
  TRIGGER_RECIPIENT_TYPES,
  RECIPIENT_CHANNELS,
  MAX_POLYGON_VERTICES,
  // geometry math (operates on stored GeoJSON; reused by Story C / FN-1655)
  haversineMeters,
  pointInCircle,
  pointInPolygon,
  geofenceContainsPoint,
  distanceToGeofenceMeters,
  // wire ↔ storage mapping
  geometryFromPayload,
  toWireGeofence,
  toWireTrigger,
  toWireRecipient,
  // validation
  validateGeometryFields,
  validateGeofenceInput,
  validateTrigger,
  validateTriggers,
  validateRecipient,
  validateRecipients,
  // crud
  listGeofences,
  getGeofence,
  createGeofence,
  updateGeofence,
  deleteGeofence,
  // triggers
  addTrigger,
  updateTrigger,
  removeTrigger,
};
