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
