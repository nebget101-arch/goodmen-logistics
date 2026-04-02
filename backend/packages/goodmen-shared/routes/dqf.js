const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('./auth-middleware');
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const { upsertRequirementStatus, computeAndUpdateDqfCompleteness, logStatusChange, computeWarningItems, computeDueDateAndUrgency } = require('../services/dqf-service');
const { transformRow } = require('../utils/case-converter');
const { createDriverDocument } = require('../services/driver-storage-service');
const { generateEmploymentApplicationPdf } = require('../services/pdf.service');
const { extractMvrData } = require('../services/mvr-extraction-service');
const pdfParse = require('pdf-parse');

// File upload (memory storage - max 10 MB, PDF/image only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/tiff'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and image files are accepted'));
    }
  }
});

// Admin / safety only
router.use(auth(['admin', 'safety']));

// GET /api/dqf - list DQF documents scoped through drivers
/**
 * @openapi
 * /api/dqf:
 *   get:
 *     summary: List all DQF records
 *     description: >
 *       Retrieves all Driver Qualification File document records scoped to the
 *       caller's tenant and operating entity. Per 49 CFR Part 391 — Qualifications
 *       of Drivers and Longer Combination Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of DQF document records with driver info
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   driver_id:
 *                     type: string
 *                     format: uuid
 *                   first_name:
 *                     type: string
 *                   last_name:
 *                     type: string
 *                   operating_entity_id:
 *                     type: string
 *                     format: uuid
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  try {
    const params = [];
    const where = [];

    if (req.context?.tenantId) {
      params.push(req.context.tenantId);
      where.push(`dr.tenant_id = $${params.length}`);
    }
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      where.push(`dr.operating_entity_id = $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await query(
      `SELECT dd.*, dr.first_name, dr.last_name, dr.operating_entity_id
       FROM dqf_documents dd
       JOIN drivers dr ON dr.id = dd.driver_id
       ${whereClause}
       ORDER BY dd.created_at DESC`,
      params
    );

    const duration = Date.now() - start;
    dtLogger.trackDatabase('SELECT', 'dqf_documents', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/dqf', 200, duration, { count: result.rows.length });

    return res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('dqf_list_failed', error);
    dtLogger.trackRequest('GET', '/api/dqf', 500, duration);
    return res.status(500).json({ message: 'Failed to load DQF records' });
  }
});

// FN-261: GET /api/dqf/driver/:driverId/status
// Returns DQF completeness with category-aware breakdown and warning items.
/**
 * @openapi
 * /api/dqf/driver/{driverId}/status:
 *   get:
 *     summary: Get DQF completeness status for a driver
 *     description: >
 *       Returns the DQF completeness score with a category-aware breakdown of all
 *       requirements (including status, evidence, due dates, and urgency) plus
 *       warning items. Completeness is calculated as
 *       (sum of completed requirement weights) / (sum of all non-excluded requirement weights) * 100.
 *       Each requirement has a weight from the dqf_requirements table. Requirements
 *       with exclude_from_dqf=true are omitted from the score. Per 49 CFR Part 391
 *       — Qualifications of Drivers and Longer Combination Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver's unique identifier
 *     responses:
 *       200:
 *         description: DQF status with completeness score, requirements, and warnings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 driverId:
 *                   type: string
 *                   format: uuid
 *                 hire_date:
 *                   type: string
 *                   format: date
 *                   nullable: true
 *                 completeness:
 *                   type: number
 *                   description: Percentage 0-100
 *                 requirements:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key:
 *                         type: string
 *                       label:
 *                         type: string
 *                       weight:
 *                         type: number
 *                       category:
 *                         type: string
 *                       exclude_from_dqf:
 *                         type: boolean
 *                       status:
 *                         type: string
 *                         enum: [complete, missing, review_required]
 *                       evidence_document_id:
 *                         type: string
 *                         format: uuid
 *                         nullable: true
 *                       completion_date:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       due_date:
 *                         type: string
 *                         format: date
 *                         nullable: true
 *                       urgency:
 *                         type: string
 *                         nullable: true
 *                 warning_items:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
router.get('/driver/:driverId/status', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;

    const driverRes = await query(
      `SELECT id, operating_entity_id, hire_date, dqf_completeness
       FROM drivers WHERE id = $1`,
      [driverId]
    );
    if (driverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    const driver = driverRes.rows[0];
    if (req.context?.operatingEntityId && driver.operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    // Fetch all requirements with their category and exclude flag
    const reqRes = await query(
      `SELECT
         r.key,
         r.label,
         r.weight,
         r.category,
         r.exclude_from_dqf,
         COALESCE(s.status, 'missing') AS status,
         s.evidence_document_id,
         s.completion_date,
         s.last_updated_at
       FROM dqf_requirements r
       LEFT JOIN dqf_driver_status s
         ON s.requirement_key = r.key
        AND s.driver_id = $1
       ORDER BY r.category, r.key`,
      [driverId]
    );

    // Compute warning items
    const warningItems = await computeWarningItems(driverId);

    // FN-319: Enrich requirements with due_date and urgency for time-sensitive items
    const enrichedRequirements = reqRes.rows.map((req) => {
      const { due_date, urgency } = computeDueDateAndUrgency(req.category, req.key, driver.hire_date);
      return { ...req, due_date: due_date || null, urgency: urgency || null };
    });

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/dqf/driver/${driverId}/status`, 200, duration);

    return res.json({
      driverId,
      hire_date: driver.hire_date,
      completeness: driver.dqf_completeness,
      requirements: enrichedRequirements,
      warning_items: warningItems
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('dqf_driver_status_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('GET', `/api/dqf/driver/${req.params.driverId}/status`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error in GET /api/dqf/driver/:driverId/status', error);
    return res.status(500).json({ message: 'Failed to load DQF status' });
  }
});

// GET /api/dqf/drivers/:driverId
/**
 * @openapi
 * /api/dqf/drivers/{driverId}:
 *   get:
 *     summary: Get full DQF profile for a driver
 *     description: >
 *       Returns the driver's profile, all DQF requirements with statuses, and all
 *       driver documents. Auto-reconciles onboarding completion with DQF
 *       requirements if they are out of sync (e.g. employment_application_submitted).
 *       Per 49 CFR Part 391 — Qualifications of Drivers and Longer Combination
 *       Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver's unique identifier
 *     responses:
 *       200:
 *         description: Driver profile with DQF requirements and documents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 driver:
 *                   type: object
 *                   description: Driver profile in camelCase
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     email:
 *                       type: string
 *                     cdlNumber:
 *                       type: string
 *                     cdlState:
 *                       type: string
 *                     cdlExpiry:
 *                       type: string
 *                       format: date
 *                     status:
 *                       type: string
 *                     dqfCompleteness:
 *                       type: number
 *                 dqf:
 *                   type: object
 *                   properties:
 *                     requirements:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           key:
 *                             type: string
 *                           label:
 *                             type: string
 *                           weight:
 *                             type: number
 *                           category:
 *                             type: string
 *                           status:
 *                             type: string
 *                     documents:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           doc_type:
 *                             type: string
 *                           file_name:
 *                             type: string
 *                     completeness:
 *                       type: number
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
router.get('/drivers/:driverId', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;

    const driverRes = await query(
      `SELECT
         id,
         operating_entity_id,
         first_name,
         last_name,
         email,
         phone,
         cdl_number,
         cdl_state,
         cdl_class,
         cdl_expiry,
         date_of_birth,
         street_address,
         city,
         state,
         zip_code,
         medical_cert_expiry,
         hire_date,
         status,
         dqf_completeness
       FROM drivers
       WHERE id = $1`,
      [driverId]
    );

    if (driverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    // Validate OE access: ensure driver belongs to active OE context
    const driver = driverRes.rows[0];
    if (req.context?.operatingEntityId && driver.operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    const requirementsRes = await query(
      `SELECT
         r.key,
         r.label,
         r.weight,
         r.category,
         r.exclude_from_dqf,
         COALESCE(s.status, 'missing') AS status,
         s.evidence_document_id,
         s.completion_date,
         s.last_updated_at
       FROM dqf_requirements r
       LEFT JOIN dqf_driver_status s
         ON s.requirement_key = r.key
        AND s.driver_id = $1
       ORDER BY r.category, r.key`,
      [driverId]
    );

    const docsRes = await query(
      `SELECT
         id,
         packet_id,
         doc_type,
         file_name,
         mime_type,
         size_bytes,
         created_at
       FROM driver_documents
       WHERE driver_id = $1
       ORDER BY created_at DESC`,
      [driverId]
    );

    // ── Auto-reconcile: sync onboarding completion to DQF if out of sync ──
    const requirements = requirementsRes.rows;
    try {
      // Check employment_application_submitted
      const empAppReq = requirements.find(r => r.key === 'employment_application_submitted');
      if (empAppReq && empAppReq.status === 'missing') {
        // Check if a completed onboarding section exists
        const sectionCheck = await query(
          `SELECT dos.id, dos.completed_at, dop.id AS packet_id
           FROM driver_onboarding_sections dos
           JOIN driver_onboarding_packets dop ON dop.id = dos.packet_id
           WHERE dop.driver_id = $1
             AND dos.section_key = 'employment_application'
             AND dos.status = 'completed'
           ORDER BY dos.completed_at DESC LIMIT 1`,
          [driverId]
        );
        if (sectionCheck.rows.length > 0) {
          // Also check for an existing document
          const docCheck = await query(
            `SELECT id FROM driver_documents
             WHERE driver_id = $1 AND doc_type IN ('employment_application_signed', 'employment_application_pdf')
             ORDER BY created_at DESC LIMIT 1`,
            [driverId]
          );
          const evidenceDocId = docCheck.rows[0]?.id || null;
          await upsertRequirementStatus(driverId, 'employment_application_submitted', 'complete', evidenceDocId, sectionCheck.rows[0].completed_at);
          empAppReq.status = 'complete';
          empAppReq.evidence_document_id = evidenceDocId;
          empAppReq.completion_date = sectionCheck.rows[0].completed_at;
          await computeAndUpdateDqfCompleteness(driverId);
          dtLogger.info('dqf_auto_reconciled_emp_app', { driverId });
        }
      }

      // Check employment_application_completed (legacy key)
      const empAppCompReq = requirements.find(r => r.key === 'employment_application_completed');
      if (empAppCompReq && empAppCompReq.status === 'missing') {
        const sectionCheck2 = await query(
          `SELECT dos.completed_at
           FROM driver_onboarding_sections dos
           JOIN driver_onboarding_packets dop ON dop.id = dos.packet_id
           WHERE dop.driver_id = $1
             AND dos.section_key = 'employment_application'
             AND dos.status = 'completed'
           LIMIT 1`,
          [driverId]
        );
        if (sectionCheck2.rows.length > 0) {
          const docCheck2 = await query(
            `SELECT id FROM driver_documents
             WHERE driver_id = $1 AND doc_type IN ('employment_application_signed', 'employment_application_pdf')
             ORDER BY created_at DESC LIMIT 1`,
            [driverId]
          );
          const evidenceDocId2 = docCheck2.rows[0]?.id || null;
          await upsertRequirementStatus(driverId, 'employment_application_completed', 'complete', evidenceDocId2, sectionCheck2.rows[0].completed_at);
          empAppCompReq.status = 'complete';
          empAppCompReq.evidence_document_id = evidenceDocId2;
          empAppCompReq.completion_date = sectionCheck2.rows[0].completed_at;
          await computeAndUpdateDqfCompleteness(driverId);
        }
      }
    } catch (reconcileErr) {
      // Non-blocking — don't fail the DQF load
      dtLogger.warn('dqf_auto_reconcile_failed', { driverId, error: reconcileErr?.message });
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/dqf/drivers/${driverId}`, 200, duration, {
      driverId
    });

    return res.json({
      driver: transformRow(driverRes.rows[0]),
      dqf: {
        requirements,
        documents: docsRes.rows,
        completeness: driverRes.rows[0].dqf_completeness
      }
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('dqf_get_driver_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('GET', `/api/dqf/drivers/${req.params.driverId}`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error in GET /api/dqf/drivers/:driverId', error);
    return res.status(500).json({ message: 'Failed to load DQF driver status' });
  }
});

// GET /api/dqf/documents/:id/download - download generated driver_documents (e.g. onboarding PDFs)
/**
 * @openapi
 * /api/dqf/documents/{id}/download:
 *   get:
 *     summary: Download a driver document file
 *     description: >
 *       Downloads the binary content of a driver document (e.g. onboarding PDFs,
 *       signed forms). Attempts to retrieve bytes from the database blob, then
 *       falls back to R2 cloud storage. Per 49 CFR Part 391 — Qualifications of
 *       Drivers and Longer Combination Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver document ID
 *     responses:
 *       200:
 *         description: File binary content with Content-Disposition header
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Document not found or document data not found
 *       500:
 *         description: Server error
 */
