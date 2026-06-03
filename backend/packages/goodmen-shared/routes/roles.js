'use strict';

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { loadUserRbac, requirePermission, requireAnyPermission } = require('../middleware/rbac-middleware');
const db = require('../internal/db').knex;

const rbac = [authMiddleware, loadUserRbac];

/**
 * @openapi
 * /api/roles:
 *   get:
 *     summary: List all roles
 *     description: Returns all RBAC roles ordered by code. Requires roles.view or roles.manage permission.
 *     tags:
 *       - Roles
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of roles
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
 *                       code: { type: string }
 *                       name: { type: string }
 *                       description: { type: string, nullable: true }
 *                       created_at: { type: string, format: date-time }
 *                       updated_at: { type: string, format: date-time }
 *       503:
 *         description: Database not available
 */
router.get('/', rbac, requireAnyPermission(['roles.view', 'roles.manage']), async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const rows = await db('roles').orderBy('code').select('id', 'code', 'name', 'description', 'created_at', 'updated_at');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[roles] list failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @openapi
 * /api/roles/{id}:
 *   get:
 *     summary: Get a role by ID
 *     description: Returns a single role record. Requires roles.view or roles.manage permission.
 *     tags:
 *       - Roles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Role record
 *       404:
 *         description: Role not found
 */
router.get('/:id', rbac, requireAnyPermission(['roles.view', 'roles.manage']), async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const row = await db('roles').where('id', req.params.id).first();
    if (!row) return res.status(404).json({ success: false, error: 'Role not found' });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[roles] get failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @openapi
 * /api/roles/{id}/permissions:
 *   get:
 *     summary: Get permissions assigned to a role
 *     description: Returns all permissions linked to the specified role via the role_permissions join table.
 *     tags:
 *       - Roles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
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
 *                       code: { type: string }
 *                       module: { type: string }
 *                       action: { type: string }
 *                       description: { type: string, nullable: true }
 *       404:
 *         description: Role not found
 */
router.get('/:id/permissions', rbac, requireAnyPermission(['roles.view', 'roles.manage']), async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const role = await db('roles').where('id', req.params.id).first();
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    const perms = await db('role_permissions as rp')
      .join('permissions as p', 'rp.permission_id', 'p.id')
      .where('rp.role_id', req.params.id)
      .select('p.id', 'p.code', 'p.module', 'p.action', 'p.description');
    res.json({ success: true, data: perms });
  } catch (err) {
    console.error('[roles] permissions failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @openapi
 * /api/roles:
 *   post:
 *     summary: Create a new role
 *     description: Creates a new RBAC role. Requires roles.manage permission.
 *     tags:
 *       - Roles
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code: { type: string }
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Role created
 *       400:
 *         description: code and name required
 *       409:
 *         description: Role code already exists
 */
router.post('/', rbac, requirePermission('roles.manage'), async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const { code, name, description } = req.body || {};
    if (!code || !name) return res.status(400).json({ success: false, error: 'code and name required' });
    const [row] = await db('roles').insert({ code: code.trim(), name: name.trim(), description: description || null }).returning('*');
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'Role code already exists' });
    console.error('[roles] create failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @openapi
 * /api/roles/{id}:
 *   put:
 *     summary: Update a role
 *     description: Updates name and/or description of an existing role. Requires roles.manage permission.
 *     tags:
 *       - Roles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Role updated
 *       404:
 *         description: Role not found
 */
router.put('/:id', rbac, requirePermission('roles.manage'), async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const { name, description } = req.body || {};
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description || null;
    updates.updated_at = db.fn.now();
    const [row] = await db('roles').where('id', req.params.id).update(updates).returning('*');
    if (!row) return res.status(404).json({ success: false, error: 'Role not found' });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[roles] update failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @openapi
 * /api/roles/{id}/permissions:
 *   put:
 *     summary: Replace permissions for a role
 *     description: Replaces all permission assignments for the specified role. Accepts permissionIds or permissionCodes (codes are resolved to IDs). Requires roles.manage permission.
 *     tags:
 *       - Roles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               permissionIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 description: Array of permission IDs (takes precedence)
 *               permissionCodes:
 *                 type: array
 *                 items: { type: string }
 *                 description: Fallback — resolved to IDs if permissionIds is empty
 *     responses:
 *       200:
 *         description: Updated permission list for the role
 *       404:
 *         description: Role not found
 */
router.put('/:id/permissions', rbac, requirePermission('roles.manage'), async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const role = await db('roles').where('id', req.params.id).first();
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    let permissionIds = Array.isArray(req.body.permissionIds) ? req.body.permissionIds : [];
    if (permissionIds.length === 0 && Array.isArray(req.body.permissionCodes) && req.body.permissionCodes.length) {
      const rows = await db('permissions').whereIn('code', req.body.permissionCodes).select('id');
      permissionIds = rows.map((p) => p.id);
    }
    await db('role_permissions').where('role_id', req.params.id).del();
    if (permissionIds.length) {
      await db('role_permissions').insert(permissionIds.map((pid) => ({ role_id: req.params.id, permission_id: pid })));
    }
    const perms = await db('role_permissions as rp').join('permissions as p', 'rp.permission_id', 'p.id').where('rp.role_id', req.params.id).select('p.id', 'p.code');
    res.json({ success: true, data: perms });
  } catch (err) {
    console.error('[roles] set permissions failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
