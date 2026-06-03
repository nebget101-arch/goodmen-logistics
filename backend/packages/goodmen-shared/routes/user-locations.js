/**
 * FN-694 — User-Location Assignment routes
 *
 * Endpoints:
 *   GET    /locations/:locationId/users            — users assigned to a location
 *   POST   /locations/:locationId/users            — bulk idempotent assign
 *   DELETE /locations/:locationId/users/:userId    — unassign one user
 *   GET    /users/:userId/locations                — locations for a user (reverse lookup)
 *
 * Mounted at /api in logistics-service so final paths are:
 *   GET  /api/locations/:locationId/users
 *   POST /api/locations/:locationId/users          body: { user_ids: [...] }
 *   DEL  /api/locations/:locationId/users/:userId
 *   GET  /api/users/:userId/locations
 */

const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const auth = require('./auth-middleware');

router.use(auth(['admin', 'fleet']));

async function getTenantId(req) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) return null;
  const result = await query('SELECT tenant_id FROM users WHERE id = $1', [userId]);
  return result.rows?.[0]?.tenant_id || null;
}

// ─── Location → Users ────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/locations/{locationId}/users:
 *   get:
 *     summary: List users assigned to a location
 *     tags: [Locations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Array of assigned users with id, first_name, last_name, email, role, assigned_at
 *       403:
 *         description: Tenant context missing
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.get('/locations/:locationId/users', async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });

    // Verify location belongs to tenant
    const locCheck = await query(
      `SELECT id FROM locations WHERE id = $1 AND tenant_id = $2`,
      [req.params.locationId, tenantId]
    );
    if (locCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const result = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role, ul.created_at AS assigned_at
       FROM user_locations ul
       JOIN users u ON u.id = ul.user_id
       WHERE ul.location_id = $1
         AND u.tenant_id = $2
       ORDER BY u.last_name, u.first_name`,
      [req.params.locationId, tenantId]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users for location', error: err.message });
  }
});

/**
 * @openapi
 * /api/locations/{locationId}/users:
 *   post:
 *     summary: Assign users to a location (idempotent bulk)
 *     tags: [Locations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_ids]
 *             properties:
 *               user_ids:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Assignment result with counts
 *       400:
 *         description: user_ids must be a non-empty array
 *       403:
 *         description: Tenant context missing
 *       404:
 *         description: Location not found
 *       500:
 *         description: Server error
 */
router.post('/locations/:locationId/users', async (req, res) => {
  const { user_ids } = req.body;

  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return res.status(400).json({ message: 'user_ids must be a non-empty array' });
  }

  try {
    const tenantId = await getTenantId(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });

    // Verify location belongs to tenant
    const locCheck = await query(
      `SELECT id FROM locations WHERE id = $1 AND tenant_id = $2`,
      [req.params.locationId, tenantId]
    );
    if (locCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    // Verify all users belong to same tenant
    const userCheck = await query(
      `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [user_ids, tenantId]
    );
    const validUserIds = userCheck.rows.map((r) => r.id);
    const invalidCount = user_ids.length - validUserIds.length;

    if (validUserIds.length === 0) {
      return res.status(400).json({ message: 'No valid users found in this tenant' });
    }

    // Idempotent INSERT: skip duplicates via ON CONFLICT DO NOTHING
    let assigned = 0;
    for (const userId of validUserIds) {
      const result = await query(
        `INSERT INTO user_locations (id, user_id, location_id, created_at)
         VALUES (gen_random_uuid(), $1, $2, NOW())
         ON CONFLICT (user_id, location_id) DO NOTHING`,
        [userId, req.params.locationId]
      );
      assigned += result.rowCount || 0;
    }

    res.json({
      assigned,
      already_assigned: validUserIds.length - assigned,
      invalid_user_ids: invalidCount,
      total_requested: user_ids.length,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to assign users to location', error: err.message });
  }
});

/**
 * @openapi
 * /api/locations/{locationId}/users/{userId}:
 *   delete:
 *     summary: Unassign a user from a location
 *     tags: [Locations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: User unassigned
 *       403:
 *         description: Tenant context missing
 *       404:
 *         description: Assignment not found
 *       500:
 *         description: Server error
 */
router.delete('/locations/:locationId/users/:userId', async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });

    // Verify location belongs to tenant before deleting
    const locCheck = await query(
      `SELECT id FROM locations WHERE id = $1 AND tenant_id = $2`,
      [req.params.locationId, tenantId]
    );
    if (locCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const result = await query(
      `DELETE FROM user_locations WHERE location_id = $1 AND user_id = $2`,
      [req.params.locationId, req.params.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    res.json({ message: 'User unassigned from location', location_id: req.params.locationId, user_id: req.params.userId });
  } catch (err) {
    res.status(500).json({ message: 'Failed to unassign user from location', error: err.message });
  }
});

// ─── User → Locations (reverse lookup) ───────────────────────────────────────

/**
 * @openapi
 * /api/users/{userId}/locations:
 *   get:
 *     summary: List locations assigned to a user
 *     tags: [Locations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Array of locations this user is assigned to
 *       403:
 *         description: Tenant context missing
 *       404:
 *         description: User not found or not in tenant
 *       500:
 *         description: Server error
 */
router.get('/users/:userId/locations', async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    if (!tenantId) return res.status(403).json({ message: 'Tenant context missing' });

    // Verify the requested user belongs to same tenant
    const userCheck = await query(
      `SELECT id FROM users WHERE id = $1 AND tenant_id = $2`,
      [req.params.userId, tenantId]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await query(
      `SELECT l.id, l.name, l.address, l.city, l.state, l.code, l.location_type, l.active,
              l.timezone, ul.created_at AS assigned_at
       FROM user_locations ul
       JOIN locations l ON l.id = ul.location_id
       WHERE ul.user_id = $1
         AND l.tenant_id = $2
       ORDER BY l.name ASC`,
      [req.params.userId, tenantId]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch locations for user', error: err.message });
  }
});

module.exports = router;
