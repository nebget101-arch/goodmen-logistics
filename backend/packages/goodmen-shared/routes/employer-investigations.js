const express = require('express');
const router = express.Router();
const auth = require('./auth-middleware');
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const {
  initiateInvestigation,
  sendInquiry,
  sendFollowUp,
  recordResponse,
  documentNoResponse,
  getInvestigationStatus,
  getOverdueInvestigations,
  getHistoryFile
} = require('../services/employer-investigation-service');

// Admin / safety only
router.use(auth(['admin', 'safety']));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a driver belongs to the caller's operating entity.
 * Returns the driver row or null if not found / not authorized.
 */
async function validateDriverAccess(driverId, req) {
  const res = await query(
    'SELECT id, operating_entity_id FROM drivers WHERE id = $1',
    [driverId]
  );
  if (res.rows.length === 0) return null;
  const driver = res.rows[0];
  if (req.context?.operatingEntityId && driver.operating_entity_id !== req.context.operatingEntityId) {
    return null;
  }
  return driver;
}

/**
 * Validate that a past employer belongs to a driver within the caller's OE.
 * Returns the employer row (with driver_id) or null.
 */
async function validatePastEmployerAccess(pastEmployerId, req) {
  const res = await query(
    `SELECT pe.id, pe.driver_id, pe.employer_name, d.operating_entity_id
       FROM driver_past_employers pe
       JOIN drivers d ON d.id = pe.driver_id
      WHERE pe.id = $1`,
    [pastEmployerId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  if (req.context?.operatingEntityId && row.operating_entity_id !== req.context.operatingEntityId) {
    return null;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/employer-investigations/overdue:
 *   get:
 *     summary: List overdue employer investigations
 *     description: Retrieves employer investigations that are past their response deadline. Per 49 CFR 391.23 — Investigation and inquiries into driving record.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of overdue investigation records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Tenant context is required
 *       500:
 *         description: Server error
 */
// GET /api/employer-investigations/overdue
router.get('/overdue', async (req, res) => {
  const start = Date.now();
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ message: 'Tenant context is required' });
    }

    const result = await getOverdueInvestigations(tenantId);

    // Filter by OE if set
    const filtered = req.context?.operatingEntityId
      ? result.filter((r) => r.operatingEntityId === req.context.operatingEntityId)
      : result;

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', '/api/employer-investigations/overdue', 200, duration, {
      count: filtered.length
    });

    return res.json(filtered);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('employer_investigation_overdue_failed', error);
    dtLogger.trackRequest('GET', '/api/employer-investigations/overdue', 500, duration);
    return res.status(500).json({ message: 'Failed to fetch overdue investigations' });
  }
});

/**
 * @openapi
 * /api/employer-investigations/driver/{driverId}:
 *   get:
 *     summary: Get investigation status for a driver
 *     description: Retrieves the current employer investigation status for a specific driver. Per 49 CFR 391.23 — Investigation and inquiries into driving record.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *         description: The driver ID
 *     responses:
 *       200:
 *         description: Investigation status for the driver
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
// GET /api/employer-investigations/driver/:driverId
router.get('/driver/:driverId', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;
    const driver = await validateDriverAccess(driverId, req);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const result = await getInvestigationStatus(driverId);
    if (!result) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/employer-investigations/driver/${driverId}`, 200, duration);

    return res.json(result);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('employer_investigation_status_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('GET', `/api/employer-investigations/driver/${req.params.driverId}`, 500, duration);
    return res.status(500).json({ message: 'Failed to fetch investigation status' });
  }
});

/**
 * @openapi
 * /api/employer-investigations/driver/{driverId}/initiate:
 *   post:
 *     summary: Initiate employer investigation for a driver
 *     description: Begins the previous employer investigation process for a driver. Requires driver hire_date to be set. Per 49 CFR 391.23 — Investigation and inquiries into driving record.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *         description: The driver ID
 *     responses:
 *       200:
 *         description: Investigation initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Driver hire_date is required
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
// POST /api/employer-investigations/driver/:driverId/initiate
router.post('/driver/:driverId/initiate', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;
    const driver = await validateDriverAccess(driverId, req);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const userId = req.user?.id || null;
    const result = await initiateInvestigation(driverId, userId);

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/employer-investigations/driver/${driverId}/initiate`, 200, duration);

    return res.json(result);
  } catch (error) {
    const duration = Date.now() - start;
    const statusCode = error.message === 'Driver hire_date is required to initiate investigation' ? 400 : 500;
    dtLogger.error('employer_investigation_initiate_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('POST', `/api/employer-investigations/driver/${req.params.driverId}/initiate`, statusCode, duration);
    return res.status(statusCode).json({ message: error.message || 'Failed to initiate investigation' });
  }
});

/**
 * @openapi
 * /api/employer-investigations/{pastEmployerId}/send-inquiry:
 *   post:
 *     summary: Send inquiry to a past employer
 *     description: Sends an initial investigation inquiry to a specific past employer. Per 49 CFR 391.23 — Investigation and inquiries into driving record.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pastEmployerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The past employer record ID
 *     responses:
 *       200:
 *         description: Inquiry sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Past employer not found
 *       500:
 *         description: Server error
 */
