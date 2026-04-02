const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { query } = require('../internal/db');
const { uploadBuffer, getSignedDownloadUrl, deleteObject } = require('../storage/r2-storage');
const { extractPspData } = require('../services/psp-extraction-service');
const { upsertRequirementStatus } = require('../services/dqf-service');
const knex = require('../config/knex');
const { matchInspection, createRiskEvent } = require('../services/fmcsa-matching-service');
const dtLogger = require('../utils/logger');

// GET /api/dqf-documents - list all DQF docs scoped through drivers
/**
 * @openapi
 * /api/dqf-documents:
 *   get:
 *     summary: List all DQF documents
 *     description: >
 *       Retrieves all Driver Qualification File documents scoped through the
 *       caller's tenant and operating entity. Includes signed download URLs for
 *       each document. Per 49 CFR Part 391.51 — Driver Qualification File
 *       retention requirements.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of DQF documents with signed download URLs
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
 *                   document_type:
 *                     type: string
 *                   file_name:
 *                     type: string
 *                   file_path:
 *                     type: string
 *                   file_size:
 *                     type: integer
 *                   mime_type:
 *                     type: string
 *                   first_name:
 *                     type: string
 *                   last_name:
 *                     type: string
 *                   operating_entity_id:
 *                     type: string
 *                     format: uuid
 *                   downloadUrl:
 *                     type: string
 *                     nullable: true
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
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

    const data = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,
        downloadUrl: row.file_path ? await getSignedDownloadUrl(row.file_path) : null
      }))
    );

    return res.json(data);
  } catch (error) {
    console.error('Error listing DQF documents:', error);
    return res.status(500).json({ message: 'Failed to list documents' });
  }
});

// Configure multer for file uploads (memory storage for R2)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common image formats (ID documents), PDFs, and Word docs
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, images (JPEG, PNG, GIF, WebP), and Word documents are allowed!'));
    }
  }
});

// POST upload DQF document
// Supported documentTypes:
// - driver_license_front, driver_license_back
// - medical_card_front, medical_card_back, green_card
// - drug_test_result
// - release_of_info
// - employment_application, mvr_authorization, etc.
/**
 * @openapi
 * /api/dqf-documents/upload:
 *   post:
 *     summary: Upload a DQF document
 *     description: >
 *       Uploads a document file to the Driver Qualification File. Stores the file
 *       in R2 cloud storage and saves metadata to the database. Supported document
 *       types include driver_license_front, driver_license_back, medical_card_front,
 *       medical_card_back, green_card, drug_test_result, release_of_info,
 *       employment_application, mvr_authorization, psp_report, and more. PSP
 *       reports trigger background AI extraction and risk event creation. Per 49 CFR
 *       Part 391.51 — Driver Qualification File retention requirements.
 *     tags:
 *       - DQF
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - driverId
 *               - documentType
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: >
 *                   The document file (max 10 MB). Allowed types: PDF, JPEG, PNG,
 *                   GIF, WebP, DOC, DOCX.
 *               driverId:
 *                 type: string
 *                 format: uuid
 *                 description: The driver's unique identifier
 *               documentType:
 *                 type: string
 *                 description: The DQF document type classification
 *               uploadedBy:
 *                 type: string
 *                 description: User or system that uploaded the file (defaults to 'system')
 *     responses:
 *       201:
 *         description: Document uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 document:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     driver_id:
 *                       type: string
 *                       format: uuid
 *                     document_type:
 *                       type: string
 *                     file_name:
 *                       type: string
 *                     file_path:
 *                       type: string
 *                     file_size:
 *                       type: integer
 *                     mime_type:
 *                       type: string
 *                 downloadUrl:
 *                   type: string
 *       400:
 *         description: Missing file, driverId, or documentType
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { driverId, documentType, uploadedBy } = req.body;

    if (!driverId || !documentType) {
      return res.status(400).json({ message: 'Driver ID and document type are required' });
    }

    // Validate driver belongs to active OE
    if (req.context?.operatingEntityId) {
      const driverRes = await query('SELECT operating_entity_id FROM drivers WHERE id = $1', [driverId]);
      if (driverRes.rows.length === 0 || driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
        return res.status(404).json({ message: 'Driver not found' });
      }
    }

    const fileExt = path.extname(req.file.originalname || '').toLowerCase();
    const safeName = req.file.originalname
      ? req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_')
      : `dqf-${driverId}${fileExt}`;
    const { key: storageKey } = await uploadBuffer({
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      prefix: `drivers/${driverId}/dqf-documents`,
      fileName: safeName
    });

    // Save file metadata to database
    const result = await query(
      `INSERT INTO dqf_documents (driver_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        driverId,
        documentType,
        req.file.originalname,
        storageKey,
        req.file.size,
        req.file.mimetype,
        uploadedBy || 'system'
      ]
    );

    const doc = result.rows[0];

    // Trigger background PSP analysis after successful upload
    if (documentType === 'psp_report') {
      const tenantId = req.context?.tenantId || null;
      processPspReport(driverId, doc.id, req.file.buffer, req.file.mimetype, tenantId).catch((err) => {
        dtLogger.error('psp_background_processing_error', err, { driverId, docId: doc.id });
      });
    }

    res.status(201).json({
      message: 'File uploaded successfully',
      document: doc,
      downloadUrl: await getSignedDownloadUrl(storageKey)
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ message: 'Failed to upload file' });
  }
});

// ─── PSP Background Processing ───────────────────────────────────────────────

/**
 * FN-478: Background PSP report analysis pipeline.
 * 1. Extract inspections + crashes from the PSP report via Claude Vision.
 * 2. Import extracted inspections into fmcsa_inspection_history (source='psp_upload').
 * 3. Auto-match each inspection to fleet vehicles/drivers.
 * 4. Create driver_risk_events for matched inspections.
 * 5. Create a pre_hire_assessment risk event if both MVR and PSP are present.
 * 6. Mark the psp_report DQF requirement as complete.
 *
 * @param {string} driverId
 * @param {string} docId - DQF document record ID
 * @param {Buffer} fileBuffer
 * @param {string} mimeType
 * @param {string|null} tenantId
 */
