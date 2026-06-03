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
const dtLogger = require('../utils/logger');

function getTenantContext(req) {
  return req.context && req.context.tenantId ? req.context : null;
}

function getUserId(req) {
  return req.user && (req.user.id || req.user.sub);
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

  return filters;
}

/**
 * @openapi
 * /api/geofences:
 *   get:
 *     summary: List geofences for the tenant
 *     description: Filters — active (true/false), ownedBy (user id or "me"), near (lng,lat) + nearRadiusMeters.
 *     tags: [Geofences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: active, schema: { type: boolean } }
 *       - { in: query, name: ownedBy, schema: { type: string } }
 *       - { in: query, name: near, description: "lng,lat (GeoJSON axis order)", schema: { type: string } }
 *       - { in: query, name: nearRadiusMeters, schema: { type: number } }
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