// POST /api/employer-investigations/:pastEmployerId/send-inquiry
router.post('/:pastEmployerId/send-inquiry', async (req, res) => {
  const start = Date.now();
  try {
    const { pastEmployerId } = req.params;
    const emp = await validatePastEmployerAccess(pastEmployerId, req);
    if (!emp) {
      return res.status(404).json({ message: 'Past employer not found' });
    }

    const userId = req.user?.id || null;
    const result = await sendInquiry(pastEmployerId, userId);

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/employer-investigations/${pastEmployerId}/send-inquiry`, 200, duration);

    return res.json(result);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('employer_investigation_send_inquiry_failed', error, { pastEmployerId: req.params.pastEmployerId });
    dtLogger.trackRequest('POST', `/api/employer-investigations/${req.params.pastEmployerId}/send-inquiry`, 500, duration);
    return res.status(500).json({ message: 'Failed to send inquiry' });
  }
});

/**
 * @openapi
 * /api/employer-investigations/{pastEmployerId}/send-follow-up:
 *   post:
 *     summary: Send follow-up to a past employer
 *     description: Sends a follow-up inquiry to a past employer that has not yet responded. Per 49 CFR 391.23 — Investigation and inquiries into driving record.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pastEmployerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The past employer record ID
 *     responses:
 *       200:
 *         description: Follow-up sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Past employer not found
 *       500:
 *         description: Server error
 */
// POST /api/employer-investigations/:pastEmployerId/send-follow-up
router.post('/:pastEmployerId/send-follow-up', async (req, res) => {
  const start = Date.now();
  try {
    const { pastEmployerId } = req.params;
    const emp = await validatePastEmployerAccess(pastEmployerId, req);
    if (!emp) {
      return res.status(404).json({ message: 'Past employer not found' });
    }

    const userId = req.user?.id || null;
    const result = await sendFollowUp(pastEmployerId, userId);

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/employer-investigations/${pastEmployerId}/send-follow-up`, 200, duration);

    return res.json(result);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('employer_investigation_send_follow_up_failed', error, { pastEmployerId: req.params.pastEmployerId });
    dtLogger.trackRequest('POST', `/api/employer-investigations/${req.params.pastEmployerId}/send-follow-up`, 500, duration);
    return res.status(500).json({ message: 'Failed to send follow-up' });
  }
});

/**
 * @openapi
 * /api/employer-investigations/{pastEmployerId}/record-response:
 *   post:
 *     summary: Record a response from a past employer
 *     description: Records the investigation response received from a past employer. Per 49 CFR 391.23 — Investigation and inquiries into driving record.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pastEmployerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The past employer record ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - responseType
 *             properties:
 *               responseType:
 *                 type: string
 *                 description: Type of response received
 *               responseData:
 *                 type: object
 *                 description: Response payload data
 *               receivedVia:
 *                 type: string
 *                 description: Channel through which response was received (e.g. email, fax, mail)
 *               documentId:
 *                 type: string
 *                 description: Associated document ID if applicable
 *     responses:
 *       200:
 *         description: Response recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: responseType is required
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Past employer not found
 *       500:
 *         description: Server error
 */
