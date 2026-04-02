'use strict';

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { loadUserRbac, requireAnyPermission } = require('../middleware/rbac-middleware');
const db = require('../internal/db').knex;

const rbac = [authMiddleware, loadUserRbac];

/**
 * @openapi
 * /api/permissions:
 *   get:
 *     summary: List all permissions
 *     description: Returns all RBAC permissions ordered by module and action. Requires permissions.view, roles.view, or roles.manage permission.
 *     tags:
 *       - Permissions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of permissions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       module: { type: string }
 *                       action: { type: string }
 *                       code: { type: string }
 *                       description: { type: string, nullable: true }
 *       503:
 *         description: Database not available
 */
router.get('/', rbac, requireAnyPermission(['permissions.view', 'roles.view', 'roles.manage']), async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const rows = await db('permissions').orderBy('module').orderBy('action').select('id', 'module', 'action', 'code', 'description');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[permissions] list failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