async function processPspReport(driverId, docId, fileBuffer, mimeType, tenantId) {
  dtLogger.info('psp_processing_start', { driverId, docId });

  // 1. AI extraction
  const extracted = await extractPspData(fileBuffer, mimeType);

  dtLogger.info('psp_processing_extracted', {
    driverId,
    inspectionCount: extracted.inspections.length,
    crashCount: extracted.crashes.length,
    confidence: extracted.confidence,
    method: extracted.extractionMethod
  });

  // 2. Import inspections into fmcsa_inspection_history
  let ingested = 0;
  let duplicates = 0;
  let matched = 0;

  for (const insp of extracted.inspections) {
    const reportNumber = (insp.report_number || '').toString().trim();

    // Dedup by driver_id + report_number (PSP uploads don't have carrier_id)
    if (reportNumber) {
      const existing = await knex('fmcsa_inspection_history')
        .whereNull('carrier_id')
        .where({ report_number: reportNumber })
        .first('id');
      if (existing) { duplicates++; continue; }
    }

    const [row] = await knex('fmcsa_inspection_history').insert({
      carrier_id: null,
      inspection_date: insp.inspection_date || null,
      report_number: reportNumber || null,
      report_state: insp.state || null,
      driver_name: extracted.driver_name || null,
      driver_license_number: extracted.driver_license || null,
      driver_license_state: extracted.driver_license_state || null,
      driver_oos: insp.driver_oos || false,
      vehicle_oos: insp.vehicle_oos || false,
      hazmat_oos: insp.hazmat || false,
      violations: JSON.stringify(insp.violations || []),
      vehicles: JSON.stringify([]),
      matched_driver_id: driverId,
      match_status: 'manual',
      match_method: 'psp_upload',
      match_confidence: extracted.confidence,
      matched_at: new Date()
    }).returning('*');

    ingested++;

    // 3. Create risk event for this matched inspection
    if (tenantId) {
      await createRiskEvent(tenantId, row, {
        driverId,
        vehicleId: null,
        method: 'psp_upload',
        confidence: extracted.confidence
      });
      matched++;
    }
  }

  dtLogger.info('psp_processing_ingested', { driverId, ingested, duplicates, matched });

  // 4. Check for pre_hire_assessment — create if both MVR and PSP present
  if (tenantId && ingested > 0) {
    await createPreHireAssessmentIfReady(tenantId, driverId, docId, extracted);
  }

  // 5. Mark psp_report DQF requirement as complete
  try {
    await upsertRequirementStatus(driverId, 'psp_report_document', 'complete', docId, new Date());
  } catch (err) {
    // Requirement key may not exist in all tenant configurations — non-fatal
    dtLogger.warn('psp_requirement_upsert_failed', { driverId, error: err.message });
  }

  dtLogger.info('psp_processing_complete', { driverId, docId, ingested });
}