// POST /api/employer-investigations/:pastEmployerId/record-response
router.post('/:pastEmployerId/record-response', async (req, res) => {
  const start = Date.now();
  try {
    const { pastEmployerId } = req.params;
    const emp = await validatePastEmployerAccess(pastEmployerId, req);
    if (!emp) {
      return res.status(404).json({ message: 'Past employer not found' });
    }

    const { responseType, responseData, receivedVia, documentId } = req.body;
    if (!responseType) {
      return res.status(400).json({ message: 'responseType is required' });
    }

    const documentedBy = req.user?.id || null;
    const result = await recordResponse(pastEmployerId, {
      responseType,
      responseData,
      receivedVia,
      documentId,
      documentedBy
    });

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/employer-investigations/${pastEmployerId}/record-response`, 200, duration);

    return res.json(result);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('employer_investigation_record_response_failed', error, { pastEmployerId: req.params.pastEmployerId });
    dtLogger.trackRequest('POST', `/api/employer-investigations/${req.params.pastEmployerId}/record-response`, 500, duration);
    return res.status(500).json({ message: 'Failed to record response' });
  }
});

/**
 * @openapi
 * /api/employer-investigations/{pastEmployerId}/document-no-response:
 *   post:
 *     summary: Document no response from a past employer
 *     description: Documents that a past employer failed to respond to the investigation inquiry within the required timeframe. Per 49 CFR 391.23 — Investigation and inquiries into driving record.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pastEmployerId
 *         required: true
 *         schema:
 *           type: string
 *         description: The past employer record ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *                 description: Additional notes about the non-response
 *     responses:
 *       200:
 *         description: No-response documented successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Past employer not found
 *       500:
 *         description: Server error
 */
// POST /api/employer-investigations/:pastEmployerId/document-no-response
router.post('/:pastEmployerId/document-no-response', async (req, res) => {
  const start = Date.now();
  try {
    const { pastEmployerId } = req.params;
    const emp = await validatePastEmployerAccess(pastEmployerId, req);
    if (!emp) {
      return res.status(404).json({ message: 'Past employer not found' });
    }

    const { notes } = req.body;
    const userId = req.user?.id || null;
    const result = await documentNoResponse(pastEmployerId, userId, notes);

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/employer-investigations/${pastEmployerId}/document-no-response`, 200, duration);

    return res.json(result);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('employer_investigation_document_no_response_failed', error, { pastEmployerId: req.params.pastEmployerId });
    dtLogger.trackRequest('POST', `/api/employer-investigations/${req.params.pastEmployerId}/document-no-response`, 500, duration);
    return res.status(500).json({ message: 'Failed to document no response' });
  }
});

/**
 * @openapi
 * /api/employer-investigations/driver/{driverId}/history-file:
 *   get:
 *     summary: Get investigation history file for a driver
 *     description: Retrieves the complete investigation history file for a driver, including all past employer inquiry records. Per 49 CFR 391.23 — Investigation and inquiries into driving record.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *         description: The driver ID
 *     responses:
 *       200:
 *         description: Array of investigation history records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Driver not found
 *       500:
 *         description: Server error
 */
// GET /api/employer-investigations/driver/:driverId/history-file
router.get('/driver/:driverId/history-file', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;
    const driver = await validateDriverAccess(driverId, req);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const result = await getHistoryFile(driverId);

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/employer-investigations/driver/${driverId}/history-file`, 200, duration, {
      count: result.length
    });

    return res.json(result);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('employer_investigation_history_file_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('GET', `/api/employer-investigations/driver/${req.params.driverId}/history-file`, 500, duration);
    return res.status(500).json({ message: 'Failed to fetch investigation history file' });
  }
});

module.exports = router;