router.get('/documents/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT d.file_name,
              d.mime_type,
              d.storage_key,
              d.storage_mode,
              d.blob_id,
              b.bytes
       FROM driver_documents d
       LEFT JOIN driver_document_blobs b
         ON b.id = d.blob_id
       WHERE d.id = $1::uuid`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Validate OE access through the parent driver
    const driverRes = await query(
      `SELECT dr.operating_entity_id
         FROM driver_documents dd
         JOIN drivers dr ON dr.id = dd.driver_id
        WHERE dd.id = $1::uuid`,
      [id]
    );
    if (driverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }
    if (req.context?.operatingEntityId && driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const docRow = result.rows[0];
    let bytes = docRow.bytes;

    // If no bytes from DB blob, try downloading from R2 storage
    if (!bytes && docRow.storage_key && docRow.storage_mode === 'r2') {
      try {
        const r2 = require('../storage/r2-storage');
        bytes = await r2.downloadBuffer(docRow.storage_key);
      } catch (r2Err) {
        dtLogger.warn('r2_download_failed', { documentId: id, storageKey: docRow.storage_key, error: r2Err?.message });
      }
    }

    // Fallback: try fetching blob by blob_id if bytes still not found
    if (!bytes && docRow.blob_id) {
      const blobRes = await query(
        'SELECT bytes FROM driver_document_blobs WHERE id = $1',
        [docRow.blob_id]
      );
      if (blobRes.rows.length > 0 && blobRes.rows[0].bytes) {
        bytes = blobRes.rows[0].bytes;
      }
    }

    if (!bytes) {
      return res.status(404).json({ message: 'Document data not found' });
    }
    const fileName = docRow.file_name || 'document.pdf';
    const mimeType = docRow.mime_type || 'application/pdf';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(bytes);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error downloading driver document:', error);
    return res.status(500).json({ message: 'Failed to download document' });
  }
});

// POST /api/dqf/requirement/:driverId/:requirementKey - Update a requirement status manually
/**
 * @openapi
 * /api/dqf/requirement/{driverId}/{requirementKey}:
 *   post:
 *     summary: Update a DQF requirement status manually
 *     description: >
 *       Sets the status of a specific DQF requirement for a driver. Logs the
 *       status change for audit purposes and recomputes DQF completeness. Per 49
 *       CFR Part 391 — Qualifications of Drivers and Longer Combination Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver's unique identifier
 *       - in: path
 *         name: requirementKey
 *         required: true
 *         schema:
 *           type: string
 *         description: The DQF requirement key (e.g. employment_application_submitted)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 description: New status value (e.g. complete, missing, review_required)
 *               evidenceDocumentId:
 *                 type: string
 *                 format: uuid
 *                 description: Optional evidence document ID
 *               note:
 *                 type: string
 *                 description: Optional audit note
 *               completionDate:
 *                 type: string
 *                 format: date-time
 *                 description: Optional completion date
 *     responses:
 *       200:
 *         description: Requirement status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 driverId:
 *                   type: string
 *                   format: uuid
 *                 requirementKey:
 *                   type: string
 *                 oldStatus:
 *                   type: string
 *                 newStatus:
 *                   type: string
 *       400:
 *         description: Missing required status field
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
router.post('/requirement/:driverId/:requirementKey', async (req, res) => {
  try {
    const { driverId, requirementKey } = req.params;
    const { status, evidenceDocumentId, note, completionDate } = req.body;

    const driverScopeRes = await query(
      `SELECT id, operating_entity_id
         FROM drivers
        WHERE id = $1`,
      [driverId]
    );
    if (driverScopeRes.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    if (req.context?.operatingEntityId && driverScopeRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    if (!status) {
      return res.status(400).json({ message: 'status is required' });
    }

    // Get current status for audit log
    const currentRes = await query(
      'SELECT status FROM dqf_driver_status WHERE driver_id = $1 AND requirement_key = $2',
      [driverId, requirementKey]
    );
    const oldStatus = currentRes.rows.length > 0 ? currentRes.rows[0].status : 'missing';

    // FN-223: Update the requirement with optional completion_date
    await upsertRequirementStatus(driverId, requirementKey, status, evidenceDocumentId || null, completionDate || null);

    // Log the change
    const userId = req.user?.id || null;
    await logStatusChange(driverId, requirementKey, oldStatus, status, userId, note || null);

    // Recompute DQF completeness
    await computeAndUpdateDqfCompleteness(driverId);

    return res.json({
      message: 'Requirement status updated',
      driverId,
      requirementKey,
      oldStatus,
      newStatus: status
    });
  } catch (error) {
    dtLogger.error('dqf_update_requirement_failed', error, {
      driverId: req.params.driverId,
      requirementKey: req.params.requirementKey
    });
    // eslint-disable-next-line no-console
    console.error('Error in POST /api/dqf/requirement/:driverId/:requirementKey', error);
    return res.status(500).json({ message: 'Failed to update requirement status' });
  }
});

// POST /api/dqf/driver/:driverId/recalculate - Recalculate DQF completeness from current requirement statuses
/**
 * @openapi
 * /api/dqf/driver/{driverId}/recalculate:
 *   post:
 *     summary: Recalculate DQF completeness for a driver
 *     description: >
 *       Forces a recalculation of the DQF completeness score from current
 *       requirement statuses. Completeness = (sum of completed requirement weights) /
 *       (sum of all non-excluded requirement weights) * 100. Pass ?debug=1 to
 *       include a breakdown of totalWeight, completedWeight, missing requirements,
 *       counted, and skipped. Per 49 CFR Part 391 — Qualifications of Drivers and
 *       Longer Combination Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver's unique identifier
 *       - in: query
 *         name: debug
 *         schema:
 *           type: string
 *           enum: ['1']
 *         description: Set to 1 to include weight breakdown in response
 *     responses:
 *       200:
 *         description: Recalculated completeness score
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 driverId:
 *                   type: string
 *                   format: uuid
 *                 completeness:
 *                   type: number
 *                 breakdown:
 *                   type: object
 *                   description: Only present when ?debug=1
 *                   properties:
 *                     totalWeight:
 *                       type: number
 *                     completedWeight:
 *                       type: number
 *                     missing:
 *                       type: array
 *                       items:
 *                         type: string
 *                     counted:
 *                       type: integer
 *                     skipped:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/driver/:driverId/recalculate', async (req, res) => {
  try {
    const { driverId } = req.params;
    const result = await computeAndUpdateDqfCompleteness(driverId);
    // FN-366: result is now { completeness, totalWeight, completedWeight, counted, skipped }
    const completeness = typeof result === 'object' ? result.completeness : result;
    const response = { driverId, completeness };
    // Include breakdown in debug mode (query param ?debug=1)
    if (req.query.debug === '1' && typeof result === 'object') {
      response.breakdown = {
        totalWeight: result.totalWeight,
        completedWeight: result.completedWeight,
        missing: result.counted.filter(r => r.status !== 'complete').map(r => r.key),
        counted: result.counted.length,
        skipped: result.skipped
      };
    }
    return res.json(response);
  } catch (error) {
    dtLogger.error('dqf_recalculate_failed', error, { driverId: req.params.driverId });
    return res.status(500).json({ message: 'Failed to recalculate DQF completeness' });
  }
});

// GET /api/dqf/requirement/:driverId/:requirementKey/changes - Get change history for a requirement
/**
 * @openapi
 * /api/dqf/requirement/{driverId}/{requirementKey}/changes:
 *   get:
 *     summary: Get change history for a DQF requirement
 *     description: >
 *       Returns the audit trail of all status changes for a specific DQF
 *       requirement, ordered by most recent first. Per 49 CFR Part 391 —
 *       Qualifications of Drivers and Longer Combination Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver's unique identifier
 *       - in: path
 *         name: requirementKey
 *         required: true
 *         schema:
 *           type: string
 *         description: The DQF requirement key
 *     responses:
 *       200:
 *         description: List of status changes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 driverId:
 *                   type: string
 *                   format: uuid
 *                 requirementKey:
 *                   type: string
 *                 changes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       requirement_key:
 *                         type: string
 *                       old_status:
 *                         type: string
 *                         nullable: true
 *                       new_status:
 *                         type: string
 *                       changed_by_user_id:
 *                         type: string
 *                         format: uuid
 *                         nullable: true
 *                       changed_at:
 *                         type: string
 *                         format: date-time
 *                       note:
 *                         type: string
 *                         nullable: true
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
router.get('/requirement/:driverId/:requirementKey/changes', async (req, res) => {
  try {
    const { driverId, requirementKey } = req.params;

    const driverScopeRes = await query(
      `SELECT id, operating_entity_id
         FROM drivers
        WHERE id = $1`,
      [driverId]
    );
    if (driverScopeRes.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    if (req.context?.operatingEntityId && driverScopeRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const result = await query(
      `SELECT
         id,
         requirement_key,
         old_status,
         new_status,
         changed_by_user_id,
         changed_at,
         note
       FROM dqf_status_changes
       WHERE driver_id = $1 AND requirement_key = $2
       ORDER BY changed_at DESC`,
      [driverId, requirementKey]
    );

    return res.json({
      driverId,
      requirementKey,
      changes: result.rows
    });
  } catch (error) {
    dtLogger.error('dqf_get_changes_failed', error, {
      driverId: req.params.driverId,
      requirementKey: req.params.requirementKey
    });
    // eslint-disable-next-line no-console
    console.error('Error in GET /api/dqf/requirement/:driverId/:requirementKey/changes', error);
    return res.status(500).json({ message: 'Failed to fetch requirement changes' });
  }
});

// FN-237: GET /api/dqf/driver/:driverId/prehire-documents
// List all pre-hire documents for a driver (employment app + consent forms)
/**
 * @openapi
 * /api/dqf/driver/{driverId}/prehire-documents:
 *   get:
 *     summary: List pre-hire documents for a driver
 *     description: >
 *       Returns all pre-hire documents for a driver including employment
 *       applications, consent forms (FCRA, drug/alcohol, Clearinghouse, PSP, MVR),
 *       onboarding uploads (CDL, medical cert, SSN), and MVR reports. Per 49 CFR
 *       Part 391 — Qualifications of Drivers and Longer Combination Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver's unique identifier
 *     responses:
 *       200:
 *         description: Array of pre-hire document records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   driver_id:
 *                     type: string
 *                     format: uuid
 *                   packet_id:
 *                     type: string
 *                     format: uuid
 *                     nullable: true
 *                   doc_type:
 *                     type: string
 *                   file_name:
 *                     type: string
 *                   mime_type:
 *                     type: string
 *                   size_bytes:
 *                     type: integer
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
router.get('/driver/:driverId/prehire-documents', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;

    // Validate driver exists and OE access
    const driverRes = await query(
      'SELECT id, operating_entity_id FROM drivers WHERE id = $1',
      [driverId]
    );
    if (driverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    if (req.context?.operatingEntityId && driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const docs = await query(
      `SELECT
         id,
         driver_id,
         packet_id,
         doc_type,
         file_name,
         mime_type,
         size_bytes,
         created_at
       FROM driver_documents
       WHERE driver_id = $1
         AND doc_type IN (
           'employment_application_signed',
           'employment_application_pdf',
           'consent_fcra_disclosure_signed',
           'consent_fcra_authorization_signed',
           'consent_release_of_information_signed',
           'consent_drug_alcohol_release_signed',
           'consent_clearinghouse_full_signed',
           'consent_psp_consent_signed',
           'consent_mvr_disclosure_signed',
           'consent_mvr_authorization_signed',
           'consent_mvr_release_of_liability_signed',
           'onboarding_cdl_front',
           'onboarding_cdl_back',
           'onboarding_medical_certificate',
           'onboarding_social_security_card',
           'onboarding_other_certification',
           'mvr_report'
         )
         AND (deleted_at IS NULL)
       ORDER BY created_at DESC`,
      [driverId]
    );

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/dqf/driver/${driverId}/prehire-documents`, 200, duration, {
      driverId,
      count: docs.rows.length
    });

    return res.json(docs.rows);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('dqf_prehire_documents_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('GET', `/api/dqf/driver/${req.params.driverId}/prehire-documents`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error in GET /api/dqf/driver/:driverId/prehire-documents', error);
    return res.status(500).json({ message: 'Failed to load pre-hire documents' });
  }
});

