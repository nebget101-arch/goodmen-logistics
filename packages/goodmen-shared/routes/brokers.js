const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const auth = require('./auth-middleware');

router.use(auth(['admin', 'dispatch']));

/** GET /api/brokers - list brokers, optional ?q= search by name */
router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    let sql = 'SELECT id, name, mc_number, dot_number, phone, email, city, state FROM brokers ORDER BY name';
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      sql = 'SELECT id, name, mc_number, dot_number, phone, email, city, state FROM brokers WHERE name ILIKE $1 ORDER BY name';
    }
    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Error fetching brokers:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch brokers' });
  }
});

module.exports = router;
