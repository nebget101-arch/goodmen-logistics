'use strict';

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { loadUserRbac, requireAnyPermission } = require('../middleware/rbac-middleware');
const db = require('../internal/db').knex;

const rbac = [authMiddleware, loadUserRbac];

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
