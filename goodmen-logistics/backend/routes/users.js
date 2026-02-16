const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const authMiddleware = require('./auth-middleware');

const router = express.Router();

// Only admin can create users
router.post('/', authMiddleware(['admin']), async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required.' });
  }
  if (!['admin', 'safety', 'fleet', 'dispatch'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  try {
    const existing = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await db.query(
      'INSERT INTO users (id, username, password_hash, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [id, username, password_hash, role]
    );
    res.status(201).json({ message: 'User created successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

module.exports = router;
