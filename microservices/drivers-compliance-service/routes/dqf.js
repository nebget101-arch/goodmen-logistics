const express = require('express');
const router = express.Router();
const auth = require('./auth-middleware');
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');

// Admin / safety only
router.use(auth(['admin', 'safety']));

// GET /api/dqf/drivers/:driverId
router.get('/drivers/:driverId', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;

    const driverRes = await query(
      `SELECT
         id,
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

module.exports = router;
