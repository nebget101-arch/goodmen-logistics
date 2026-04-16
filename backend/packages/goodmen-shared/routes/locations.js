const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../internal/db');
const auth = require('./auth-middleware');
const { loadUserRbac, requirePermission, requireAnyPermission } = require('../middleware/rbac-middleware');
const { normalizePlanId } = require('../config/plans');

// RBAC: load user permissions on all locations routes
router.use(auth(['admin', 'fleet', 'shop_manager', 'parts_manager', 'parts_clerk', 'inventory_auditor', 'executive_read_only', 'company_accountant']));
router.use(loadUserRbac);

const COLS = 'id, name, address, settings, code, location_type, active, created_at, updated_at';

async function getTenantContext(req) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) return { tenantId: null, planId: 'basic' };

  const userResult = await query('SELECT tenant_id FROM users WHERE id = $1', [userId]);
  const tenantId = userResult.rows?.[0]?.tenant_id || null;
  if (!tenantId) return { tenantId: null, planId: 'basic' };

  const tenantResult = await query('SELECT subscription_plan FROM tenants WHERE id = $1', [tenantId]);
  const planId = normalizePlanId(tenantResult.rows?.[0]?.subscription_plan, 'basic');
  return { tenantId, planId };
}

function supportsLocations(planId) {
  return planId === 'end_to_end' || planId === 'enterprise';
}

/**
 * @openapi
 * /api/locations:
 *   get:
 *     summary: List all locations
 *     description: Returns all locations for the current tenant. Only available on End-to-End and Enterprise plans. Returns an empty array for other plans.
 *     tags:
 *       - Locations
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of locations
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   name:
 *                     type: string
 *                   address:
 *                     type: string
 *                   settings:
 *                     type: object
 *                   code:
 *                     type: string
 *                   location_type:
 *                     type: string
 *                   active:
 *                     type: boolean
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                   updated_at:
 *                     type: string
 *                     format: date-time
 *       403:
 *         description: Tenant context missing
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('locations.view'), async (req, res) => {
  try {
    const { tenantId, planId } = await getTenantContext(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });
    if (!supportsLocations(planId)) return res.json([]);

    const result = await query(`SELECT ${COLS} FROM locations WHERE tenant_id = $1 ORDER BY name`, [tenantId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch locations', error: err.message });
  }
});

/**
 * @openapi
 * /api/locations/{id}:
 *   get:
 *     summary: Get location by ID
 *     description: Returns a single location by its UUID. Only available on End-to-End and Enterprise plans.
 *     tags:
 *       - Locations
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
 *         description: Location details
 *       403:
 *         description: Tenant context missing or plan not supported
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.get('/:id', requirePermission('locations.view'), async (req, res) => {
  try {
    const { tenantId, planId } = await getTenantContext(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });
    if (!supportsLocations(planId)) return res.status(403).json({ message: 'Locations are not available for this subscription plan' });

    const result = await query(`SELECT ${COLS} FROM locations WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch location', error: err.message });
  }
});

/**
 * @openapi
 * /api/locations:
 *   post:
 *     summary: Create a new location
 *     description: Creates a new location for the current tenant. Only available on Advanced (End-to-End) and Enterprise plans.
 *     tags:
 *       - Locations
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               address:
 *                 type: string
 *               settings:
 *                 type: object
 *               code:
 *                 type: string
 *               location_type:
 *                 type: string
 *               active:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Location created
 *       403:
 *         description: Tenant context missing or plan not supported
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('locations.manage'), async (req, res) => {
  const { name, address, settings, code, location_type, active } = req.body;
  try {
    const { tenantId, planId } = await getTenantContext(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });
    if (!supportsLocations(planId)) {
      return res.status(403).json({ message: 'Locations are available only for Advanced and Enterprise plans' });
    }

    const result = await query(
      `INSERT INTO locations (id, tenant_id, name, address, settings, code, location_type, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING ${COLS}`,
      [uuidv4(), tenantId, name, address || null, settings || {}, code || null, location_type || null, active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create location', error: err.message });
  }
});

/**
 * @openapi
 * /api/locations/{id}:
 *   put:
 *     summary: Update a location
 *     description: Updates an existing location by ID. Fields not provided are left unchanged (COALESCE).
 *     tags:
 *       - Locations
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               address:
 *                 type: string
 *               settings:
 *                 type: object
 *               code:
 *                 type: string
 *               location_type:
 *                 type: string
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated location
 *       403:
 *         description: Tenant context missing or plan not supported
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('locations.manage'), async (req, res) => {
  const { name, address, settings, code, location_type, active } = req.body;
  try {
    const { tenantId, planId } = await getTenantContext(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });
    if (!supportsLocations(planId)) {
      return res.status(403).json({ message: 'Locations are available only for Advanced and Enterprise plans' });
    }

    const result = await query(
      `UPDATE locations SET name = COALESCE($1, name), address = COALESCE($2, address), settings = COALESCE($3, settings),
       code = COALESCE($4, code), location_type = COALESCE($5, location_type), active = COALESCE($6, active), updated_at = NOW()
       WHERE id = $7 AND tenant_id = $8 RETURNING ${COLS}`,
      [name, address, settings, code, location_type, active, req.params.id, tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update location', error: err.message });
  }
});

/**
 * @openapi
 * /api/locations/{id}:
 *   delete:
 *     summary: Delete a location
 *     description: Permanently deletes a location by ID.
 *     tags:
 *       - Locations
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
 *         description: Deleted location
 *       403:
 *         description: Tenant context missing or plan not supported
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('locations.manage'), async (req, res) => {
  try {
    const { tenantId, planId } = await getTenantContext(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });
    if (!supportsLocations(planId)) {
      return res.status(403).json({ message: 'Locations are available only for Advanced and Enterprise plans' });
    }

    const result = await query(`DELETE FROM locations WHERE id = $1 AND tenant_id = $2 RETURNING ${COLS}`, [req.params.id, tenantId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete location', error: err.message });
  }
});

module.exports = router;
