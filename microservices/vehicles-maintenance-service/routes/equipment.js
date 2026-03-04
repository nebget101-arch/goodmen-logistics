const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

// GET all equipment
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM equipment ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ message: 'Failed to fetch equipment' });
  }
});

// GET equipment by ID
router.get('/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM equipment WHERE id = $1', [req.params.id]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: 'Equipment not found' });
    }
  } catch (error) {
    console.error('Error fetching equipment:', error);
    res.status(500).json({ message: 'Failed to fetch equipment' });
  }
});

// POST create new equipment
router.post('/', async (req, res) => {
  try {
    const { name, description, status } = req.body;
    const result = await query(
      'INSERT INTO equipment (name, description, status) VALUES ($1, $2, $3) RETURNING *',
      [name, description, status || 'active']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating equipment:', error);
    res.status(500).json({ message: 'Failed to create equipment' });
  }
});

// PUT update equipment
router.put('/:id', async (req, res) => {
  try {
    const { name, description, status } = req.body;
    const result = await query(
      'UPDATE equipment SET name = $1, description = $2, status = $3 WHERE id = $4 RETURNING *',
      [name, description, status, req.params.id]
    );
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: 'Equipment not found' });
    }
  } catch (error) {
    console.error('Error updating equipment:', error);
    res.status(500).json({ message: 'Failed to update equipment' });
  }
});

// DELETE equipment
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM equipment WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length > 0) {
      res.json({ message: 'Equipment deleted successfully' });
    } else {
      res.status(404).json({ message: 'Equipment not found' });
    }
  } catch (error) {
    console.error('Error deleting equipment:', error);
    res.status(500).json({ message: 'Failed to delete equipment' });
  }
});

module.exports = router;
