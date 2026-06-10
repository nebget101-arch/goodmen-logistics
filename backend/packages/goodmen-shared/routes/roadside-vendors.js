'use strict';

/**
 * FN-1249 — Roadside v2 vendor CRUD API.
 *
 * Mounted by logistics-service at /api/logistics/vendors (to avoid collision
 * with the legacy MasterEntity vendor search at /api/vendors which proxies
 * to vehicles-maintenance-service).
 *
 * Auth: all endpoints require a valid JWT (authMiddleware + tenantContextMiddleware
 * are applied by the caller). Write operations (POST, PUT, PATCH, DELETE) are
 * further restricted to the `admin` role.
 *
 * Tenant scoping:
 *   - Reads: private vendors for the caller's tenant + all marketplace vendors
 *     (tenant_id IS NULL).
 *   - Writes: only the owning tenant can mutate a private vendor; marketplace
 *     vendors can only be mutated by `admin` users from any tenant.
 */

const express = require('express');
const router = express.Router();
const vendorsSvc = require('../services/roadside-vendors.service');
const dtLogger = require('../utils/logger');

function getTenantId(req) {
  return req.context?.tenantId || req.user?.tenant_id || req.user?.tenantId || null;
}

function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin role required' });
  }
  next();
}

/**
 * @openapi
 * /api/logistics/vendors:
 *   get:
 *     summary: List roadside vendors (tenant + marketplace)
 *     tags: [Vendors (Roadside)]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [active, suspended] } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50, maximum: 200 } }
 *       - { in: query, name: offset, schema: { type: integer, default: 0 } }
 *     responses:
 *       200: { description: "{ success, data: Vendor[] }" }
 *       403: { description: Tenant context missing }
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context missing' });

  try {
    const rows = await vendorsSvc.list({
      tenantId,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', '/api/logistics/vendors', 200, duration, { count: rows.length });
    res.json({ success: true, data: rows });
  } catch (err) {
    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', '/api/logistics/vendors', 500, duration);
    dtLogger.error('roadside_vendors_list_failed', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @openapi
 * /api/logistics/vendors/stats:
 *   get:
 *     summary: Vendor count and status distribution (telemetry)
 *     tags: [Vendors (Roadside)]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, data: { total, distribution } }" }
 */
router.get('/stats', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context missing' });

  try {
    const data = await vendorsSvc.stats(tenantId);
    res.json({ success: true, data });
  } catch (err) {
    dtLogger.error('roadside_vendors_stats_failed', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @openapi
 * /api/logistics/vendors/{vendorId}:
 *   get:
 *     summary: Get a roadside vendor by ID
 *     tags: [Vendors (Roadside)]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ success, data: Vendor }" }
 *       404: { description: Not found }
 */
router.get('/:vendorId', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context missing' });

  try {
    const row = await vendorsSvc.getById(req.params.vendorId, tenantId);
    res.json({ success: true, data: row });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    dtLogger.error('roadside_vendor_get_failed', { vendor_id: req.params.vendorId, error: err.message });
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * @openapi
 * /api/logistics/vendors:
 *   post:
 *     summary: Create a roadside vendor
 *     tags: [Vendors (Roadside)]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               skills: { type: array, items: { type: string } }
 *               capacity: { type: integer, minimum: 0 }
 *               base_location:
 *                 type: object
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *               status: { type: string, enum: [active, suspended] }
 *     responses:
 *       201: { description: "{ success, data: Vendor }" }
 *       400: { description: Validation error }
 */
router.post('/', requireAdmin, async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context missing' });

  try {
    const row = await vendorsSvc.create({
      tenantId,
      name: req.body.name,
      skills: req.body.skills,
      capacity: req.body.capacity,
      base_location: req.body.base_location,
      status: req.body.status,
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    dtLogger.error('roadside_vendor_create_failed', { error: err.message });
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * @openapi
 * /api/logistics/vendors/{vendorId}:
 *   put:
 *     summary: Update a roadside vendor
 *     tags: [Vendors (Roadside)]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               skills: { type: array, items: { type: string } }
 *               capacity: { type: integer, minimum: 0 }
 *               base_location:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *     responses:
 *       200: { description: "{ success, data: Vendor }" }
 *       400: { description: Validation error }
 *       404: { description: Not found }
 */
router.put('/:vendorId', requireAdmin, async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context missing' });

  try {
    const row = await vendorsSvc.update(req.params.vendorId, tenantId, {
      name: req.body.name,
      skills: req.body.skills,
      capacity: req.body.capacity,
      base_location: req.body.base_location,
    });
    res.json({ success: true, data: row });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    dtLogger.error('roadside_vendor_update_failed', { vendor_id: req.params.vendorId, error: err.message });
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * @openapi
 * /api/logistics/vendors/{vendorId}/status:
 *   patch:
 *     summary: Set vendor status (active / suspended)
 *     tags: [Vendors (Roadside)]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [active, suspended] }
 *     responses:
 *       200: { description: "{ success, data: Vendor }" }
 *       400: { description: Validation error }
 *       404: { description: Not found }
 */
router.patch('/:vendorId/status', requireAdmin, async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context missing' });

  try {
    const row = await vendorsSvc.setStatus(req.params.vendorId, tenantId, req.body.status);
    res.json({ success: true, data: row });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    dtLogger.error('roadside_vendor_status_change_failed', { vendor_id: req.params.vendorId, error: err.message });
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
