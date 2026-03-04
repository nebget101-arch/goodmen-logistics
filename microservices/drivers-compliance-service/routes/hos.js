const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');
const auth = require('./auth-middleware');

// Protect all HOS routes: admin, safety
router.use(auth(['admin', 'safety']));

// GET all HOS records
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(
      `SELECT h.*, d.first_name, d.last_name
       FROM hos_records h
       JOIN drivers d ON h.driver_id = d.id
       ORDER BY h.created_at DESC`
    );

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/hos', 200, duration, { count: result.rows.length });

    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch HOS records', error, { path: '/api/hos' });
    dtLogger.trackRequest('GET', '/api/hos', 500, duration);

    console.error('Error fetching HOS records:', error);
    res.status(500).json({ message: 'Failed to fetch HOS records' });
  }
});

// GET HOS record by ID
router.get('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(
      `SELECT h.*, d.first_name, d.last_name
       FROM hos_records h
       JOIN drivers d ON h.driver_id = d.id
       WHERE h.id = $1`,
      [req.params.id]
    );

    const duration = Date.now() - startTime;

    if (result.rows.length > 0) {
      dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { hosId: req.params.id });
      dtLogger.trackRequest('GET', `/api/hos/${req.params.id}`, 200, duration);
      res.json(result.rows[0]);
    } else {
      dtLogger.warn('HOS record not found', { hosId: req.params.id });
      dtLogger.trackRequest('GET', `/api/hos/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'HOS record not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch HOS record', error, { hosId: req.params.id });
    dtLogger.trackRequest('GET', `/api/hos/${req.params.id}`, 500, duration);

    console.error('Error fetching HOS record:', error);
    res.status(500).json({ message: 'Failed to fetch HOS record' });
  }
});

// POST create new HOS record
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { driverId, status, violations, notes } = req.body;

    const result = await query(
      `INSERT INTO hos_records (driver_id, status, violations, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [driverId, status, violations, notes]
    );

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('INSERT', 'hos_records', duration, true, { hosId: result.rows[0].id });
    dtLogger.trackRequest('POST', '/api/hos', 201, duration);
    dtLogger.trackEvent('hos.created', { hosId: result.rows[0].id, driverId });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create HOS record', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/hos', 500, duration);

    console.error('Error creating HOS record:', error);
    res.status(500).json({ message: 'Failed to create HOS record' });
  }
});

// PUT update HOS record
router.put('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const { status, violations, notes } = req.body;

    const result = await query(
      `UPDATE hos_records 
       SET status = $1, violations = $2, notes = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [status, violations, notes, req.params.id]
    );

    const duration = Date.now() - startTime;

    if (result.rows.length > 0) {
      dtLogger.trackDatabase('UPDATE', 'hos_records', duration, true, { hosId: req.params.id });
      dtLogger.trackRequest('PUT', `/api/hos/${req.params.id}`, 200, duration);
      res.json(result.rows[0]);
    } else {
      dtLogger.warn('HOS record not found', { hosId: req.params.id });
      dtLogger.trackRequest('PUT', `/api/hos/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'HOS record not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to update HOS record', error, { hosId: req.params.id });
    dtLogger.trackRequest('PUT', `/api/hos/${req.params.id}`, 500, duration);

    console.error('Error updating HOS record:', error);
    res.status(500).json({ message: 'Failed to update HOS record' });
  }
});

// DELETE HOS record
router.delete('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(
      'DELETE FROM hos_records WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    const duration = Date.now() - startTime;

    if (result.rows.length > 0) {
      dtLogger.trackDatabase('DELETE', 'hos_records', duration, true, { hosId: req.params.id });
      dtLogger.trackRequest('DELETE', `/api/hos/${req.params.id}`, 200, duration);
      res.json({ message: 'HOS record deleted successfully' });
    } else {
      dtLogger.warn('HOS record not found', { hosId: req.params.id });
      dtLogger.trackRequest('DELETE', `/api/hos/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'HOS record not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to delete HOS record', error, { hosId: req.params.id });
    dtLogger.trackRequest('DELETE', `/api/hos/${req.params.id}`, 500, duration);

    console.error('Error deleting HOS record:', error);
    res.status(500).json({ message: 'Failed to delete HOS record' });
  }
});

module.exports = router;
