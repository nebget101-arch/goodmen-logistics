'use strict';

/**
 * FN-1665 — Geofence CRUD API (Story B — Geofence schema + CRUD).
 *
 * REST CRUD under `/api/geofences` plus trigger management. Tenant-scoped: the
 * tenant comes from tenantContextMiddleware (req.context.tenantId) and the
 * owner (created_by) from the authenticated user (req.user.id).
 *
 * Implements the wire contract consumed by the FN-1666 frontend
 * (docs/stories/FN-1654.md → "API Contract"): camelCase { lat, lng } geometry,
 * `{ data, meta }` list envelope, bare Geofence objects for get/create/update.
 * geofence-service.js translates that wire shape to/from the GeoJSON `jsonb`
 * storage (no PostGIS — see FN-1664) and owns the app-side containment math.
 *
 * Mounted by logistics-service:
 *   app.use('/api/geofences', authMiddleware, tenantContextMiddleware, router)
 */

const express = require('express');
const router = express.Router();
const geofenceService = require('../services/geofence-service');
const geocodeService = require('../services/geocode-service');
const dtLogger = require('../utils/logger');

function getTenantContext(req) {
  return req.context && req.context.tenantId ? req.context : null;
}

function getUserId(req) {
  return req.user && (req.user.id || req.user.sub);
}

/**
 * Validate an optional geocode `viewbox` query param: four comma-separated
 * finite numbers (lon,lat,lon,lat). Returns a clean string or null (so a
 * malformed value is ignored rather than forwarded to the upstream geocoder).
 */
function parseViewbox(raw) {
  if (!raw) return null;
  const parts = String(raw).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.join(',');
}

/** Parse the list query string into service filters (wire param names). */
function parseListFilters(req, userId) {
  const filters = {};

  if (req.query.active !== undefined) {
    const raw = String(req.query.active).toLowerCase();
    if (raw === 'true' || raw === '1') filters.active = true;
    else if (raw === 'false' || raw === '0') filters.active = false;
  }

  if (req.query.ownedBy !== undefined) {
    const raw = String(req.query.ownedBy);
    filters.ownedBy = raw.toLowerCase() === 'me' ? userId : raw;
  }

  // near is encoded `lng,lat` (GeoJSON axis order); nearRadiusMeters bounds it.
  if (req.query.near !== undefined) {
    const [lng, lat] = String(req.query.near).split(',').map((s) => s.trim());
    if (lng !== '' && lat !== '' && lng !== undefined && lat !== undefined) {
      filters.near = { lng: Number(lng), lat: Number(lat) };
    }
  }
  if (req.query.nearRadiusMeters !== undefined && req.query.nearRadiusMeters !== '') {
    filters.nearRadiusMeters = Number(req.query.nearRadiusMeters);
  }

  // vehicle_id (per-unit view): keep geofences with a trigger scoped to this
  // vehicle, or a tenant-wide trigger that also applies to it. Accept the
  // snake_case wire name and a camelCase alias.
  const vehicleRaw =
    req.query.vehicle_id !== undefined ? req.query.vehicle_id : req.query.vehicleId;
  if (vehicleRaw !== undefined) {
    const v = String(vehicleRaw).trim();
    if (v) filters.vehicleId = v;
  }

  return filters;
}

/**
 * @openapi
 * /api/geofences:
 *   get:
 *     summary: List geofences for the tenant
 *     description: Filters — active (true/false), ownedBy (user id or "me"), near (lng,lat) + nearRadiusMeters, vehicle_id (per-unit view).
 *     tags: [Geofences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: active, schema: { type: boolean } }
 *       - { in: query, name: ownedBy, schema: { type: string } }
 *       - { in: query, name: near, description: "lng,lat (GeoJSON axis order)", schema: { type: string } }
 *       - { in: query, name: nearRadiusMeters, schema: { type: number } }
 *       - { in: query, name: vehicle_id, description: "Keep geofences whose triggers are scoped to (or tenant-wide for) this vehicle", schema: { type: string } }
 *     responses:
 *       200: { description: "{ data, meta } list of geofences (each with triggers)" }
 *       403: { description: Tenant context missing }
 */
router.get('/', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });
  try {
    const filters = parseListFilters(req, getUserId(req));
    const data = await geofenceService.listGeofences(context, filters);
    return res.json({ data, meta: { total: data.length } });
  } catch (err) {
    dtLogger.error('geofences_list_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to list geofences' });
  }
});

/**
 * @openapi
 * /api/geofences/geocode:
 *   get:
 *     summary: Forward-geocode an address (Nominatim/OSM proxy)
 *     description: >
 *       Server-side proxy to Nominatim for the address-search box. Returns ranked
 *       candidates `{ label, lat, lng, type, address_id? }`; `address_id` is set
 *       when a result resolves to one of the tenant's saved locations. Results are
 *       cached in-process with a short TTL (`meta.cached` flags a cache hit).
 *     tags: [Geofences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, required: true, description: "Free-text address query", schema: { type: string } }
 *     responses:
 *       200: { description: "{ data: [{ label, lat, lng, type, address_id? }], meta }" }
 *       400: { description: q is required }
 *       403: { description: Tenant context missing }
 *       502: { description: Geocoding upstream unavailable }
 */