/**
 * Create a pre_hire_assessment driver_risk_event if the driver now has both
 * an MVR report and a PSP report uploaded.
 */
async function createPreHireAssessmentIfReady(tenantId, driverId, docId, pspData) {
  try {
    // Check if MVR is also on file
    const mvrDoc = await knex('dqf_documents')
      .where({ driver_id: driverId, document_type: 'mvr_report' })
      .orderBy('created_at', 'desc')
      .first('id');

    if (!mvrDoc) return; // MVR not yet uploaded — skip

    // Dedup: don't create more than one pre_hire_assessment per driver
    const existing = await knex('driver_risk_events')
      .where({ driver_id: driverId, event_type: 'pre_hire_assessment', event_source: 'psp_upload' })
      .first('id');
    if (existing) return;

    const inspCount = pspData.inspections.length;
    const oosCount = pspData.inspections.filter((i) => i.driver_oos || i.vehicle_oos).length;
    const crashCount = pspData.crashes.length;
    const severity = (oosCount > 0 || crashCount > 0) ? 'high' : inspCount > 5 ? 'medium' : 'low';
    const severityWeight = oosCount * 10 + crashCount * 8 + inspCount;

    await knex('driver_risk_events').insert({
      tenant_id: tenantId,
      driver_id: driverId,
      event_type: 'pre_hire_assessment',
      event_source: 'psp_upload',
      source_id: docId,
      event_date: new Date(),
      description: `Pre-hire assessment: ${inspCount} PSP inspection(s), ${crashCount} crash(es), ${oosCount} OOS incident(s)`,
      severity,
      severity_weight: severityWeight,
      oos_flag: oosCount > 0,
      violation_count: pspData.inspections.reduce((sum, i) => sum + (i.violations?.length || 0), 0),
      details: JSON.stringify({
        inspection_count: inspCount,
        crash_count: crashCount,
        oos_count: oosCount,
        confidence: pspData.confidence,
        report_date: pspData.report_date
      }),
      match_method: 'psp_upload',
      match_confidence: pspData.confidence
    });

    dtLogger.info('psp_pre_hire_assessment_created', { tenantId, driverId });
  } catch (err) {
    dtLogger.error('psp_pre_hire_assessment_error', err, { driverId });
  }
}

