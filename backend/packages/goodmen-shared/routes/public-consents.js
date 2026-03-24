const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const { hashToken } = require('../services/token-service');
const dtLogger = require('../utils/logger');
const {
  getTemplateByKey,
  signConsent,
  checkConsentStatus,
  createConsentRequest
} = require('../services/consent-service');

// Basic rate limit placeholder (per-process, same pattern as public-onboarding.js)
const recentRequests = new Map();
function rateLimited(req, res, next) {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const last = recentRequests.get(key) || 0;
  if (now - last < 500) {
    return res.status(429).json({ message: 'Too many requests, slow down.' });
  }
  recentRequests.set(key, now);
  return next();
}

/**
 * Load and validate an onboarding packet by ID + token.
 * Returns the packet row or an error object.
 */
async function loadPacketWithToken(packetId, token) {
  if (!packetId || !token) {
    return { error: 'packetId and token are required' };
  }

  const tokenHash = hashToken(token);
  const res = await query(
    'SELECT * FROM driver_onboarding_packets WHERE id = $1',
    [packetId]
  );
  if (res.rows.length === 0) {
    return { error: 'Packet not found', status: 404 };
  }
  const packet = res.rows[0];

  const now = new Date();
  if (packet.status === 'revoked' || packet.status === 'expired') {
    return { error: 'Packet is no longer active', status: 410 };
  }
  if (new Date(packet.expires_at) <= now) {
    return { error: 'Packet has expired', status: 410 };
  }
  if (packet.token_hash !== tokenHash) {
    return { error: 'Invalid token', status: 403 };
  }

  return { packet };
}

// GET /public/consents/:packetId/:consentKey?token=...
// Load consent template + current status for the driver in this packet
router.get('/:packetId/:consentKey', rateLimited, async (req, res) => {
  const start = Date.now();
  try {
    const { packetId, consentKey } = req.params;
    const { token } = req.query;

    const { packet, error, status } = await loadPacketWithToken(packetId, token);
    if (error) {
      return res.status(status || 400).json({ message: error });
    }

    const template = await getTemplateByKey(consentKey);
    if (!template) {
      return res.status(404).json({ message: `No active consent template found for key: ${consentKey}` });
    }

    const isSigned = await checkConsentStatus(packet.driver_id, consentKey);

    // Also load existing consent record for this packet+key if it exists
    const consentRes = await query(
      `SELECT id, status, signed_at, signer_name
       FROM driver_consents
       WHERE driver_id = $1 AND consent_key = $2 AND packet_id = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [packet.driver_id, consentKey, packetId]
    );
    const existingConsent = consentRes.rows[0] || null;

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/public/consents/${packetId}/${consentKey}`, 200, duration);

    return res.json({
      template: {
        id: template.id,
        key: template.key,
        title: template.title,
        body_text: template.body_text,
        version: template.version
      },
      consent: existingConsent,
      isSigned,
      driverId: packet.driver_id
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_consent_get_failed', error, { params: req.params });
    dtLogger.trackRequest('GET', `/public/consents/${req.params.packetId}/${req.params.consentKey}`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error in public consent GET:', error);
    return res.status(500).json({ message: 'Failed to load consent' });
  }
});

// POST /public/consents/:packetId/:consentKey/sign?token=...
// Sign a consent (captures IP, user-agent from request)
router.post('/:packetId/:consentKey/sign', rateLimited, async (req, res) => {
  const start = Date.now();
  try {
    const { packetId, consentKey } = req.params;
    const { token } = req.query;
    const { signerName, signatureType, signatureValue } = req.body || {};

    if (!signerName || !signatureValue) {
      return res.status(400).json({ message: 'signerName and signatureValue are required' });
    }

    const { packet, error, status } = await loadPacketWithToken(packetId, token);
    if (error) {
      return res.status(status || 400).json({ message: error });
    }

    // Find existing pending consent for this packet+key, or create one
    const consentRes = await query(
      `SELECT id FROM driver_consents
       WHERE driver_id = $1 AND consent_key = $2 AND packet_id = $3 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [packet.driver_id, consentKey, packetId]
    );

    let consentId;
    if (consentRes.rows.length > 0) {
      consentId = consentRes.rows[0].id;
    } else {
      // Auto-create a consent request if none exists (driver opened link directly)
      const newConsent = await createConsentRequest({
        driverId: packet.driver_id,
        consentKey,
        packetId
      });
      consentId = newConsent.id;
    }

    const signed = await signConsent(consentId, {
      signerName,
      signatureType: signatureType || 'typed_name',
      signatureValue,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null
    });

    const duration = Date.now() - start;
    dtLogger.trackRequest(
      'POST',
      `/public/consents/${packetId}/${consentKey}/sign`,
      200,
      duration
    );

    return res.json({
      consentId: signed.id,
      status: signed.status,
      signedAt: signed.signed_at
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_consent_sign_failed', error, { params: req.params });
    dtLogger.trackRequest(
      'POST',
      `/public/consents/${req.params.packetId}/${req.params.consentKey}/sign`,
      500,
      duration
    );
    // eslint-disable-next-line no-console
    console.error('Error in public consent sign POST:', error);

    if (error.message === 'Consent has already been signed') {
      return res.status(409).json({ message: error.message });
    }
    if (error.message && error.message.includes('No active consent template')) {
      return res.status(404).json({ message: error.message });
    }
    return res.status(500).json({ message: 'Failed to sign consent' });
  }
});

module.exports = router;
