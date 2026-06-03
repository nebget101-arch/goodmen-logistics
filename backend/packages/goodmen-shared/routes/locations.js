const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../internal/db');
const auth = require('./auth-middleware');
const { loadUserRbac, requirePermission } = require('../middleware/rbac-middleware');

// RBAC: load user permissions on all locations routes
router.use(auth(['admin', 'fleet', 'shop_manager', 'parts_manager', 'parts_clerk', 'inventory_auditor', 'executive_read_only', 'company_accountant']));
router.use(loadUserRbac);

const VALID_TYPES = ['SHOP', 'YARD', 'DROP_YARD', 'WAREHOUSE', 'OFFICE', 'TERMINAL'];

// Columns returned in list responses (excludes large JSONB / verbose fields)
const LIST_COLS = `
  id, name, address, city, state, zip, code,
  location_type, active, timezone, contact_name,
  created_at, updated_at
`.trim();

// Columns returned in detail / mutation responses
const DETAIL_COLS = `
  id, name, address, city, state, zip, phone, email, contact_name,
  timezone, operating_hours, settings, code, location_type, active,
  created_at, updated_at
`.trim();

async function getTenantId(req) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) return null;
  const result = await query('SELECT tenant_id FROM users WHERE id = $1', [userId]);
  return result.rows?.[0]?.tenant_id || null;
}