router.get('/geocode', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'q query parameter is required' });
  const viewbox = parseViewbox(req.query.viewbox); // optional map-view bias; null if absent/invalid
  try {
    const { results, cached } = await geocodeService.geocode(q, { context, viewbox });
    return res.json({ data: results, meta: { total: results.length, cached } });
  } catch (err) {
    dtLogger.error('geofences_geocode_failed', { error: err.message });
    return res.status(502).json({ error: 'Geocoding service unavailable' });
  }
});

/**
 * @openapi
 * /api/geofences/{id}:
 *   get:
 *     summary: Get a geofence with its triggers
 *     tags: [Geofences]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: The geofence }
 *       404: { description: Not found }
 */
router.get('/:id', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });
  try {
    const geofence = await geofenceService.getGeofence(context, req.params.id);
    if (!geofence) return res.status(404).json({ error: 'Geofence not found' });
    return res.json(geofence);
  } catch (err) {
    dtLogger.error('geofences_get_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch geofence' });
  }
});

/**
 * @openapi
 * /api/geofences:
 *   post:
 *     summary: Create a geofence (circle or polygon) with optional triggers
 *     tags: [Geofences]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created geofence }
 *       400: { description: Validation error }
 *       409: { description: Duplicate name in tenant }
 */
router.post('/', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

  const errors = geofenceService.validateGeofenceInput(req.body, { partial: false });
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  try {
    const created = await geofenceService.createGeofence(context, userId, req.body);
    return res.status(201).json(created);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'A geofence with this name already exists' });
    }
    dtLogger.error('geofences_create_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to create geofence' });
  }
});

/**
 * @openapi
 * /api/geofences/{id}:
 *   put:
 *     summary: Update a geofence; triggers (if present) replace the existing set
 *     tags: [Geofences]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Updated geofence }
 *       400: { description: Validation error }
 *       404: { description: Not found }
 *       409: { description: Duplicate name in tenant }
 */
router.put('/:id', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });

  // Geometry fields are keyed to `kind`; a geometry change requires its kind.
  const hasGeometryField =
    req.body &&
    (req.body.center !== undefined ||
      req.body.radiusMeters !== undefined ||
      req.body.vertices !== undefined);
  if (hasGeometryField && (!req.body || req.body.kind === undefined)) {
    return res.status(400).json({
      error: 'Validation failed',
      details: ['kind must be provided when updating geometry (center/radiusMeters/vertices)'],
    });
  }
  const errors = geofenceService.validateGeofenceInput(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  try {
    const updated = await geofenceService.updateGeofence(context, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Geofence not found' });
    return res.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'A geofence with this name already exists' });
    }
    dtLogger.error('geofences_update_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to update geofence' });
  }
});

/**
 * @openapi
 * /api/geofences/{id}:
 *   delete:
 *     summary: Delete a geofence (its triggers cascade)
 *     tags: [Geofences]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
router.delete('/:id', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });
  try {
    const deleted = await geofenceService.deleteGeofence(context, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Geofence not found' });
    return res.status(204).send();
  } catch (err) {
    dtLogger.error('geofences_delete_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to delete geofence' });
  }
});

// ─── Trigger management ────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/geofences/{id}/triggers:
 *   post:
 *     summary: Add a trigger to a geofence
 *     tags: [Geofences]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created trigger }
 *       400: { description: Validation error }
 *       404: { description: Geofence not found }
 */
router.post('/:id/triggers', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });
  const errors = geofenceService.validateTrigger(req.body);
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
  try {
    const created = await geofenceService.addTrigger(context, req.params.id, req.body);
    if (!created) return res.status(404).json({ error: 'Geofence not found' });
    return res.status(201).json(created);
  } catch (err) {
    dtLogger.error('geofence_trigger_create_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to add trigger' });
  }
});

/**
 * @openapi
 * /api/geofences/{id}/triggers/{triggerId}:
 *   put:
 *     summary: Update a trigger
 *     tags: [Geofences]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated trigger }
 *       400: { description: Validation error }
 *       404: { description: Geofence or trigger not found }
 */
router.put('/:id/triggers/:triggerId', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });
  const errors = geofenceService.validateTrigger(req.body);
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });
  try {
    const updated = await geofenceService.updateTrigger(
      context,
      req.params.id,
      req.params.triggerId,
      req.body
    );
    if (!updated) return res.status(404).json({ error: 'Geofence or trigger not found' });
    return res.json(updated);
  } catch (err) {
    dtLogger.error('geofence_trigger_update_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to update trigger' });
  }
});

/**
 * @openapi
 * /api/geofences/{id}/triggers/{triggerId}:
 *   delete:
 *     summary: Remove a trigger from a geofence
 *     tags: [Geofences]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Removed }
 *       404: { description: Geofence or trigger not found }
 */
router.delete('/:id/triggers/:triggerId', async (req, res) => {
  const context = getTenantContext(req);
  if (!context) return res.status(403).json({ error: 'Tenant context missing' });
  try {
    const removed = await geofenceService.removeTrigger(
      context,
      req.params.id,
      req.params.triggerId
    );
    if (!removed) return res.status(404).json({ error: 'Geofence or trigger not found' });
    return res.status(204).send();
  } catch (err) {
    dtLogger.error('geofence_trigger_delete_failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to remove trigger' });
  }
});

/** Postgres unique_violation (duplicate tenant_id + name). */
function isUniqueViolation(err) {
  return err && (err.code === '23505' || /unique/i.test(err.message || ''));
}

module.exports = router;
