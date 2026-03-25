const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const { uploadBuffer } = require('../storage/r2-storage');
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
 *
 * FN-223: Enhanced lifecycle:
 * - Test created → mark pre_employment_drug_test_submitted as complete
 * - Result NEGATIVE → mark pre_employment_drug_test_result_received as complete
 *   AND mark pre_employment_drug_test_completed as complete (with evidence doc)
 * - Result non-negative → mark pre_employment_drug_test_result_received as 'review_required'
 */
async function handleDqfIntegration(driverId, testType, testResult, userId, resultDocumentId, resultReceivedDate) {
  if (testType !== 'pre_employment') return;

  // FN-223: Mark test as submitted (always, on create)
  await upsertRequirementStatus(driverId, 'pre_employment_drug_test_submitted', 'complete', null);
  await logStatusChange(driverId, 'pre_employment_drug_test_submitted', null, 'complete', userId, 'Pre-employment drug test created');

  // Mark the scheduled requirement as in_progress
  await upsertRequirementStatus(driverId, 'pre_employment_drug_test_scheduled', 'in_progress', null);
  await logStatusChange(driverId, 'pre_employment_drug_test_scheduled', null, 'in_progress', userId, 'Test record created');

  if (testResult) {
    const upperResult = testResult.toUpperCase();
    const completionDate = resultReceivedDate || null;

    if (upperResult === 'NEGATIVE') {
      // FN-223/FN-225: Negative result → complete both result_received and completed
      await upsertRequirementStatus(driverId, 'pre_employment_drug_test_result_received', 'complete', resultDocumentId || null, completionDate);
      await logStatusChange(driverId, 'pre_employment_drug_test_result_received', null, 'complete', userId, 'Negative pre-employment result received');

      // FN-225: Only mark completed with evidence doc when we have both negative result AND document
      if (resultDocumentId) {
        await upsertRequirementStatus(driverId, 'pre_employment_drug_test_completed', 'complete', resultDocumentId, completionDate);
        await logStatusChange(driverId, 'pre_employment_drug_test_completed', null, 'complete', userId, 'Negative pre-employment result recorded with evidence document');
      } else {
        await upsertRequirementStatus(driverId, 'pre_employment_drug_test_completed', 'complete', null, completionDate);
        await logStatusChange(driverId, 'pre_employment_drug_test_completed', null, 'complete', userId, 'Negative pre-employment result recorded');
      }
    } else {
      // FN-223: Non-negative result → mark result_received as review_required
      await upsertRequirementStatus(driverId, 'pre_employment_drug_test_result_received', 'review_required', resultDocumentId || null, completionDate);
      await logStatusChange(
        driverId, 'pre_employment_drug_test_result_received', null, 'review_required', userId,
        `Insufficient result: ${testResult}. Review required.`
      );
    }
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
// Support both /driver/:driverId and /driver/:driverId/tests (frontend uses the latter)
router.get(['/driver/:driverId', '/driver/:driverId/tests'], async (req, res) => {
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

// ---------- POST upload result document for a test ----------
router.post('/driver/:driverId/tests/:testId/result-document', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  try {
    const { driverId, testId } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const driver = await validateDriverAccess(driverId, req.context);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    // Verify the test exists and belongs to this driver
    const testRes = await query(
      `SELECT id, driver_id FROM drug_alcohol_tests WHERE id = $1 AND driver_id = $2`,
      [testId, driverId]
    );
    if (testRes.rows.length === 0) {
      return res.status(404).json({ message: 'Test record not found for this driver' });
    }

    const file = req.file;
    const fileName = file.originalname || 'drug_test_result';
    const contentType = file.mimetype || 'application/octet-stream';

    // Upload to R2
    const r2Result = await uploadBuffer({
      buffer: file.buffer,
      fileName,
      contentType,
      prefix: `drivers/${driverId}/drug-test-results`
    });

    // Create driver_documents record
    const docRes = await query(
      `INSERT INTO driver_documents (driver_id, doc_type, file_name, content_type, r2_key, uploaded_by, created_at)
       VALUES ($1, 'drug_test_result', $2, $3, $4, $5, NOW())
       RETURNING *`,
      [driverId, fileName, contentType, r2Result.key, req.context?.userId || null]
    );
    const doc = docRes.rows[0];

    // Create driver_document_blobs record with the file buffer
    await query(
      `INSERT INTO driver_document_blobs (document_id, file_data, created_at)
       VALUES ($1, $2, NOW())`,
      [doc.id, file.buffer]
    );

    // Update drug_alcohol_tests.result_document_id
    await query(
      `UPDATE drug_alcohol_tests SET result_document_id = $1, updated_at = NOW() WHERE id = $2`,
      [doc.id, testId]
    );

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('INSERT', 'driver_documents', duration, true, { docId: doc.id, testId });
    dtLogger.trackRequest('POST', `/api/drug-alcohol/driver/${driverId}/tests/${testId}/result-document`, 201, duration);

    return res.status(201).json({
      id: doc.id,
      doc_type: doc.doc_type,
      file_name: doc.file_name,
      content_type: doc.content_type,
      r2_key: r2Result.key,
      created_at: doc.created_at
    });
  } catch (error) {
    console.error('Error uploading drug test result document:', error);
    return res.status(500).json({ message: 'Failed to upload result document' });
  }
});

// ---------- POST create new test record ----------
// Support both POST / (original) and POST /driver/:driverId/tests (frontend)
router.post(['/', '/driver/:driverId/tests'], async (req, res) => {
  const startTime = Date.now();
  try {
    // Accept both camelCase and snake_case field names (frontend sends snake_case)
    const body = req.body;
    const driverId = req.params.driverId || body.driverId || body.driver_id;
    const testDate = body.testDate || body.test_date || body.collection_date;
    const testResult = body.result || body.test_result;
    const testType = body.testType || body.test_type;
    const substanceType = body.substanceType || body.substance_type;
    const panelDetails = body.panelDetails || body.panel_details;
    const collectionSite = body.collectionSite || body.collection_site;
    const collectionDate = body.collectionDate || body.collection_date;
    const resultDate = body.resultDate || body.result_date;
    const mroName = body.mroName || body.mro_name;
    const mroVerified = body.mroVerified ?? body.mro_verified;
    const ccfNumber = body.ccfNumber || body.ccf_number;
    const labName = body.labName || body.lab_name;
    const notes = body.notes;
    const resultReceivedDate = body.resultReceivedDate || body.result_received_date;

    // driverId is always required; result is optional (test may be scheduled before results arrive)
    if (!driverId) {
      return res.status(400).json({ message: 'driverId is required (URL param or body)' });
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
        collection_date, result_date, result_received_date, mro_name, mro_verified,
        ccf_number, lab_name, notes,
        reported_to_clearinghouse,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, false, NOW())
      RETURNING *`,
      [
        driverId, testDate || collectionDate || null, testResult || null,
        testType || null, substanceType || null,
        panelDetails ? JSON.stringify(panelDetails) : null,
        collectionSite || null,
        collectionDate || null, resultDate || null, resultReceivedDate || null,
        mroName || null, mroVerified ?? null,
        ccfNumber || null, labName || null, notes || null
      ]
    );

    // DQF integration for pre-employment tests
    const createdRow = result.rows[0];
    if (testType) {
      try {
        const userId = req.context?.userId || null;
        await handleDqfIntegration(driverId, testType, testResult, userId, createdRow?.result_document_id, resultReceivedDate);
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
// Support both PUT /:id (original) and PUT /tests/:id (frontend)
router.put(['/:id', '/tests/:id'], async (req, res) => {
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

    // Accept both camelCase and snake_case field names
    const b = req.body;
    const testDate = b.testDate || b.test_date;
    const testResult = b.result || b.test_result;
    const testType = b.testType || b.test_type;
    const substanceType = b.substanceType || b.substance_type;
    const panelDetails = b.panelDetails || b.panel_details;
    const collectionSite = b.collectionSite || b.collection_site;
    const collectionDate = b.collectionDate || b.collection_date;
    const resultDate = b.resultDate || b.result_date;
    const mroName = b.mroName || b.mro_name;
    const mroVerified = b.mroVerified ?? b.mro_verified;
    const ccfNumber = b.ccfNumber || b.ccf_number;
    const labName = b.labName || b.lab_name;
    const notes = b.notes;
    const resultReceivedDate = b.resultReceivedDate || b.result_received_date;

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
        result_received_date = COALESCE($9, result_received_date),
        mro_name = COALESCE($10, mro_name),
        mro_verified = COALESCE($11, mro_verified),
        ccf_number = COALESCE($12, ccf_number),
        lab_name = COALESCE($13, lab_name),
        notes = COALESCE($14, notes),
        updated_at = NOW()
      WHERE id = $15
      RETURNING *`,
      [
        testDate || null, testResult || null,
        testType || null, substanceType || null,
        panelDetails ? JSON.stringify(panelDetails) : null,
        collectionSite || null,
        collectionDate || null, resultDate || null, resultReceivedDate || null,
        mroName || null, mroVerified ?? null,
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
        const resolvedReceivedDate = resultReceivedDate || existing.result_received_date;
        await handleDqfIntegration(existing.driver_id, resolvedType, resolvedResult, userId, updatedRow?.result_document_id, resolvedReceivedDate);
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

// ---------- Mark test as reported to Clearinghouse ----------
// Handler shared by POST /:id/mark-reported and PATCH /tests/:id/clearinghouse-reported
async function markTestReportedHandler(req, res) {
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
    dtLogger.trackRequest(req.method, req.originalUrl, 200, duration);

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error marking test as reported:', error);
    return res.status(500).json({ message: 'Failed to mark test as reported' });
  }
}

router.post('/:id/mark-reported', markTestReportedHandler);
router.patch('/tests/:id/clearinghouse-reported', markTestReportedHandler);

module.exports = router;