/**
 * @openapi
 * /api/locations:
 *   get:
 *     summary: List locations with filters and pagination
 *     tags:
 *       - Locations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *         description: Filter by location_type (SHOP, YARD, DROP_YARD, WAREHOUSE, OFFICE, TERMINAL)
 *       - in: query
 *         name: active
 *         schema: { type: boolean }
 *         description: Filter by active flag (true/false). Omit for all.
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive search on name, code, address, city
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 25, maximum: 200 }
 *     responses:
 *       200:
 *         description: Paginated list of locations
 *       403:
 *         description: Tenant context missing
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('locations.view'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '25', 10), 1), 200);
    const offset = (page - 1) * pageSize;

    const where = ['tenant_id = $1'];
    const params = [tenantId];

    // type filter
    if (req.query.type) {
      params.push(req.query.type.toUpperCase());
      where.push(`location_type = $${params.length}`);
    }

    // active filter
    if (req.query.active !== undefined) {
      params.push(req.query.active === 'true' || req.query.active === true);
      where.push(`active = $${params.length}`);
    }

    // search filter: name, code, address, city
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      where.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length} OR address ILIKE $${params.length} OR city ILIKE $${params.length})`);
    }

    const whereClause = where.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM locations WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(pageSize);
    params.push(offset);
    const dataResult = await query(
      `SELECT l.id, l.name, l.address, l.city, l.state, l.zip, l.code,
              l.location_type, l.active, l.timezone, l.contact_name, l.phone,
              l.created_at, l.updated_at,
              (SELECT COUNT(*)::int FROM location_bins lb WHERE lb.location_id = l.id AND lb.active = true) AS bin_count,
              (SELECT COUNT(*)::int FROM user_locations ul WHERE ul.location_id = l.id) AS user_count
       FROM locations l WHERE ${whereClause} ORDER BY l.name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ data: dataResult.rows, meta: { page, pageSize, total } });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch locations', error: err.message });
  }
});

/**
 * @openapi
 * /api/locations/{id}:
 *   get:
 *     summary: Get location by ID (with nested bins, users, supply_rules)
 *     tags:
 *       - Locations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Location detail with nested data
 *       403:
 *         description: Tenant context missing
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.get('/:id', requirePermission('locations.view'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });

    const locResult = await query(
      `SELECT ${DETAIL_COLS} FROM locations WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]
    );
    if (locResult.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const location = locResult.rows[0];

    // Nested: bins at this location
    const binsResult = await query(
      `SELECT id, bin_code, bin_name, bin_type, zone, aisle, shelf, position, capacity_notes, active, created_at, updated_at
       FROM location_bins WHERE location_id = $1 ORDER BY bin_code ASC`,
      [req.params.id]
    );

    // Nested: users assigned to this location via user_locations
    let usersResult = { rows: [] };
    try {
      usersResult = await query(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.role
         FROM users u
         JOIN user_locations ul ON ul.user_id = u.id
         WHERE ul.location_id = $1 AND u.tenant_id = $2
         ORDER BY u.last_name, u.first_name`,
        [req.params.id, tenantId]
      );
    } catch (_) {
      // user_locations table may not exist in all environments
    }

    // Nested: supply rules involving this location (as warehouse or shop)
    let supplyRulesResult = { rows: [] };
    try {
      supplyRulesResult = await query(
        `SELECT
           r.id, r.warehouse_location_id, r.shop_location_id, r.notes, r.active, r.created_at,
           w.name AS warehouse_name, w.location_type AS warehouse_type,
           s.name AS shop_name, s.location_type AS shop_type
         FROM warehouse_shop_supply_rules r
         JOIN locations w ON w.id = r.warehouse_location_id
         JOIN locations s ON s.id = r.shop_location_id
         WHERE (r.warehouse_location_id = $1 OR r.shop_location_id = $1)
           AND r.active = true
         ORDER BY w.name, s.name`,
        [req.params.id]
      );
    } catch (_) {
      // warehouse_shop_supply_rules may not exist yet (pre-migration)
    }

    res.json({
      ...location,
      bins: binsResult.rows,
      users: usersResult.rows,
      supply_rules: supplyRulesResult.rows,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch location', error: err.message });
  }
});

/**
 * @openapi
 * /api/locations:
 *   post:
 *     summary: Create a new location
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
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               address: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               zip: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               contact_name: { type: string }
 *               timezone: { type: string, default: America/New_York }
 *               operating_hours: { type: object }
 *               settings: { type: object }
 *               code: { type: string }
 *               location_type: { type: string, enum: [SHOP, YARD, DROP_YARD, WAREHOUSE, OFFICE, TERMINAL] }
 *               active: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Location created
 *       400:
 *         description: Invalid location_type
 *       403:
 *         description: Tenant context missing
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('locations.manage'), async (req, res) => {
  const {
    name, address, city, state, zip, phone, email, contact_name,
    timezone, operating_hours, settings, code, location_type, active
  } = req.body;

  try {
    const tenantId = await getTenantId(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });

    // Validate location_type if provided
    if (location_type != null && !VALID_TYPES.includes(location_type.toUpperCase())) {
      return res.status(400).json({
        message: `Invalid location_type. Must be one of: ${VALID_TYPES.join(', ')}`,
        valid_types: VALID_TYPES,
      });
    }

    const result = await query(
      `INSERT INTO locations (
         id, tenant_id, name, address, city, state, zip, phone, email,
         contact_name, timezone, operating_hours, settings, code,
         location_type, active, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14,
         $15, $16, NOW(), NOW()
       ) RETURNING ${DETAIL_COLS}`,
      [
        uuidv4(), tenantId, name,
        address || null, city || null, state || null, zip || null,
        phone || null, email || null,
        contact_name || null, timezone || 'America/New_York',
        operating_hours ? JSON.stringify(operating_hours) : null,
        settings ? JSON.stringify(settings) : JSON.stringify({}),
        code || null,
        location_type ? location_type.toUpperCase() : null,
        active !== false,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create location', error: err.message });
  }
});

/**
 * @openapi
 * /api/locations/{id}:
 *   patch:
 *     summary: Partial update a location
 *     tags:
 *       - Locations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               address: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               zip: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               contact_name: { type: string }
 *               timezone: { type: string }
 *               operating_hours: { type: object }
 *               settings: { type: object }
 *               code: { type: string }
 *               location_type: { type: string, enum: [SHOP, YARD, DROP_YARD, WAREHOUSE, OFFICE, TERMINAL] }
 *               active: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated location
 *       400:
 *         description: Invalid location_type
 *       403:
 *         description: Tenant context missing
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
async function handleLocationUpdate(req, res) {
  const {
    name, address, city, state, zip, phone, email, contact_name,
    timezone, operating_hours, settings, code, location_type, active
  } = req.body;

  try {
    const tenantId = await getTenantId(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });

    // Validate location_type if explicitly provided
    if (location_type != null && !VALID_TYPES.includes(location_type.toUpperCase())) {
      return res.status(400).json({
        message: `Invalid location_type. Must be one of: ${VALID_TYPES.join(', ')}`,
        valid_types: VALID_TYPES,
      });
    }

    const result = await query(
      `UPDATE locations SET
         name            = COALESCE($1,  name),
         address         = COALESCE($2,  address),
         city            = COALESCE($3,  city),
         state           = COALESCE($4,  state),
         zip             = COALESCE($5,  zip),
         phone           = COALESCE($6,  phone),
         email           = COALESCE($7,  email),
         contact_name    = COALESCE($8,  contact_name),
         timezone        = COALESCE($9,  timezone),
         operating_hours = COALESCE($10, operating_hours),
         settings        = COALESCE($11, settings),
         code            = COALESCE($12, code),
         location_type   = COALESCE($13, location_type),
         active          = COALESCE($14, active),
         updated_at      = NOW()
       WHERE id = $15 AND tenant_id = $16
       RETURNING ${DETAIL_COLS}`,
      [
        name ?? null, address ?? null, city ?? null, state ?? null, zip ?? null,
        phone ?? null, email ?? null, contact_name ?? null, timezone ?? null,
        operating_hours != null ? JSON.stringify(operating_hours) : null,
        settings != null ? JSON.stringify(settings) : null,
        code ?? null,
        location_type != null ? location_type.toUpperCase() : null,
        active ?? null,
        req.params.id, tenantId,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update location', error: err.message });
  }
}

router.patch('/:id', requirePermission('locations.manage'), handleLocationUpdate);

/**
 * @openapi
 * /api/locations/{id}:
 *   put:
 *     summary: Full update a location (backward-compatible alias for PATCH)
 *     tags:
 *       - Locations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated location
 *       400:
 *         description: Invalid location_type
 *       403:
 *         description: Tenant context missing
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.put('/:id', handleLocationUpdate);

/**
 * @openapi
 * /api/locations/{id}:
 *   delete:
 *     summary: Delete a location (hard if no dependencies, 409 with dep counts if blocked)
 *     tags:
 *       - Locations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Location deleted
 *       403:
 *         description: Tenant context missing
 *       404:
 *         description: Location not found
 *       409:
 *         description: Cannot delete — dependent records exist
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('locations.manage'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });

    // Verify location exists and belongs to tenant
    const locResult = await query(
      `SELECT id FROM locations WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]
    );
    if (locResult.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    // Check hard dependencies that would orphan data
    const depChecks = await Promise.all([
      query(`SELECT COUNT(*) AS cnt FROM work_orders     WHERE location_id = $1`, [req.params.id]).catch(() => ({ rows: [{ cnt: 0 }] })),
      query(`SELECT COUNT(*) AS cnt FROM inventory       WHERE location_id = $1`, [req.params.id]).catch(() => ({ rows: [{ cnt: 0 }] })),
      query(`SELECT COUNT(*) AS cnt FROM user_locations  WHERE location_id = $1`, [req.params.id]).catch(() => ({ rows: [{ cnt: 0 }] })),
      query(`SELECT COUNT(*) AS cnt FROM vehicles        WHERE location_id = $1`, [req.params.id]).catch(() => ({ rows: [{ cnt: 0 }] })),
    ]);

    const deps = {
      work_orders:    parseInt(depChecks[0].rows[0].cnt, 10),
      inventory_items: parseInt(depChecks[1].rows[0].cnt, 10),
      users:          parseInt(depChecks[2].rows[0].cnt, 10),
      vehicles:       parseInt(depChecks[3].rows[0].cnt, 10),
    };

    const hasBlockers = Object.values(deps).some((v) => v > 0);

    if (hasBlockers) {
      return res.status(409).json({
        message: 'Cannot delete location — dependent records exist. Reassign or remove them first.',
        dependencies: deps,
      });
    }

    // No blocking dependencies — safe to hard delete
    // (location_bins and warehouse_shop_supply_rules cascade automatically)
    const deleted = await query(
      `DELETE FROM locations WHERE id = $1 AND tenant_id = $2 RETURNING ${LIST_COLS}`,
      [req.params.id, tenantId]
    );
    res.json(deleted.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete location', error: err.message });
  }
});

module.exports = router;
