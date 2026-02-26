const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const userDb = require('../database/user');
const bcrypt = require('bcrypt');

// Secret for JWT (in production, use env var)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    const user = await userDb.getUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '8h' });
    res.json({
      token,
      role: user.role,
      username: user.username,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
      email: user.email || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
