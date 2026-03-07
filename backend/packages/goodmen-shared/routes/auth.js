const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const userDb = require('../internal/user');
const bcrypt = require('bcrypt');

// Secret for JWT (in production, use env var)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Authenticate user
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 example: demo
 *               password:
 *                 type: string
 *                 example: password123
 *             required:
 *               - username
 *               - password
 *     responses:
 *       200:
 *         description: User authenticated, JWT returned
 *       400:
 *         description: Missing credentials
 *       401:
 *         description: Invalid credentials
 */
// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    const user = await userDb.getUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id: user.id, role: user.role, username: user.username, driver_id: user.driver_id || null },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({
      token,
      role: user.role,
      username: user.username,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
      email: user.email || null
    });
  } catch (err) {
    console.error('[auth/login]', err?.message || err);
    const payload = { error: 'Server error' };
    if (process.env.NODE_ENV !== 'production' && err?.message) {
      payload.detail = err.message;
    }
    res.status(500).json(payload);
  }
});

module.exports = router;
