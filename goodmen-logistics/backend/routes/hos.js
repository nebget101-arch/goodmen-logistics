const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');

// GET all HOS records
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      ORDER BY hr.record_date DESC
    `);
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

// GET HOS records by driver ID
router.get('/driver/:driverId', (req, res) => {
  const records = hosRecords.filter(h => h.driverId === req.params.driverId);
  res.json(records);
});

// GET HOS records by date
router.get('/date/:date', (req, res) => {
  const records = hosRecords.filter(h => h.date === req.params.date);
  res.json(records);
});

// GET HOS violations
router.get('/violations', (req, res) => {
  const violations = hosRecords.filter(h => h.violations.length > 0);
  res.json(violations);
});

// POST create new HOS record
router.post('/', (req, res) => {
  const newRecord = {
    id: require('uuid').v4(),
    ...req.body
  };
  hosRecords.push(newRecord);
  res.status(201).json(newRecord);
});

module.exports = router;
