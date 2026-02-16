const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const auth = require('./auth-middleware');

// Protect all locations routes: admin, fleet
router.use(auth(['admin', 'fleet']));

// GET all locations
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM locations ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch locations', error: err.message });
  }
});

// GET location by ID
router.get('/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch location', error: err.message });
  }
});

// POST create new location
router.post('/', async (req, res) => {
  const { name, address, settings } = req.body;
  try {
    const result = await query(
      'INSERT INTO locations (id, name, address, settings, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *',
      [uuidv4(), name, address, settings || {}]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create location', error: err.message });
  }
});

// PUT update location
router.put('/:id', async (req, res) => {
  const { name, address, settings } = req.body;
  try {
    const result = await query(
      'UPDATE locations SET name = $1, address = $2, settings = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [name, address, settings || {}, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update location', error: err.message });
  }
});

// DELETE location
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM locations WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Location not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete location', error: err.message });
  }
});

module.exports = router;
