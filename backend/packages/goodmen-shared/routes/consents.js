const express = require('express');
const router = express.Router();
const auth = require('./auth-middleware');
const dtLogger = require('../utils/logger');
const {
  getActiveTemplates,
  getDriverConsents,
  createConsentRequest,
  signConsent,
  revokeConsent,
  getConsentAuditLog
} = require('../services/consent-service');

// Admin / safety only
router.use(auth(['admin', 'safety']));

/**
 * @openapi
 * /api/consents:
 *   get:
 *     summary: List active consent templates
 *     description: Retrieves all active consent templates available for driver consent management. Per 49 CFR Part 391 — Driver consent management.
 *     tags:
 *       - Consents
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of active consent templates
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// GET /api/consents - list all active consent templates
router.get('/', async (req, res) => {
  const start = Date.now();
  try {
    const templates = await getActiveTemplates();

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', '/api/consents', 200, duration, { count: templates.length });

    return res.json(templates);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('consents_list_templates_failed', error);
    dtLogger.trackRequest('GET', '/api/consents', 500, duration);
    return res.status(500).json({ message: 'Failed to load consent templates' });
  }
});

/**
 * @openapi
 * /api/consents/driver/{driverId}:
 *   get:
 *     summary: Get all consents for a driver
 *     description: Retrieves all consent records for a specific driver. Per 49 CFR Part 391 — Driver consent management.
 *     tags:
 *       - Consents
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
 *         description: Array of consent records for the driver
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// GET /api/consents/driver/:driverId - get all consents for a driver
router.get('/driver/:driverId', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId } = req.params;
    const consents = await getDriverConsents(driverId);

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/consents/driver/${driverId}`, 200, duration, {
      driverId,
      count: consents.length
    });

    return res.json(consents);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('consents_get_driver_failed', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('GET', `/api/consents/driver/${req.params.driverId}`, 500, duration);
    return res.status(500).json({ message: 'Failed to load driver consents' });
  }
});

/**
 * @openapi
 * /api/consents/request:
 *   post:
 *     summary: Create a consent request
 *     description: Creates a new consent request for a driver based on a consent template key. Per 49 CFR Part 391 — Driver consent management.
 *     tags:
 *       - Consents
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - driverId
 *               - consentKey
 *             properties:
 *               driverId:
 *                 type: string
 *                 description: The driver ID to create the consent request for
 *               consentKey:
 *                 type: string
 *                 description: The consent template key
 *               packetId:
 *                 type: string
 *                 nullable: true
 *                 description: Optional packet ID to associate with the consent
 *     responses:
 *       201:
 *         description: Consent request created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: driverId and consentKey are required
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No active consent template found for the given key
 *       500:
 *         description: Server error
 */
// POST /api/consents/request - create a consent request for a driver
router.post('/request', async (req, res) => {
  const start = Date.now();
  try {
    const { driverId, consentKey, packetId } = req.body || {};

    if (!driverId || !consentKey) {
      return res.status(400).json({ message: 'driverId and consentKey are required' });
    }

    const consent = await createConsentRequest({
      driverId,
      consentKey,
      packetId: packetId || null
    });

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', '/api/consents/request', 201, duration, {
      driverId,
      consentKey,
      consentId: consent.id
    });

    return res.status(201).json(consent);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('consents_create_request_failed', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/consents/request', 500, duration);

    if (error.message && error.message.includes('No active consent template')) {
      return res.status(404).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to create consent request' });
  }
});

/**
 * @openapi
 * /api/consents/{id}/sign:
 *   post:
 *     summary: Sign a consent
 *     description: Records a signature on a consent request (admin-initiated). Per 49 CFR Part 391 — Driver consent management.
 *     tags:
 *       - Consents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The consent record ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signerName
 *               - signatureValue
 *             properties:
 *               signerName:
 *                 type: string
 *                 description: Name of the person signing the consent
 *               signatureType:
 *                 type: string
 *                 default: typed_name
 *                 description: Type of signature (e.g. typed_name, drawn)
 *               signatureValue:
 *                 type: string
 *                 description: The signature value
 *     responses:
 *       200:
 *         description: Consent signed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: signerName and signatureValue are required
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Consent not found
 *       409:
 *         description: Consent has already been signed or has been revoked
 *       500:
 *         description: Server error
 */
// POST /api/consents/:id/sign - sign a consent (admin-initiated)
router.post('/:id/sign', async (req, res) => {
  const start = Date.now();
  try {
    const { id } = req.params;
    const { signerName, signatureType, signatureValue } = req.body || {};

    if (!signerName || !signatureValue) {
      return res.status(400).json({ message: 'signerName and signatureValue are required' });
    }

    const consent = await signConsent(id, {
      signerName,
      signatureType: signatureType || 'typed_name',
      signatureValue,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null
    });

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/consents/${id}/sign`, 200, duration, { consentId: id });

    return res.json(consent);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('consents_sign_failed', error, { consentId: req.params.id });
    dtLogger.trackRequest('POST', `/api/consents/${req.params.id}/sign`, 500, duration);

    if (error.message === 'Consent not found') {
      return res.status(404).json({ message: error.message });
    }
    if (error.message === 'Consent has already been signed' || error.message === 'Consent has been revoked') {
      return res.status(409).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to sign consent' });
  }
});

/**
 * @openapi
 * /api/consents/{id}/revoke:
 *   post:
 *     summary: Revoke a consent
 *     description: Revokes a previously signed consent record. Per 49 CFR Part 391 — Driver consent management.
 *     tags:
 *       - Consents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The consent record ID
 *     responses:
 *       200:
 *         description: Consent revoked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Consent not found
 *       500:
 *         description: Server error
 */
// POST /api/consents/:id/revoke - revoke a consent
router.post('/:id/revoke', async (req, res) => {
  const start = Date.now();
  try {
    const { id } = req.params;
    const revokedBy = req.user?.id || req.user?.username || null;

    const consent = await revokeConsent(id, {
      revokedBy,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null
    });

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/consents/${id}/revoke`, 200, duration, { consentId: id });

    return res.json(consent);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('consents_revoke_failed', error, { consentId: req.params.id });
    dtLogger.trackRequest('POST', `/api/consents/${req.params.id}/revoke`, 500, duration);

    if (error.message === 'Consent not found') {
      return res.status(404).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to revoke consent' });
  }
});

/**
 * @openapi
 * /api/consents/{id}/audit:
 *   get:
 *     summary: Get consent audit log
 *     description: Retrieves the audit trail for a specific consent record, including sign, revoke, and other lifecycle events. Per 49 CFR Part 391 — Driver consent management.
 *     tags:
 *       - Consents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The consent record ID
 *     responses:
 *       200:
 *         description: Array of audit log entries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// GET /api/consents/:id/audit - get audit log for a consent
router.get('/:id/audit', async (req, res) => {
  const start = Date.now();
  try {
    const { id } = req.params;
    const auditLog = await getConsentAuditLog(id);

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/api/consents/${id}/audit`, 200, duration, {
      consentId: id,
      count: auditLog.length
    });

    return res.json(auditLog);
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('consents_audit_log_failed', error, { consentId: req.params.id });
    dtLogger.trackRequest('GET', `/api/consents/${req.params.id}/audit`, 500, duration);
    return res.status(500).json({ message: 'Failed to load consent audit log' });
  }
});

module.exports = router;
