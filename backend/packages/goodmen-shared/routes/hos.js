const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const auth = require('./auth-middleware');

// Protect all hos routes: admin, safety
router.use(auth(['admin', 'safety']));

// GET all HOS records
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const params = [];
    let whereClause = '';
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      whereClause = `WHERE d.operating_entity_id = $${params.length}`;
    }
    
    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      ${whereClause}
      ORDER BY hr.record_date DESC
    `, params);
    
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
    if (req.context?.operatingEntityId) {
      const driverRes = await query('SELECT operating_entity_id FROM drivers WHERE id = $1', [req.params.driverId]);
      if (driverRes.rows.length === 0 || driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
        return res.status(404).json({ message: 'Driver not found' });
      }
    }

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
    const params = [req.params.date];
    let whereClause = 'WHERE DATE(hr.record_date) = $1';
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      whereClause += ` AND d.operating_entity_id = $${params.length}`;
    }
    
    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      ${whereClause}
      ORDER BY hr.record_date DESC
    `, params);
    
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
    const params = [];
    let whereClause = 'WHERE hr.violations IS NOT NULL AND hr.violations != \'[]\'';
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      whereClause += ` AND d.operating_entity_id = $${params.length}`;
    }
    
    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      ${whereClause}
      ORDER BY hr.record_date DESC
    `, params);
    
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/hos/violations', 200, duration);
    
    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch HOS violations', error, { path: '/api/hos/violations' });
    console.error('Error fetching HOS violations:', error);
    // Graceful degradation for partial dev schemas.
    dtLogger.trackRequest('GET', '/api/hos/violations', 200, duration, { degraded: true });
    res.json([]);
  }
});

// POST create new HOS record
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { driverId, recordDate, onDutyHours, drivingHours, violations } = req.body;
        // Validate driver belongs to active OE
        if (req.context?.operatingEntityId) {
          const driverRes = await query('SELECT operating_entity_id FROM drivers WHERE id = $1', [driverId]);
          if (driverRes.rows.length === 0) {
            return res.status(404).json({ message: 'Driver not found' });
          }
          if (driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
            return res.status(404).json({ message: 'Driver not found' });
          }
        }
    
    
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
