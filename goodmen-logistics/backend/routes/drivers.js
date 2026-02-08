const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { transformRows, transformRow, toSnakeCase } = require('../utils/case-converter');
const dtLogger = require('../utils/dynatrace-logger');

// GET all drivers
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query('SELECT * FROM drivers ORDER BY created_at DESC');
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'drivers', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/drivers', 200, duration, { count: result.rows.length });
    
    res.json(transformRows(result.rows));
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch drivers', error, { path: '/api/drivers' });
    dtLogger.trackRequest('GET', '/api/drivers', 500, duration);
    
    console.error('Error fetching drivers:', error);
    res.status(500).json({ message: 'Failed to fetch drivers' });
  }
});

// GET driver by ID
router.get('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query('SELECT * FROM drivers WHERE id = $1', [req.params.id]);
    const duration = Date.now() - startTime;
    
    if (result.rows.length > 0) {
      dtLogger.trackDatabase('SELECT', 'drivers', duration, true, { driverId: req.params.id });
      dtLogger.trackRequest('GET', `/api/drivers/${req.params.id}`, 200, duration);
      res.json(transformRow(result.rows[0]));
    } else {
      dtLogger.warn('Driver not found', { driverId: req.params.id });
      dtLogger.trackRequest('GET', `/api/drivers/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'Driver not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch driver', error, { driverId: req.params.id });
    dtLogger.trackRequest('GET', `/api/drivers/${req.params.id}`, 500, duration);
    
    console.error('Error fetching driver:', error);
    res.status(500).json({ message: 'Failed to fetch driver' });
  }
});

// POST create new driver
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { firstName, lastName, email, phone, cdlNumber, cdlState, cdlClass, endorsements, cdlExpiry, medicalCertExpiry, hireDate, address, dateOfBirth, clearinghouseStatus } = req.body;
    const result = await query(
      `INSERT INTO drivers (first_name, last_name, email, phone, cdl_number, cdl_state, cdl_class, endorsements, cdl_expiry, medical_cert_expiry, hire_date, address, date_of_birth, clearinghouse_status, dqf_completeness, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0, 'active') RETURNING *`,
      [firstName, lastName, email, phone, cdlNumber, cdlState, cdlClass, endorsements || [], cdlExpiry || null, medicalCertExpiry || null, hireDate || null, address, dateOfBirth || null, clearinghouseStatus || 'eligible']
    );
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('INSERT', 'drivers', duration, true, { driverId: result.rows[0].id });
    dtLogger.trackEvent('driver.created', { driverId: result.rows[0].id, name: `${firstName} ${lastName}` });
    dtLogger.trackRequest('POST', '/api/drivers', 201, duration);
    dtLogger.info('Driver created successfully', { driverId: result.rows[0].id, name: `${firstName} ${lastName}` });
    
    res.status(201).json(transformRow(result.rows[0]));
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create driver', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/drivers', 500, duration);
    
    console.error('Error creating driver:', error);
    res.status(500).json({ message: 'Failed to create driver' });
  }
});

// PUT update driver
router.put('/:id', async (req, res) => {
  try {
    const fields = [];
    const values = [];
    let paramCount = 1;
    
    // Skip system fields that shouldn't be updated directly
    const skipFields = ['id', 'createdAt', 'updatedAt', 'created_at', 'updated_at'];
    
    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined && !skipFields.includes(key)) {
        const snakeKey = toSnakeCase(key);
        const value = req.body[key] === '' ? null : req.body[key]; // Convert empty strings to null
        fields.push(`${snakeKey} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    });
    
    if (fields.length === 0) return res.status(400).json({ message: 'No fields to update' });
    values.push(req.params.id);
    const result = await query(`UPDATE drivers SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} RETURNING *`, values);
    if (result.rows.length > 0) {
      res.json(transformRow(result.rows[0]));
    } else {
      res.status(404).json({ message: 'Driver not found' });
    }
  } catch (error) {
    console.error('Error updating driver:', error);
    res.status(500).json({ message: 'Failed to update driver' });
  }
});

// DELETE driver
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM drivers WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length > 0) {
      res.json({ message: 'Driver deleted successfully' });
    } else {
      res.status(404).json({ message: 'Driver not found' });
    }
  } catch (error) {
    console.error('Error deleting driver:', error);
    res.status(500).json({ message: 'Failed to delete driver' });
  }
});

// GET drivers with compliance issues
router.get('/compliance/issues', (req, res) => {
  const issues = drivers.filter(d => {
    const medExpiry = new Date(d.medicalCertExpiry);
    const cdlExpiry = new Date(d.cdlExpiry);
    const now = new Date();
    const thirtyDaysFromNow = new Date(Date.now() + 30*24*60*60*1000);
    
    return medExpiry <= thirtyDaysFromNow || 
           cdlExpiry <= thirtyDaysFromNow || 
           d.dqfCompleteness < 90 ||
           d.clearinghouseStatus !== 'eligible';
  });
  res.json(issues);
});

module.exports = router;
