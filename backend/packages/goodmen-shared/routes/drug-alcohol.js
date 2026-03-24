const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const {
  upsertRequirementStatus,
  computeAndUpdateDqfCompleteness,
  logStatusChange
} = require('../services/dqf-service');
const { isDriverClearedToDrive } = require('../services/driver-clearance-service');

// Valid test_type values (FMCSA Part 382)
const VALID_TEST_TYPES = [
  'pre_employment',
  'random',
  'reasonable_suspicion',
  'post_accident',
  'return_to_duty',
  'follow_up'
];

// Valid substance_type values
const VALID_SUBSTANCE_TYPES = ['drug', 'alcohol', 'both'];

/**
 * Validate that a driver exists and belongs to the caller's tenant/operating entity.
 * Returns the driver row or null.
 */
async function validateDriverAccess(driverId, context) {
  const driverRes = await query(
    `SELECT id, tenant_id, operating_entity_id
       FROM drivers
      WHERE id = $1`,
    [driverId]
  );

  if (driverRes.rows.length === 0) return null;

  const driver = driverRes.rows[0];
  if (context?.tenantId && driver.tenant_id !== context.tenantId) return null;
  if (context?.operatingEntityId && driver.operating_entity_id !== context.operatingEntityId) return null;

  return driver;
}

/**
 * After creating or updating a test, update DQF requirements when the test
 * is a pre-employment drug test.
 */
async function handleDqfIntegration(driverId, testType, testResult, userId) {
  if (testType !== 'pre_employment') return;

  // Mark the scheduled requirement as in_progress
  await upsertRequirementStatus(driverId, 'pre_employment_drug_test_scheduled', 'in_progress', null);
  await logStatusChange(driverId, 'pre_employment_drug_test_scheduled', null, 'in_progress', userId, 'Test record created');

  // If negative result, mark completed
  if (testResult && testResult.toUpperCase() === 'NEGATIVE') {
    await upsertRequirementStatus(driverId, 'pre_employment_drug_test_completed', 'complete', null);
    await logStatusChange(driverId, 'pre_employment_drug_test_completed', null, 'complete', userId, 'Negative pre-employment result recorded');
  }

  await computeAndUpdateDqfCompleteness(driverId);
}

// ---------- GET all drug/alcohol records ----------
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

// ---------- GET tests pending Clearinghouse reporting ----------
router.get('/pending-clearinghouse', async (req, res) => {
  try {
    const startTime = Date.now();
    const params = [];
    const where = ['dat.reported_to_clearinghouse = false', 'dat.result IS NOT NULL'];

    if (req.context?.tenantId) {
      params.push(req.context.tenantId);
      where.push(`d.tenant_id = $${params.length}`);
    }
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      where.push(`d.operating_entity_id = $${params.length}`);
    }

    const result = await query(`
      SELECT dat.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM drug_alcohol_tests dat
      JOIN drivers d ON dat.driver_id = d.id
      WHERE ${where.join(' AND ')}
      ORDER BY dat.test_date DESC
    `, params);

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('SELECT', 'drug_alcohol_tests', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/drug-alcohol/pending-clearinghouse', 200, duration);

    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching pending clearinghouse tests:', error);
    return res.status(500).json({ message: 'Failed to fetch pending clearinghouse tests' });
  }
});

// ---------- GET summary (anonymized for dispatchers) ----------
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

// ---------- GET records by driver ID ----------
router.get('/driver/:driverId', async (req, res) => {
  const startTime = Date.now();
  try {
    const driver = await validateDriverAccess(req.params.driverId, req.context);
    if (!driver) {
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

// ---------- GET clearance status for a driver ----------
router.get('/driver/:driverId/clearance-status', async (req, res) => {
  const startTime = Date.now();
  try {
    const driver = await validateDriverAccess(req.params.driverId, req.context);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const clearance = await isDriverClearedToDrive(null, req.params.driverId);

    const duration = Date.now() - startTime;
    dtLogger.trackRequest('GET', `/api/drug-alcohol/driver/${req.params.driverId}/clearance-status`, 200, duration);

    return res.json(clearance);
  } catch (error) {
    console.error('Error checking driver clearance status:', error);
    return res.status(500).json({ message: 'Failed to check driver clearance status' });
  }
});

// ---------- POST create new test record ----------
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      driverId,
      testDate,
      result: testResult,
      testType,
      substanceType,
      panelDetails,
      collectionSite,
      collectionDate,
      resultDate,
      mroName,
      mroVerified,
      ccfNumber,
      labName,
      notes
    } = req.body;

    // Backward-compatible validation: original required fields
    if (!driverId || !testDate || !testResult) {
      return res.status(400).json({ message: 'driverId, testDate, and result are required' });
    }

    // Validate testType if provided
    if (testType && !VALID_TEST_TYPES.includes(testType)) {
      return res.status(400).json({
        message: `Invalid testType. Must be one of: ${VALID_TEST_TYPES.join(', ')}`
      });
    }

    // Validate substanceType if provided
    if (substanceType && !VALID_SUBSTANCE_TYPES.includes(substanceType)) {
      return res.status(400).json({
        message: `Invalid substanceType. Must be one of: ${VALID_SUBSTANCE_TYPES.join(', ')}`
      });
    }

    const driver = await validateDriverAccess(driverId, req.context);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const result = await query(
      `INSERT INTO drug_alcohol_tests (
        driver_id, test_date, result,
        test_type, substance_type, panel_details, collection_site,
        collection_date, result_date, mro_name, mro_verified,
        ccf_number, lab_name, notes,
        reported_to_clearinghouse,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false, NOW())
      RETURNING *`,
      [
        driverId, testDate, testResult,
        testType || null, substanceType || null, panelDetails || null, collectionSite || null,
        collectionDate || null, resultDate || null, mroName || null, mroVerified ?? null,
        ccfNumber || null, labName || null, notes || null
      ]
    );

    // DQF integration for pre-employment tests
    if (testType) {
      try {
        const userId = req.context?.userId || null;
        await handleDqfIntegration(driverId, testType, testResult, userId);
      } catch (dqfError) {
        // Log but do not fail the request -- the test record was already saved
        console.error('DQF integration error after test creation:', dqfError);
      }
    }

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('INSERT', 'drug_alcohol_tests', duration, true, { testId: result.rows[0].id });
    dtLogger.trackRequest('POST', '/api/drug-alcohol', 201, duration);

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating drug/alcohol test:', error);
    return res.status(500).json({ message: 'Failed to create drug/alcohol test' });
  }
});

