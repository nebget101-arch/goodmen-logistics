const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../internal/db');
const auth = require('./auth-middleware');
const { normalizePlanId } = require('../config/plans');

// Protect all locations routes: admin, fleet (legacy); RBAC locations.view / locations.manage can be added later
router.use(auth(['admin', 'fleet']));

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

// GET all locations
router.get('/', async (req, res) => {
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

// GET location by ID
router.get('/:id', async (req, res) => {
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

// POST create new location
router.post('/', async (req, res) => {
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

// PUT update location
router.put('/:id', async (req, res) => {
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

// DELETE location
router.delete('/:id', async (req, res) => {
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
