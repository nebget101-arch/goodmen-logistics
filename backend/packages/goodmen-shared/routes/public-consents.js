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
const { generateConsentPdf } = require('../services/driver-onboarding-pdf');
const { createDriverDocument } = require('../services/driver-storage-service');
const { upsertRequirementStatus, computeAndUpdateDqfCompleteness } = require('../services/dqf-service');

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

/**
 * Load driver and operating entity details for template placeholder replacement.
 */
async function loadDriverAndEntity(driverId) {
  const driverRes = await query(
    'SELECT id, first_name, last_name, operating_entity_id FROM drivers WHERE id = $1',
    [driverId]
  );
  const driver = driverRes.rows[0] || null;
  let operatingEntity = null;

  if (driver && driver.operating_entity_id) {
    const oeRes = await query(
      'SELECT id, name, legal_name, address_line1, address_line2, city, state, zip_code, phone, email FROM operating_entities WHERE id = $1',
      [driver.operating_entity_id]
    );
    operatingEntity = oeRes.rows[0] || null;
  }

  return { driver, operatingEntity };
}

/**
 * Replace template placeholders with operating entity and driver data.
 */
function replaceTemplatePlaceholders(bodyText, { driver, operatingEntity }) {
  if (!bodyText) return bodyText;

  const companyName = operatingEntity?.name || operatingEntity?.legal_name || 'Company Name';
  const companyAddress = operatingEntity
    ? [
      operatingEntity.address_line1,
      operatingEntity.address_line2,
      operatingEntity.city,
      operatingEntity.state,
      operatingEntity.zip_code
    ].filter(Boolean).join(', ')
    : '';
  const driverFullName = driver
    ? `${driver.first_name || ''} ${driver.last_name || ''}`.trim()
    : '';

  let result = bodyText;
  result = result.replace(/\{\{companyName\}\}/g, companyName);
  result = result.replace(/\{\{companyAddress\}\}/g, companyAddress);
  result = result.replace(/\{\{driverFullName\}\}/g, driverFullName);
  return result;
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

    // Load driver and operating entity for placeholder replacement
    const { driver, operatingEntity } = await loadDriverAndEntity(packet.driver_id);

    // Replace placeholders in template body text
    const renderedBodyText = replaceTemplatePlaceholders(template.body_text, { driver, operatingEntity });

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

    const companyName = operatingEntity?.name || operatingEntity?.legal_name || 'Company Name';
    const companyAddress = operatingEntity
      ? [
        operatingEntity.address_line1,
        operatingEntity.address_line2,
        operatingEntity.city,
        operatingEntity.state,
        operatingEntity.zip_code
      ].filter(Boolean).join(', ')
      : '';
    const driverFullName = driver
      ? `${driver.first_name || ''} ${driver.last_name || ''}`.trim()
      : '';

    return res.json({
      template: {
        id: template.id,
        key: template.key,
        title: template.title,
        body_text: renderedBodyText,
        version: template.version,
        requires_signature: template.requires_signature,
        capture_fields: template.capture_fields
      },
      consent: existingConsent,
      isSigned,
      driverId: packet.driver_id,
      companyName,
      companyAddress,
      driverFullName
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
    const body = req.body || {};
    const signerName = body.signerName || '';
    const signatureType = body.signatureType || 'typed_name';
    // FN-242: Frontend sends signerName as the e-signature (typed name IS the signature)
    const signatureValue = body.signatureValue || body.signerName || '';
    const captureData = body.captureData || body.capturedFields || null;

    if (!signerName) {
      return res.status(400).json({ message: 'signerName is required' });
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

    // ── Generate PDF and upload as pre-hire document ──────────────────
    let documentId = null;
    try {
      const template = await getTemplateByKey(consentKey);
      const { driver, operatingEntity } = await loadDriverAndEntity(packet.driver_id);

      const companyName = operatingEntity?.name || operatingEntity?.legal_name || 'Company Name';
      const companyAddress = operatingEntity
        ? [
          operatingEntity.address_line1,
          operatingEntity.address_line2,
          operatingEntity.city,
          operatingEntity.state,
          operatingEntity.zip_code
        ].filter(Boolean).join(', ')
        : '';

      const pdfBuffer = await generateConsentPdf({
        template,
        consent: {
          id: signed.id,
          signer_name: signed.signer_name || signerName,
          signed_at: signed.signed_at,
          ip_address: signed.ip_address || req.ip,
          capture_data: captureData || {}
        },
        company: { name: companyName, address: companyAddress },
        driver
      });

      const dateStr = new Date().toISOString().split('T')[0];
      const doc = await createDriverDocument({
        driverId: packet.driver_id,
        packetId,
        docType: `consent_${consentKey}_signed`,
        fileName: `${consentKey}_signed_${dateStr}.pdf`,
        mimeType: 'application/pdf',
        bytes: pdfBuffer
      });
      documentId = doc.id;

      // Update DQF requirement with evidence document ID
      const CONSENT_DQF_MAP = {
        clearinghouse_full: 'clearinghouse_consent_received',
        release_of_information: 'release_of_info_signed',
        fcra_authorization: 'fcra_authorization',
        psp_consent: 'psp_consent',
        drug_alcohol_release: 'drug_alcohol_release_signed',
        // FN-238: MVR consent form DQF mappings
        mvr_disclosure: 'mvr_disclosure_signed',
        mvr_authorization: 'mvr_authorization_signed',
        mvr_release_of_liability: 'mvr_release_of_liability_signed'
      };
      const dqfKey = CONSENT_DQF_MAP[consentKey];
      if (dqfKey && documentId) {
        await upsertRequirementStatus(packet.driver_id, dqfKey, 'complete', documentId);
        await computeAndUpdateDqfCompleteness(packet.driver_id);
      }
    } catch (pdfErr) {
      // Non-blocking: PDF generation failure should not break consent signing
      // eslint-disable-next-line no-console
      console.error('consent_pdf_generation_failed', pdfErr);
      dtLogger.error('consent_pdf_generation_failed', pdfErr, {
        consentId: signed.id,
        consentKey,
        packetId
      });
    }

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
      signedAt: signed.signed_at,
      documentId
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
