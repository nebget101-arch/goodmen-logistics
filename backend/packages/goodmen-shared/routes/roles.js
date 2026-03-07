'use strict';

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { loadUserRbac, requirePermission, requireAnyPermission } = require('../middleware/rbac-middleware');
const db = require('../internal/db').knex;

const rbac = [authMiddleware, loadUserRbac];

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
