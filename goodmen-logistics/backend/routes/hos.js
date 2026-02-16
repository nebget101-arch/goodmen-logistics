const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');
const auth = require('./auth-middleware');

// Protect all hos routes: admin, safety
router.use(auth(['admin', 'safety']));

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
router.get('/driver/:driverId', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      WHERE hr.driver_id = $1
      ORDER BY hr.record_date DESC
    `, [req.params.driverId]);
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { driverId: req.params.driverId, count: result.rows.length });
    dtLogger.trackRequest('GET', `/api/hos/driver/${req.params.driverId}`, 200, duration);
    
    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch driver HOS records', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('GET', `/api/hos/driver/${req.params.driverId}`, 500, duration);
    
    console.error('Error fetching driver HOS records:', error);
    res.status(500).json({ message: 'Failed to fetch HOS records for driver' });
  }
});

// GET HOS records by date
router.get('/date/:date', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      WHERE DATE(hr.record_date) = $1
      ORDER BY hr.record_date DESC
    `, [req.params.date]);
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { date: req.params.date, count: result.rows.length });
    dtLogger.trackRequest('GET', `/api/hos/date/${req.params.date}`, 200, duration);
    
    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch HOS records by date', error, { date: req.params.date });
    dtLogger.trackRequest('GET', `/api/hos/date/${req.params.date}`, 500, duration);
    
    console.error('Error fetching HOS records by date:', error);
    res.status(500).json({ message: 'Failed to fetch HOS records for date' });
  }
});

// GET HOS violations
router.get('/violations', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      WHERE hr.violations IS NOT NULL AND hr.violations != '[]'
      ORDER BY hr.record_date DESC
    `);
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/hos/violations', 200, duration);
    
    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch HOS violations', error, { path: '/api/hos/violations' });
    dtLogger.trackRequest('GET', '/api/hos/violations', 500, duration);
    
    console.error('Error fetching HOS violations:', error);
    res.status(500).json({ message: 'Failed to fetch HOS violations' });
  }
});

// POST create new HOS record
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { driverId, recordDate, onDutyHours, drivingHours, violations } = req.body;
    
    const result = await query(`
      INSERT INTO hos_records (driver_id, record_date, on_duty_hours, driving_hours, violations)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [driverId, recordDate, onDutyHours || 0, drivingHours || 0, JSON.stringify(violations || [])]);
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('INSERT', 'hos_records', duration, true, { recordId: result.rows[0].id });
    dtLogger.trackEvent('hos.created', { recordId: result.rows[0].id, driverId });
    dtLogger.trackRequest('POST', '/api/hos', 201, duration);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create HOS record', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/hos', 500, duration);
    
    console.error('Error creating HOS record:', error);
    res.status(500).json({ message: 'Failed to create HOS record' });
  }
});

module.exports = router;