// ---------- PUT update existing test record ----------
router.put('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const testId = req.params.id;

    // Fetch existing test to validate ownership
    const existingRes = await query(
      `SELECT dat.*, d.tenant_id, d.operating_entity_id
       FROM drug_alcohol_tests dat
       JOIN drivers d ON dat.driver_id = d.id
       WHERE dat.id = $1`,
      [testId]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({ message: 'Test record not found' });
    }

    const existing = existingRes.rows[0];

    // Tenant/entity scoping
    if (req.context?.tenantId && existing.tenant_id !== req.context.tenantId) {
      return res.status(404).json({ message: 'Test record not found' });
    }
    if (req.context?.operatingEntityId && existing.operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Test record not found' });
    }

    const {
      testDate,
      result: testResult,
      testType,
      substanceType,
      panelDetails,
      collectionSite,
      collectionDate,
      resultDate,
      mroName,
      mroVerified,
      ccfNumber,
      labName,
      notes
    } = req.body;

    // Validate testType if provided
    if (testType && !VALID_TEST_TYPES.includes(testType)) {
      return res.status(400).json({
        message: `Invalid testType. Must be one of: ${VALID_TEST_TYPES.join(', ')}`
      });
    }

    // Validate substanceType if provided
    if (substanceType && !VALID_SUBSTANCE_TYPES.includes(substanceType)) {
      return res.status(400).json({
        message: `Invalid substanceType. Must be one of: ${VALID_SUBSTANCE_TYPES.join(', ')}`
      });
    }

    const result = await query(
      `UPDATE drug_alcohol_tests SET
        test_date = COALESCE($1, test_date),
        result = COALESCE($2, result),
        test_type = COALESCE($3, test_type),
        substance_type = COALESCE($4, substance_type),
        panel_details = COALESCE($5, panel_details),
        collection_site = COALESCE($6, collection_site),
        collection_date = COALESCE($7, collection_date),
        result_date = COALESCE($8, result_date),
        mro_name = COALESCE($9, mro_name),
        mro_verified = COALESCE($10, mro_verified),
        ccf_number = COALESCE($11, ccf_number),
        lab_name = COALESCE($12, lab_name),
        notes = COALESCE($13, notes),
        updated_at = NOW()
      WHERE id = $14
      RETURNING *`,
      [
        testDate || null, testResult || null,
        testType || null, substanceType || null, panelDetails || null, collectionSite || null,
        collectionDate || null, resultDate || null, mroName || null, mroVerified ?? null,
        ccfNumber || null, labName || null, notes || null,
        testId
      ]
    );

    // DQF integration -- use the resolved values from the updated row
    const updatedRow = result.rows[0];
    const resolvedType = testType || existing.test_type;
    const resolvedResult = testResult || existing.result;

    if (resolvedType) {
      try {
        const userId = req.context?.userId || null;
        await handleDqfIntegration(existing.driver_id, resolvedType, resolvedResult, userId);
      } catch (dqfError) {
        console.error('DQF integration error after test update:', dqfError);
      }
    }

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('UPDATE', 'drug_alcohol_tests', duration, true, { testId });
    dtLogger.trackRequest('PUT', `/api/drug-alcohol/${testId}`, 200, duration);

    return res.json(updatedRow);
  } catch (error) {
    console.error('Error updating drug/alcohol test:', error);
    return res.status(500).json({ message: 'Failed to update drug/alcohol test' });
  }
});

// ---------- POST mark test as reported to Clearinghouse ----------
router.post('/:id/mark-reported', async (req, res) => {
  const startTime = Date.now();
  try {
    const testId = req.params.id;

    // Fetch test with tenant scoping
    const existingRes = await query(
      `SELECT dat.id, d.tenant_id, d.operating_entity_id
       FROM drug_alcohol_tests dat
       JOIN drivers d ON dat.driver_id = d.id
       WHERE dat.id = $1`,
      [testId]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({ message: 'Test record not found' });
    }

    const existing = existingRes.rows[0];
    if (req.context?.tenantId && existing.tenant_id !== req.context.tenantId) {
      return res.status(404).json({ message: 'Test record not found' });
    }
    if (req.context?.operatingEntityId && existing.operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Test record not found' });
    }

    const result = await query(
      `UPDATE drug_alcohol_tests
       SET reported_to_clearinghouse = true,
           clearinghouse_reported_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [testId]
    );

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('UPDATE', 'drug_alcohol_tests', duration, true, { testId });
    dtLogger.trackRequest('POST', `/api/drug-alcohol/${testId}/mark-reported`, 200, duration);

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error marking test as reported:', error);
    return res.status(500).json({ message: 'Failed to mark test as reported' });
  }
});

module.exports = router;
