const express = require('express');
const router = express.Router();
const auth = require('./auth-middleware');
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const { upsertRequirementStatus, computeAndUpdateDqfCompleteness, logStatusChange } = require('../services/dqf-service');

// Admin / safety only
router.use(auth(['admin', 'safety']));

// GET /api/dqf - list DQF documents scoped through drivers
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

// GET /api/dqf/drivers/:driverId
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
         COALESCE(s.status, 'missing') AS status,
         s.evidence_document_id,
         s.last_updated_at
       FROM dqf_requirements r
       LEFT JOIN dqf_driver_status s
         ON s.requirement_key = r.key
        AND s.driver_id = $1
       ORDER BY r.key`,
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

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/dqf/drivers/${driverId}`, 200, duration, {
      driverId
    });

    return res.json({
      driver: driverRes.rows[0],
      dqf: {
        requirements: requirementsRes.rows,
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
router.get('/documents/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT d.file_name,
              d.mime_type,
              d.storage_key,
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

    // Fallback: if join returned no bytes, try fetching blob by storage_key (e.g. older rows)
    if (!bytes && docRow.storage_key) {
      const blobRes = await query(
        `SELECT bytes FROM driver_document_blobs WHERE id::text = $1 OR id = $2::uuid`,
        [docRow.storage_key, docRow.storage_key]
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
    const buffer = bytes;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(buffer);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error downloading driver document:', error);
    return res.status(500).json({ message: 'Failed to download document' });
  }
});

// POST /api/dqf/requirement/:driverId/:requirementKey - Update a requirement status manually
router.post('/requirement/:driverId/:requirementKey', async (req, res) => {
  try {
    const { driverId, requirementKey } = req.params;
    const { status, evidenceDocumentId, note } = req.body;

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

    // Update the requirement
    await upsertRequirementStatus(driverId, requirementKey, status, evidenceDocumentId || null);

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

// GET /api/dqf/requirement/:driverId/:requirementKey/changes - Get change history for a requirement
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

module.exports = router;

