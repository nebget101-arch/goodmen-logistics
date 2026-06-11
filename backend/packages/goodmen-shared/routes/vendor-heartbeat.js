'use strict';

const express = require('express');
const router = express.Router();
const vendorPositionService = require('../services/vendor-position.service');
const vendorMatchingService = require('../services/vendor-matching.service');
const roadsideVendorsService = require('../services/roadside-vendors.service');
const dtLogger = require('../utils/logger');

/**
 * @openapi
 * /api/logistics/vendors/{id}/heartbeat:
 *   post:
 *     summary: Record vendor GPS heartbeat
 *     description: >-
 *       Ingests a real-time GPS position for the given vendor. Throttled to
 *       one accepted write per 30 seconds per vendor; excess requests receive
 *       429 with `next_allowed_at`.
 *     tags:
 *       - Vendor GPS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lat, lng]
 *             properties:
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *     responses:
 *       200:
 *         description: Position recorded
 *       400:
 *         description: Validation error
 *       404:
 *         description: Vendor not found
 *       429:
 *         description: Throttled — too many heartbeats
 */
router.post('/:id/heartbeat', async (req, res) => {
  const vendorId = req.params.id;
  const tenantId = req.context?.tenantId;
  const { lat, lng } = req.body || {};

  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  try {
    await roadsideVendorsService.getById(vendorId, tenantId);
    const result = await vendorPositionService.recordHeartbeat(vendorId, tenantId, { lat, lng });

    if (result.throttled) {
      return res.status(429).json({ error: 'heartbeat_throttled', next_allowed_at: result.next_allowed_at });
    }

    res.json({ success: true, data: result.position });
  } catch (err) {
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    dtLogger.error('vendor_heartbeat_failed', { error: err.message, vendor_id: vendorId });
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/logistics/vendors/match:
 *   post:
 *     summary: Find best-matching vendors for a roadside incident
 *     description: >-
 *       Returns vendors ranked by a composite score (distance 70%, capacity 30%)
 *       filtered by active status, GPS freshness (≤5 min), required skills, and
 *       radius. Results are cached 60 s per incident_id; cache is invalidated on
 *       vendor decline.
 *     tags:
 *       - Vendor GPS
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lat, lng]
 *             properties:
 *               incident_id:
 *                 type: string
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *               radius_km:
 *                 type: number
 *                 default: 50
 *               required_skills:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Ranked vendor list
 *       400:
 *         description: Validation error
 */
router.post('/match', async (req, res) => {
  const tenantId = req.context?.tenantId;
  const { incident_id, lat, lng, radius_km, required_skills } = req.body || {};

  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  try {
    const matches = await vendorMatchingService.findMatches({
      incidentId: incident_id || null,
      lat,
      lng,
      radiusKm: radius_km != null ? Number(radius_km) : 50,
      requiredSkills: Array.isArray(required_skills) ? required_skills : [],
      tenantId,
    });

    res.json({ success: true, data: matches });
  } catch (err) {
    dtLogger.error('vendor_match_failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/logistics/vendors/match/invalidate:
 *   post:
 *     summary: Invalidate match cache for an incident
 *     description: Called when a vendor declines a dispatch so the next match query re-runs live.
 *     tags:
 *       - Vendor GPS
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [incident_id]
 *             properties:
 *               incident_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cache invalidated
 */
router.post('/match/invalidate', async (req, res) => {
  const { incident_id } = req.body || {};
  if (!incident_id) {
    return res.status(400).json({ error: 'incident_id is required' });
  }
  vendorMatchingService.invalidateCache(incident_id);
  res.json({ success: true });
});

module.exports = router;
