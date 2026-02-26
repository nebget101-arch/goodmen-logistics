const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const authMiddleware = require('./auth-middleware');

const router = express.Router();

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

// Only admin can create users
router.post('/', authMiddleware(['admin']), async (req, res) => {
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
