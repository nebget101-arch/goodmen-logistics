const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../internal/db');
const knex = require('../internal/db').knex;
const baseAuth = require('../middleware/auth-middleware');
const authWithRole = require('./auth-middleware');
const { loadUserRbac, requirePermission, requireAnyPermission } = require('../middleware/rbac-middleware');

const router = express.Router();
const rbac = [baseAuth, loadUserRbac];

function normalizeUsername(value) {
  return (value || '').toString().trim().toLowerCase().replace(/\s+/g, '.');
}

async function generateUniqueUsername(base, dbClient) {
  const normalized = normalizeUsername(base);
  if (!normalized) return '';

  const existing = await dbClient.query('SELECT username FROM users WHERE username = $1', [normalized]);
  if (existing.rows.length === 0) return normalized;

  let suffix = 1;
  while (suffix < 1000) {
    const candidate = `${normalized}.${suffix}`;
    const found = await dbClient.query('SELECT username FROM users WHERE username = $1', [candidate]);
    if (found.rows.length === 0) return candidate;
    suffix += 1;
  }
  return `${normalized}.${Date.now()}`;
}

// Get current user (from JWT payload, no DB dependency)
router.get('/me', baseAuth, (req, res) => {
  const payload = req.user || {};
  if (!payload || (!payload.id && !payload.sub)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const data = {
    id: payload.id || payload.sub || null,
    username: payload.username || '',
    first_name: payload.first_name || null,
    last_name: payload.last_name || null,
    email: payload.email || null,
    role: payload.role || null
  };
  res.json({ success: true, data });
});

// Get all technicians (for dropdown selection)
router.get('/technicians', async (req, res) => {
  try {
    const technicians = await db.query(
      'SELECT id, username, first_name, last_name, email FROM users WHERE role IN ($1, $2) ORDER BY username',
      ['safety', 'fleet']
    );
    res.json({ success: true, data: technicians.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch technicians.' });
  }
});

// ---- RBAC: user access (must be before /:id) ----
router.get('/:id/access', rbac, requireAnyPermission(['users.manage', 'roles.manage']), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const user = await knex('users').where('id', req.params.id).first('id');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const [roles, locationRows] = await Promise.all([
      knex('user_roles as ur').join('roles as r', 'ur.role_id', 'r.id').where('ur.user_id', req.params.id).select('r.id', 'r.code', 'r.name'),
      knex('user_locations as ul').join('locations as l', 'ul.location_id', 'l.id').where('ul.user_id', req.params.id).select('l.id', 'l.code', 'l.name')
    ]);
    res.json({ success: true, data: { userId: req.params.id, roles, locations: locationRows } });
  } catch (err) {
    console.error('[users] access failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id/roles', rbac, requirePermission('users.manage'), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const user = await knex('users').where('id', req.params.id).first('id');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds : [];
    await knex('user_roles').where('user_id', req.params.id).del();
    if (roleIds.length) {
      await knex('user_roles').insert(roleIds.map((rid) => ({ user_id: req.params.id, role_id: rid })));
    }
    const roles = await knex('user_roles as ur').join('roles as r', 'ur.role_id', 'r.id').where('ur.user_id', req.params.id).select('r.id', 'r.code', 'r.name');
    res.json({ success: true, data: roles });
  } catch (err) {
    console.error('[users] put roles failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id/locations', rbac, requirePermission('users.manage'), async (req, res) => {
  try {
    if (!knex) return res.status(503).json({ success: false, error: 'Database not available' });
    const user = await knex('users').where('id', req.params.id).first('id');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const locationIds = Array.isArray(req.body.locationIds) ? req.body.locationIds : [];
    await knex('user_locations').where('user_id', req.params.id).del();
    if (locationIds.length) {
      await knex('user_locations').insert(locationIds.map((lid) => ({ user_id: req.params.id, location_id: lid })));
    }
    const locations = await knex('user_locations as ul').join('locations as l', 'ul.location_id', 'l.id').where('ul.user_id', req.params.id).select('l.id', 'l.code', 'l.name');
    res.json({ success: true, data: locations });
  } catch (err) {
    console.error('[users] put locations failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.query(
      'SELECT id, username, first_name, last_name, email, role FROM users WHERE id = $1',
      [id]
    );
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ success: true, data: user.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

// Only admin can create users (legacy role check; RBAC users.manage can be added later)
router.post('/', authWithRole(['admin']), async (req, res) => {
  const { username, password, role, firstName, lastName, email } = req.body;
  if (!password || !role) {
    return res.status(400).json({ error: 'Password and role are required.' });
  }
  if (!['admin', 'safety', 'fleet', 'dispatch'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  try {
    let resolvedUsername = normalizeUsername(username);
    if (!resolvedUsername) {
      const base = `${(firstName || '').trim()}.${(lastName || '').trim()}`;
      resolvedUsername = await generateUniqueUsername(base, db);
    }
    if (!resolvedUsername) {
      return res.status(400).json({ error: 'Username or first/last name is required.' });
    }

    const existing = await db.query('SELECT id FROM users WHERE username = $1', [resolvedUsername]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await db.query(
      'INSERT INTO users (id, username, password_hash, role, first_name, last_name, email, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
      [id, resolvedUsername, password_hash, role, firstName || null, lastName || null, email || null]
    );
    res.status(201).json({ message: 'User created successfully.', username: resolvedUsername });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

module.exports = router;