// GET all documents for a driver
/**
 * @openapi
 * /api/dqf-documents/driver/{driverId}:
 *   get:
 *     summary: Get all DQF documents for a driver
 *     description: >
 *       Retrieves all Driver Qualification File documents for a specific driver,
 *       including signed download URLs. Per 49 CFR Part 391.51 — Driver
 *       Qualification File retention requirements.
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
 *         description: Array of DQF documents with signed download URLs
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
 *                   document_type:
 *                     type: string
 *                   file_name:
 *                     type: string
 *                   downloadUrl:
 *                     type: string
 *                     nullable: true
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
router.get('/driver/:driverId', async (req, res) => {
  try {
    // Validate OE access
    if (req.context?.operatingEntityId) {
      const driverRes = await query('SELECT operating_entity_id FROM drivers WHERE id = $1', [req.params.driverId]);
      if (driverRes.rows.length === 0 || driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
        return res.status(404).json({ message: 'Driver not found' });
      }
    }

    const result = await query(
      `SELECT * FROM dqf_documents WHERE driver_id = $1 ORDER BY created_at DESC`,
      [req.params.driverId]
    );
    const data = await Promise.all(
      result.rows.map(async row => ({
        ...row,
        downloadUrl: row.file_path ? await getSignedDownloadUrl(row.file_path) : null
      }))
    );
    res.json(data);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ message: 'Failed to fetch documents' });
  }
});

// GET documents by type for a driver
/**
 * @openapi
 * /api/dqf-documents/driver/{driverId}/type/{documentType}:
 *   get:
 *     summary: Get DQF documents by type for a driver
 *     description: >
 *       Retrieves DQF documents of a specific type for a given driver, including
 *       signed download URLs. Per 49 CFR Part 391.51 — Driver Qualification File
 *       retention requirements.
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
 *         name: documentType
 *         required: true
 *         schema:
 *           type: string
 *         description: The document type to filter by (e.g. driver_license_front, medical_card_front)
 *     responses:
 *       200:
 *         description: Array of DQF documents of the specified type
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
 *                   document_type:
 *                     type: string
 *                   file_name:
 *                     type: string
 *                   downloadUrl:
 *                     type: string
 *                     nullable: true
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
router.get('/driver/:driverId/type/:documentType', async (req, res) => {
  try {
    // Validate OE access
    if (req.context?.operatingEntityId) {
      const driverRes = await query('SELECT operating_entity_id FROM drivers WHERE id = $1', [req.params.driverId]);
      if (driverRes.rows.length === 0 || driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
        return res.status(404).json({ message: 'Driver not found' });
      }
    }

    const result = await query(
      `SELECT * FROM dqf_documents 
       WHERE driver_id = $1 AND document_type = $2 
       ORDER BY created_at DESC`,
      [req.params.driverId, req.params.documentType]
    );
    const data = await Promise.all(
      result.rows.map(async row => ({
        ...row,
        downloadUrl: row.file_path ? await getSignedDownloadUrl(row.file_path) : null
      }))
    );
    res.json(data);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ message: 'Failed to fetch documents' });
  }
});

// DELETE a document
/**
 * @openapi
 * /api/dqf-documents/{id}:
 *   delete:
 *     summary: Delete a DQF document
 *     description: >
 *       Deletes a DQF document from both R2 cloud storage and the database.
 *       Validates operating entity access through the parent driver. Per 49 CFR
 *       Part 391.51 — Driver Qualification File retention requirements.
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
 *         description: The DQF document ID
 *     responses:
 *       200:
 *         description: Document deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Document or driver not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM dqf_documents WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const document = result.rows[0];

    // Validate OE access through driver
    if (req.context?.operatingEntityId) {
      const driverRes = await query('SELECT operating_entity_id FROM drivers WHERE id = $1', [document.driver_id]);
      if (driverRes.rows.length === 0) {
        return res.status(404).json({ message: 'Driver not found' });
      }
      if (driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
        return res.status(404).json({ message: 'Document not found' });
      }
    }

    await deleteObject(document.file_path);

    // Delete from database
    await query('DELETE FROM dqf_documents WHERE id = $1', [req.params.id]);

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ message: 'Failed to delete document' });
  }
});

// GET download a document
/**
 * @openapi
 * /api/dqf-documents/download/{id}:
 *   get:
 *     summary: Get a signed download URL for a DQF document
 *     description: >
 *       Returns a time-limited signed download URL for a specific DQF document.
 *       Validates operating entity access through the parent driver. Per 49 CFR
 *       Part 391.51 — Driver Qualification File retention requirements.
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
 *         description: The DQF document ID
 *     responses:
 *       200:
 *         description: Signed download URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 downloadUrl:
 *                   type: string
 *                   format: uri
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.get('/download/:id', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM dqf_documents WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const document = result.rows[0];

    // Validate OE access through driver
    if (req.context?.operatingEntityId) {
      const driverRes = await query('SELECT operating_entity_id FROM drivers WHERE id = $1', [document.driver_id]);
      if (driverRes.rows.length === 0 || driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
        return res.status(404).json({ message: 'Document not found' });
      }
    }

    const downloadUrl = await getSignedDownloadUrl(document.file_path);
    res.json({ downloadUrl });
  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({ message: 'Failed to download document' });
  }
});

module.exports = router;
