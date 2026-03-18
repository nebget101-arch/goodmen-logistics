const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');

// GET all drug/alcohol records (restricted access in production)
router.get('/', async (req, res) => {
  try {
    const startTime = Date.now();
    const params = [];
    const where = [];

    if (req.context?.tenantId) {
      params.push(req.context.tenantId);
      where.push(`d.tenant_id = $${params.length}`);
    }
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      where.push(`d.operating_entity_id = $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await query(`
      SELECT dat.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM drug_alcohol_tests dat
      JOIN drivers d ON dat.driver_id = d.id
      ${whereClause}
      ORDER BY dat.test_date DESC
    `, params);

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('SELECT', 'drug_alcohol_tests', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/drug-alcohol', 200, duration, { count: result.rows.length });

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching drug/alcohol tests:', error);
    res.status(500).json({ message: 'Failed to fetch drug/alcohol tests' });
  }
});

// GET records by driver ID
router.get('/driver/:driverId', async (req, res) => {
  const startTime = Date.now();
  try {
    const driverRes = await query(
      `SELECT id, tenant_id, operating_entity_id
         FROM drivers
        WHERE id = $1`,
      [req.params.driverId]
    );

    if (driverRes.rows.length === 0 || (req.context?.tenantId && driverRes.rows[0].tenant_id !== req.context.tenantId)) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    if (req.context?.operatingEntityId && driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const result = await query(
      `SELECT dat.*, d.first_name || ' ' || d.last_name as "driverName"
       FROM drug_alcohol_tests dat
       JOIN drivers d ON dat.driver_id = d.id
       WHERE dat.driver_id = $1
       ORDER BY dat.test_date DESC`,
      [req.params.driverId]
    );

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('SELECT', 'drug_alcohol_tests', duration, true, { driverId: req.params.driverId, count: result.rows.length });
    dtLogger.trackRequest('GET', `/api/drug-alcohol/driver/${req.params.driverId}`, 200, duration);

    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching drug/alcohol tests for driver:', error);
    return res.status(500).json({ message: 'Failed to fetch drug/alcohol tests' });
  }
});

// POST create new test record
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { driverId, testDate, result: testResult } = req.body;

    if (!driverId || !testDate || !testResult) {
      return res.status(400).json({ message: 'driverId, testDate, and result are required' });
    }

    const driverRes = await query(
      `SELECT id, tenant_id, operating_entity_id
         FROM drivers
        WHERE id = $1`,
      [driverId]
    );

    if (driverRes.rows.length === 0 || (req.context?.tenantId && driverRes.rows[0].tenant_id !== req.context.tenantId)) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    if (req.context?.operatingEntityId && driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const result = await query(
      `INSERT INTO drug_alcohol_tests (driver_id, test_date, result, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [driverId, testDate, testResult]
    );

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('INSERT', 'drug_alcohol_tests', duration, true, { testId: result.rows[0].id });
    dtLogger.trackRequest('POST', '/api/drug-alcohol', 201, duration);

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating drug/alcohol test:', error);
    return res.status(500).json({ message: 'Failed to create drug/alcohol test' });
  }
});

// GET summary (anonymized for dispatchers)
router.get('/summary', async (req, res) => {
  try {
    const startTime = Date.now();
    const params = [];
    const where = [];

    if (req.context?.tenantId) {
      params.push(req.context.tenantId);
      where.push(`d.tenant_id = $${params.length}`);
    }
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      where.push(`d.operating_entity_id = $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await query(
      `SELECT d.id as "driverId",
              d.first_name || ' ' || d.last_name as "driverName",
              MAX(dat.test_date) as "lastTestDate",
              CASE WHEN UPPER(COALESCE(MAX(dat.result), '')) = 'NEGATIVE' THEN 'Eligible' ELSE 'Review Required' END as status
       FROM drivers d
       LEFT JOIN drug_alcohol_tests dat ON dat.driver_id = d.id
       ${whereClause}
       GROUP BY d.id, d.first_name, d.last_name
       ORDER BY d.last_name, d.first_name`,
      params
    );

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('SELECT', 'drug_alcohol_tests', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/drug-alcohol/summary', 200, duration);

    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching drug/alcohol summary:', error);
    return res.status(500).json({ message: 'Failed to fetch drug/alcohol summary' });
  }
});

module.exports = router;