// FN-240: POST /api/dqf/driver/:driverId/auto-pull-emp-app
// Auto-pull an existing employment application document into the DQF checklist.
// Looks for an already-generated `employment_application_signed` document first;
// if none exists, regenerates the PDF from the onboarding packet data.
/**
 * @openapi
 * /api/dqf/driver/{driverId}/auto-pull-emp-app:
 *   post:
 *     summary: Auto-pull employment application into DQF
 *     description: >
 *       Searches for an existing employment_application_signed document and links
 *       it to the DQF checklist. If none exists, regenerates the PDF from
 *       onboarding packet data and stores it. Marks the
 *       employment_application_submitted requirement as complete and recomputes
 *       DQF completeness. Per 49 CFR Part 391 — Qualifications of Drivers and
 *       Longer Combination Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver's unique identifier
 *     responses:
 *       200:
 *         description: Employment application pulled or generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 documentId:
 *                   type: string
 *                   format: uuid
 *                 source:
 *                   type: string
 *                   enum: [existing, generated]
 *                   description: Whether an existing doc was used or a new one was generated
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found or no employment application found
 *       500:
 *         description: Server error
 */
router.post('/driver/:driverId/auto-pull-emp-app', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;

    // Validate driver exists and OE access
    const driverRes = await query(
      'SELECT id, first_name, last_name, operating_entity_id FROM drivers WHERE id = $1',
      [driverId]
    );
    if (driverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    const driver = driverRes.rows[0];
    if (req.context?.operatingEntityId && driver.operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    // 1. Check if there's already an employment_application_signed document
    const existingDocRes = await query(
      `SELECT id
       FROM driver_documents
       WHERE driver_id = $1
         AND doc_type = 'employment_application_signed'
       ORDER BY created_at DESC
       LIMIT 1`,
      [driverId]
    );

    if (existingDocRes.rows.length > 0) {
      const existingDoc = existingDocRes.rows[0];
      await upsertRequirementStatus(driverId, 'employment_application_submitted', 'complete', existingDoc.id);
      await computeAndUpdateDqfCompleteness(driverId);

      const userId = req.user?.id || null;
      await logStatusChange(driverId, 'employment_application_submitted', 'missing', 'complete', userId, 'Auto-pulled existing employment application document');

      const duration = Date.now() - start;
      dtLogger.trackRequest('POST', `/api/dqf/driver/${driverId}/auto-pull-emp-app`, 200, duration);

      return res.json({ success: true, documentId: existingDoc.id, source: 'existing' });
    }

    // 2. No document exists -- check for a completed onboarding section with employment app data
    const sectionRes = await query(
      `SELECT dos.data, dos.packet_id
       FROM driver_onboarding_sections dos
       JOIN driver_onboarding_packets dop ON dop.id = dos.packet_id
       WHERE dop.driver_id = $1
         AND dos.section_key = 'employment_application'
         AND dos.status = 'completed'
       ORDER BY dos.completed_at DESC
       LIMIT 1`,
      [driverId]
    );

    if (sectionRes.rows.length === 0) {
      return res.status(404).json({ error: 'No employment application found for this driver' });
    }

    const section = sectionRes.rows[0];
    const applicationData = section.data || {};

    // Load operating entity for company info on PDF header
    let operatingEntity = null;
    if (driver.operating_entity_id) {
      const oeRes = await query(
        `SELECT name, legal_name, address_line1, address_line2, city, state, zip_code, phone, email FROM operating_entities WHERE id = $1`,
        [driver.operating_entity_id]
      );
      if (oeRes.rows.length > 0) {
        const oe = oeRes.rows[0];
        operatingEntity = {
          name: oe.name || oe.legal_name || '',
          address: [oe.address_line1, oe.address_line2, oe.city, oe.state, oe.zip_code].filter(Boolean).join(', '),
          phone: oe.phone || '',
          email: oe.email || ''
        };
      }
    }

    // 3. Generate the PDF using the professional generator from pdf.service.js
    // Transform section data into the fullApp format expected by generateEmploymentApplicationPdf
    const fullApp = {
      id: section.packet_id,
      applicant_snapshot: applicationData,
      employers: applicationData.employers || [],
      residencies: applicationData.residencies || [],
      licenses: applicationData.licenses || [],
      accidents: applicationData.accidents || [],
      violations: applicationData.violations || [],
      convictions: applicationData.convictions || [],
      signed_certification_at: applicationData.signatureDate || applicationData.submittedAt
    };
    const pdfContext = {};
    if (operatingEntity) pdfContext.operatingEntity = operatingEntity;
    if (applicationData.auditTrail) pdfContext.auditTrail = applicationData.auditTrail;

    const buffer = await generateEmploymentApplicationPdf(fullApp, pdfContext);

    const firstName = (driver.first_name || '').trim();
    const lastName = (driver.last_name || '').trim();
    const dateStr = new Date().toISOString().slice(0, 10);
    const pdfFileName = firstName || lastName
      ? `employment_application_${firstName}_${lastName}_${dateStr}.pdf`.replace(/\s+/g, '_')
      : `employment_application_${driver.id}_${dateStr}.pdf`;

    const empDoc = await createDriverDocument({
      driverId: driver.id,
      packetId: section.packet_id,
      docType: 'employment_application_signed',
      fileName: pdfFileName,
      mimeType: 'application/pdf',
      bytes: buffer,
      folder: 'employment-application'
    });

    // 4. Mark DQF requirement complete
    await upsertRequirementStatus(driverId, 'employment_application_submitted', 'complete', empDoc.id);
    await computeAndUpdateDqfCompleteness(driverId);

    const userId = req.user?.id || null;
    await logStatusChange(driverId, 'employment_application_submitted', 'missing', 'complete', userId, 'Auto-generated employment application document from onboarding data');

    dtLogger.info('dqf_auto_pull_emp_app_generated', { driverId, documentId: empDoc.id });

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/dqf/driver/${driverId}/auto-pull-emp-app`, 200, duration);

    return res.json({ success: true, documentId: empDoc.id, source: 'generated' });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('dqf_auto_pull_emp_app_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('POST', `/api/dqf/driver/${req.params.driverId}/auto-pull-emp-app`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error in POST /api/dqf/driver/:driverId/auto-pull-emp-app', error);
    return res.status(500).json({ message: 'Failed to auto-pull employment application' });
  }
});

// FN-240: POST /api/dqf/driver/:driverId/requirement/:requirementKey/upload
// Upload a document file for any DQF requirement and mark it complete.
/**
 * @openapi
 * /api/dqf/driver/{driverId}/requirement/{requirementKey}/upload:
 *   post:
 *     summary: Upload a document for a DQF requirement
 *     description: >
 *       Uploads a document file for any DQF requirement and marks that requirement
 *       as complete. Stores the file via R2, logs the status change, and
 *       recomputes DQF completeness. Accepts PDF and image files (max 10 MB).
 *       Per 49 CFR Part 391 — Qualifications of Drivers and Longer Combination
 *       Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver's unique identifier
 *       - in: path
 *         name: requirementKey
 *         required: true
 *         schema:
 *           type: string
 *         description: The DQF requirement key to fulfill
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The document file (max 10 MB, PDF or image)
 *     responses:
 *       200:
 *         description: Document uploaded and requirement marked complete
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 documentId:
 *                   type: string
 *                   format: uuid
 *                 requirementKey:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [complete]
 *       400:
 *         description: Missing file or unknown requirement key
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
router.post('/driver/:driverId/requirement/:requirementKey/upload', upload.single('file'), async (req, res) => {
  const start = Date.now();
  try {
    const { driverId, requirementKey } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: 'file is required' });
    }

    // Validate driver exists and OE access
    const driverRes = await query(
      'SELECT id, first_name, last_name, operating_entity_id FROM drivers WHERE id = $1',
      [driverId]
    );
    if (driverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    const driver = driverRes.rows[0];
    if (req.context?.operatingEntityId && driver.operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    // Validate that the requirement key exists
    const reqRes = await query(
      'SELECT key FROM dqf_requirements WHERE key = $1',
      [requirementKey]
    );
    if (reqRes.rows.length === 0) {
      return res.status(400).json({ message: `Unknown requirement key: ${requirementKey}` });
    }

    // Store the document
    const doc = await createDriverDocument({
      driverId: driver.id,
      packetId: null,
      docType: `dqf_upload_${requirementKey}`,
      fileName: req.file.originalname || 'upload.pdf',
      mimeType: req.file.mimetype || 'application/pdf',
      bytes: req.file.buffer,
      folder: 'dqf-documents'
    });

    // Get current status for audit log
    const currentRes = await query(
      'SELECT status FROM dqf_driver_status WHERE driver_id = $1 AND requirement_key = $2',
      [driverId, requirementKey]
    );
    const oldStatus = currentRes.rows.length > 0 ? currentRes.rows[0].status : 'missing';

    // Mark requirement complete with evidence
    await upsertRequirementStatus(driverId, requirementKey, 'complete', doc.id);
    await computeAndUpdateDqfCompleteness(driverId);

    const userId = req.user?.id || null;
    await logStatusChange(driverId, requirementKey, oldStatus, 'complete', userId, 'Document uploaded manually');

    dtLogger.info('dqf_requirement_document_uploaded', {
      driverId,
      requirementKey,
      documentId: doc.id,
      fileName: req.file.originalname
    });

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/dqf/driver/${driverId}/requirement/${requirementKey}/upload`, 200, duration);

    return res.json({
      success: true,
      documentId: doc.id,
      requirementKey,
      status: 'complete'
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('dqf_requirement_upload_failed', error, {
      driverId: req.params.driverId,
      requirementKey: req.params.requirementKey
    });
    dtLogger.trackRequest('POST', `/api/dqf/driver/${req.params.driverId}/requirement/${req.params.requirementKey}/upload`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error in POST /api/dqf/driver/:driverId/requirement/:requirementKey/upload', error);
    return res.status(500).json({ message: 'Failed to upload document' });
  }
});

// FN-264: POST /api/dqf/driver/:driverId/mvr-upload
// Upload an MVR PDF, extract data via AI, store report and document.
/**
 * @openapi
 * /api/dqf/driver/{driverId}/mvr-upload:
 *   post:
 *     summary: Upload an MVR (Motor Vehicle Record) PDF
 *     description: >
 *       Uploads an MVR PDF, extracts data via AI (license info, violations,
 *       accidents, endorsements, restrictions), stores the document, creates a
 *       driver_mvr_reports record, and auto-completes the mvr_data_received and
 *       mvr_report_document DQF requirements. Only PDF files are accepted.
 *       Per 49 CFR Part 391 — Qualifications of Drivers and Longer Combination
 *       Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver's unique identifier
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: MVR report PDF file (max 10 MB, PDF only)
 *     responses:
 *       200:
 *         description: MVR report uploaded and data extracted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 documentId:
 *                   type: string
 *                   format: uuid
 *                 mvrReportId:
 *                   type: string
 *                   format: uuid
 *                 extractedData:
 *                   type: object
 *                   properties:
 *                     licenseNumber:
 *                       type: string
 *                     licenseState:
 *                       type: string
 *                     licenseStatus:
 *                       type: string
 *                     licenseClass:
 *                       type: string
 *                     licenseExpiry:
 *                       type: string
 *                       format: date
 *                     endorsements:
 *                       type: string
 *                     restrictions:
 *                       type: string
 *                     violations:
 *                       type: array
 *                       items:
 *                         type: object
 *                     accidents:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pointsTotal:
 *                       type: integer
 *                     extractionMethod:
 *                       type: string
 *                 warning:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Missing file or non-PDF file uploaded
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
router.post('/driver/:driverId/mvr-upload', upload.single('file'), async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: 'file is required' });
    }

    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ message: 'Only PDF files are accepted for MVR uploads' });
    }

    // Validate driver exists and OE access
    const driverRes = await query(
      'SELECT id, first_name, last_name, operating_entity_id, tenant_id FROM drivers WHERE id = $1',
      [driverId]
    );
    if (driverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    const driver = driverRes.rows[0];
    if (req.context?.operatingEntityId && driver.operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    // 1. Extract text from PDF
    let pdfText = '';
    try {
      const parsed = await pdfParse(req.file.buffer);
      pdfText = (parsed.text || '').trim();
    } catch (parseErr) {
      dtLogger.warn('mvr_upload_pdf_parse_failed', { driverId, error: parseErr.message });
      // Continue with empty text -- extraction service will return manual fallback
    }

    // 2. Call AI extraction service
    const extractedData = await extractMvrData(pdfText);

    // 3. Store the PDF file as a driver document
    const firstName = (driver.first_name || '').trim();
    const lastName = (driver.last_name || '').trim();
    const dateStr = new Date().toISOString().slice(0, 10);
    const pdfFileName = firstName || lastName
      ? `mvr_report_${firstName}_${lastName}_${dateStr}.pdf`.replace(/\s+/g, '_')
      : `mvr_report_${driver.id}_${dateStr}.pdf`;

    const doc = await createDriverDocument({
      driverId: driver.id,
      packetId: null,
      docType: 'mvr_report',
      fileName: pdfFileName,
      mimeType: 'application/pdf',
      bytes: req.file.buffer,
      folder: 'mvr-reports'
    });

    // 4. Insert into driver_mvr_reports table
    const userId = req.user?.id || null;
    const mvrResult = await query(
      `INSERT INTO driver_mvr_reports (
        driver_id,
        document_id,
        tenant_id,
        report_date,
        report_source,
        license_number,
        license_state,
        license_status,
        license_class,
        license_expiry,
        endorsements,
        restrictions,
        violations,
        accidents,
        points_total,
        raw_text,
        extraction_method,
        extracted_at,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), $18)
      RETURNING *`,
      [
        driver.id,
        doc.id,
        driver.tenant_id || null,
        extractedData.reportDate || dateStr,
        'manual_upload',
        extractedData.licenseNumber,
        extractedData.licenseState,
        extractedData.licenseStatus,
        extractedData.licenseClass,
        extractedData.licenseExpiry,
        extractedData.endorsements,
        extractedData.restrictions,
        JSON.stringify(extractedData.violations || []),
        JSON.stringify(extractedData.accidents || []),
        extractedData.pointsTotal || 0,
        pdfText.slice(0, 50000) || null, // Store first 50K chars for reference
        extractedData.extractionMethod || 'ai',
        userId
      ]
    );

    // 5. Auto-complete mvr_data_received (checklist) and mvr_report_document (Pre-Hire Documents)
    const currentRes = await query(
      'SELECT status FROM dqf_driver_status WHERE driver_id = $1 AND requirement_key = $2',
      [driverId, 'mvr_data_received']
    );
    const oldStatus = currentRes.rows.length > 0 ? currentRes.rows[0].status : 'missing';

    await upsertRequirementStatus(driverId, 'mvr_data_received', 'complete', doc.id);
    await upsertRequirementStatus(driverId, 'mvr_report_document', 'complete', doc.id);
    await computeAndUpdateDqfCompleteness(driverId);
    await logStatusChange(driverId, 'mvr_data_received', oldStatus, 'complete', userId, 'MVR report uploaded and data extracted');
    await logStatusChange(driverId, 'mvr_report_document', 'missing', 'complete', userId, 'MVR report document uploaded');

    dtLogger.info('mvr_upload_complete', {
      driverId,
      documentId: doc.id,
      mvrReportId: mvrResult.rows[0]?.id,
      violationCount: (extractedData.violations || []).length,
      accidentCount: (extractedData.accidents || []).length,
      extractionMethod: extractedData.extractionMethod
    });

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/dqf/driver/${driverId}/mvr-upload`, 200, duration);

    return res.json({
      success: true,
      documentId: doc.id,
      mvrReportId: mvrResult.rows[0]?.id,
      extractedData,
      warning: extractedData.warning || null
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('mvr_upload_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('POST', `/api/dqf/driver/${req.params.driverId}/mvr-upload`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error in POST /api/dqf/driver/:driverId/mvr-upload', error);
    return res.status(500).json({ message: 'Failed to upload MVR report' });
  }
});

// FN-264: GET /api/dqf/driver/:driverId/mvr-data
// Return all MVR reports for a driver, ordered by report_date DESC.
/**
 * @openapi
 * /api/dqf/driver/{driverId}/mvr-data:
 *   get:
 *     summary: Get all MVR reports for a driver
 *     description: >
 *       Returns all Motor Vehicle Record reports for a driver including license
 *       info, violations, accidents, points, and extraction metadata. Ordered by
 *       report_date descending. Gracefully returns an empty array if the
 *       driver_mvr_reports table does not yet exist. Per 49 CFR Part 391 —
 *       Qualifications of Drivers and Longer Combination Vehicles.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The driver's unique identifier
 *     responses:
 *       200:
 *         description: MVR reports for the driver
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 driverId:
 *                   type: string
 *                   format: uuid
 *                 reports:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       driver_id:
 *                         type: string
 *                         format: uuid
 *                       document_id:
 *                         type: string
 *                         format: uuid
 *                       report_date:
 *                         type: string
 *                         format: date
 *                       report_source:
 *                         type: string
 *                       license_number:
 *                         type: string
 *                       license_state:
 *                         type: string
 *                       license_status:
 *                         type: string
 *                       license_class:
 *                         type: string
 *                       license_expiry:
 *                         type: string
 *                         format: date
 *                       endorsements:
 *                         type: string
 *                       restrictions:
 *                         type: string
 *                       violations:
 *                         type: array
 *                         items:
 *                           type: object
 *                       accidents:
 *                         type: array
 *                         items:
 *                           type: object
 *                       points_total:
 *                         type: integer
 *                       extraction_method:
 *                         type: string
 *                       violation_count:
 *                         type: integer
 *                       accident_count:
 *                         type: integer
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
router.get('/driver/:driverId/mvr-data', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;

    // Validate driver exists and OE access
    const driverRes = await query(
      'SELECT id, operating_entity_id FROM drivers WHERE id = $1',
      [driverId]
    );
    if (driverRes.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    if (req.context?.operatingEntityId && driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    // Check if table exists (graceful fallback before migration runs)
    const tableCheck = await query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'driver_mvr_reports') AS exists`
    );
    if (!tableCheck.rows[0]?.exists) {
      return res.json({ driverId, reports: [] });
    }

    const result = await query(
      `SELECT
         id,
         driver_id,
         document_id,
         report_date,
         report_source,
         license_number,
         license_state,
         license_status,
         license_class,
         license_expiry,
         endorsements,
         restrictions,
         violations,
         accidents,
         points_total,
         extraction_method,
         extracted_at,
         created_at,
         jsonb_array_length(COALESCE(violations, '[]'::jsonb)) AS violation_count,
         jsonb_array_length(COALESCE(accidents, '[]'::jsonb)) AS accident_count
       FROM driver_mvr_reports
       WHERE driver_id = $1
       ORDER BY report_date DESC, created_at DESC`,
      [driverId]
    );

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/dqf/driver/${driverId}/mvr-data`, 200, duration, {
      driverId,
      count: result.rows.length
    });

    return res.json({
      driverId,
      reports: result.rows
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('mvr_data_fetch_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('GET', `/api/dqf/driver/${req.params.driverId}/mvr-data`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error in GET /api/dqf/driver/:driverId/mvr-data', error);
    return res.status(500).json({ message: 'Failed to load MVR data' });
  }
});

module.exports = router;

