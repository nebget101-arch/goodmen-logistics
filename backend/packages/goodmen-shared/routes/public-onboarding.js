const express = require('express');
const router = express.Router();
const { query, getClient } = require('../internal/db');
const { hashToken } = require('../services/token-service');
const dtLogger = require('../utils/logger');
const { createDriverDocument } = require('../services/driver-storage-service');
const {
  buildEmploymentApplicationPdf,
  buildMvrAuthorizationPdf
} = require('../services/driver-onboarding-pdf');

async function loadPacketWithToken(packetId, token, forUpdate = false) {
  if (!packetId || !token) {
    return { error: 'packetId and token are required' };
  }

  const tokenHash = hashToken(token);
  const selectSql = forUpdate
    ? 'SELECT * FROM driver_onboarding_packets WHERE id = $1 FOR UPDATE'
    : 'SELECT * FROM driver_onboarding_packets WHERE id = $1';
  const res = await query(selectSql, [packetId]);
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

async function maybeGenerateOnboardingPdfs(packetId) {
  // Check if we already have PDFs for this packet
  const existingDocsRes = await query(
    `SELECT doc_type
     FROM driver_documents
     WHERE packet_id = $1
       AND doc_type IN ('employment_application_pdf', 'mvr_authorization_pdf')`,
    [packetId]
  );
  const existingTypes = new Set(existingDocsRes.rows.map((r) => r.doc_type));

  // Load packet, driver, sections, and most recent esignatures
  const packetRes = await query(
    'SELECT * FROM driver_onboarding_packets WHERE id = $1',
    [packetId]
  );
  if (packetRes.rows.length === 0) return;
  const packet = packetRes.rows[0];

  const sectionsRes = await query(
    `SELECT section_key, status, data
     FROM driver_onboarding_sections
     WHERE packet_id = $1`,
    [packetId]
  );

  const sections = {};
  sectionsRes.rows.forEach((row) => {
    sections[row.section_key] = row;
  });

  const driverRes = await query(
    'SELECT id, first_name, last_name, email, phone, cdl_number, cdl_state FROM drivers WHERE id = $1',
    [packet.driver_id]
  );
  const driver = driverRes.rows[0];
  if (!driver) return;

  const esignRes = await query(
    `SELECT section_key, signer_name, signed_at
     FROM driver_esignatures
     WHERE packet_id = $1
     ORDER BY created_at DESC`,
    [packetId]
  );
  const esignatures = {};
  esignRes.rows.forEach((row) => {
    if (!esignatures[row.section_key]) {
      esignatures[row.section_key] = row;
    }
  });

  // Employment application PDF
  if (
    sections.employment_application &&
    sections.employment_application.status === 'completed' &&
    !existingTypes.has('employment_application_pdf')
  ) {
    const applicationData = sections.employment_application.data || {};
    const signature = esignatures.employment_application || null;
    const buffer = await buildEmploymentApplicationPdf({
      driver,
      application: applicationData,
      signature
    });
    await createDriverDocument({
      driverId: driver.id,
      packetId: packet.id,
      docType: 'employment_application_pdf',
      fileName: `employment_application_${driver.last_name || 'driver'}.pdf`,
      mimeType: 'application/pdf',
      bytes: buffer
    });
    dtLogger.info('driver_employment_application_pdf_created', { packetId, driverId: driver.id });
  }

  // MVR authorization PDF
  if (
    sections.mvr_authorization &&
    sections.mvr_authorization.status === 'completed' &&
    !existingTypes.has('mvr_authorization_pdf')
  ) {
    const mvrData = sections.mvr_authorization.data || {};
    const signature = esignatures.mvr_authorization || null;
    const buffer = await buildMvrAuthorizationPdf({
      driver,
      mvr: mvrData,
      signature
    });
    await createDriverDocument({
      driverId: driver.id,
      packetId: packet.id,
      docType: 'mvr_authorization_pdf',
      fileName: `mvr_authorization_${driver.last_name || 'driver'}.pdf`,
      mimeType: 'application/pdf',
      bytes: buffer
    });
    dtLogger.info('driver_mvr_authorization_pdf_created', { packetId, driverId: driver.id });
  }
}

// Basic rate limit placeholder (per-process, very simple)
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

// GET /public/onboarding/:packetId?token=...
router.get('/:packetId', rateLimited, async (req, res) => {
  const start = Date.now();
  try {
    const { packetId } = req.params;
    const { token } = req.query;
    const { packet, error, status } = await loadPacketWithToken(packetId, token);
    if (error) {
      return res.status(status || 400).json({ message: error });
    }

    const sectionsRes = await query(
      `SELECT section_key, status, completed_at
       FROM driver_onboarding_sections
       WHERE packet_id = $1
       ORDER BY section_key`,
      [packetId]
    );

    const driverRes = await query(
      'SELECT id, first_name, last_name, email, phone, cdl_number, cdl_state FROM drivers WHERE id = $1',
      [packet.driver_id]
    );

    const duration = Date.now() - start;
    dtLogger.trackRequest('GET', `/public/onboarding/${packetId}`, 200, duration);

    return res.json({
      packet: {
        id: packet.id,
        status: packet.status,
        expiresAt: packet.expires_at,
        driverId: packet.driver_id
      },
      driver: driverRes.rows[0] || null,
      sections: sectionsRes.rows
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_onboarding_get_failed', error, { params: req.params });
    dtLogger.trackRequest('GET', `/public/onboarding/${req.params.packetId}`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error in public onboarding GET:', error);
    return res.status(500).json({ message: 'Failed to load onboarding packet' });
  }
});

// POST /public/onboarding/:packetId/sections/:sectionKey?token=...
router.post('/:packetId/sections/:sectionKey', rateLimited, async (req, res) => {
  const start = Date.now();
  const client = await getClient();
  try {
    const { packetId, sectionKey } = req.params;
    const { token } = req.query;
    const { data, status } = req.body || {};

    const allowedKeys = ['employment_application', 'mvr_authorization', 'uploads'];
    if (!allowedKeys.includes(sectionKey)) {
      return res.status(400).json({ message: 'Invalid section key' });
    }

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ message: 'data payload is required' });
    }

    const { packet, error, status: errStatus } = await loadPacketWithToken(packetId, token, true);
    if (error) {
      return res.status(errStatus || 400).json({ message: error });
    }

    const newStatus = status && typeof status === 'string' ? status : 'in_progress';
    const isCompleted = newStatus === 'completed';

    await client.query(
      `
      INSERT INTO driver_onboarding_sections (packet_id, section_key, status, completed_at, data)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (packet_id, section_key) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = CASE
          WHEN EXCLUDED.status = 'completed' THEN NOW()
          ELSE driver_onboarding_sections.completed_at
        END,
        data = EXCLUDED.data,
        updated_at = NOW()
      `,
      [
        packet.id,
        sectionKey,
        newStatus,
        isCompleted ? new Date().toISOString() : null,
        JSON.stringify(data)
      ]
    );

    // When section is completed with signature fields, record e-signature so PDFs can be generated
    if (isCompleted && ['employment_application', 'mvr_authorization'].includes(sectionKey)) {
      let signerName = null;
      let signatureValue = null;
      let signedAt = new Date();
      if (sectionKey === 'employment_application' && data.applicationSignatureName) {
        signerName = data.applicationSignatureName;
        signatureValue = signerName;
        if (data.applicationSignatureDate) {
          try {
            signedAt = new Date(data.applicationSignatureDate);
          } catch (_) { /* keep default */ }
        }
      } else if (sectionKey === 'mvr_authorization' && data.mvrSignatureName) {
        signerName = data.mvrSignatureName;
        signatureValue = signerName;
        if (data.mvrSignatureDate) {
          try {
            signedAt = new Date(data.mvrSignatureDate);
          } catch (_) { /* keep default */ }
        }
      }
      if (signerName && signatureValue) {
        const signatureHash = hashToken(`${signerName}|${signatureValue}|${signedAt.toISOString()}`);
        await client.query(
          `
          INSERT INTO driver_esignatures (
            packet_id,
            section_key,
            signer_name,
            signature_type,
            signature_value,
            signed_at,
            ip_address,
            user_agent,
            consent_text_version,
            signature_hash
          )
          VALUES ($1, $2, $3, 'typed_name', $4, $5, $6, $7, 'v1', $8)
          `,
          [
            packet.id,
            sectionKey,
            signerName,
            signatureValue,
            signedAt.toISOString(),
            req.ip || '',
            req.headers['user-agent'] || '',
            signatureHash
          ]
        );
        await maybeGenerateOnboardingPdfs(packet.id);
      }
    }

    const duration = Date.now() - start;
    dtLogger.trackRequest(
      'POST',
      `/public/onboarding/${packetId}/sections/${sectionKey}`,
      200,
      duration
    );

    return res.json({
      packetId,
      sectionKey,
      status: newStatus
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_onboarding_section_failed', error, { params: req.params });
    dtLogger.trackRequest(
      'POST',
      `/public/onboarding/${req.params.packetId}/sections/${req.params.sectionKey}`,
      500,
      duration
    );
    // eslint-disable-next-line no-console
    console.error('Error in public onboarding section POST:', error);
    return res.status(500).json({ message: 'Failed to save onboarding section' });
  } finally {
    client.release();
  }
});

// POST /public/onboarding/:packetId/esignatures?token=...
router.post('/:packetId/esignatures', rateLimited, async (req, res) => {
  const start = Date.now();
  const client = await getClient();
  try {
    const { packetId } = req.params;
    const { token } = req.query;
    const {
      sectionKey,
      signerName,
      signatureValue,
      signatureType = 'typed_name',
      consentTextVersion = 'v1'
    } = req.body || {};

    if (!signerName || !signatureValue) {
      return res.status(400).json({ message: 'signerName and signatureValue are required' });
    }

    const allowedKeys = ['employment_application', 'mvr_authorization'];
    const finalSectionKey = allowedKeys.includes(sectionKey) ? sectionKey : 'employment_application';

    const { packet, error, status } = await loadPacketWithToken(packetId, token, true);
    if (error) {
      return res.status(status || 400).json({ message: error });
    }

    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'] || '';
    const signedAt = new Date();
    const signatureHash = hashToken(`${signerName}|${signatureValue}|${signedAt.toISOString()}`);

    await client.query(
      `
      INSERT INTO driver_esignatures (
        packet_id,
        section_key,
        signer_name,
        signature_type,
        signature_value,
        signed_at,
        ip_address,
        user_agent,
        consent_text_version,
        signature_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        packet.id,
        finalSectionKey,
        signerName,
        signatureType,
        signatureValue,
        signedAt.toISOString(),
        ipAddress,
        userAgent,
        consentTextVersion,
        signatureHash
      ]
    );

    // Generate PDFs if sections are completed and PDFs not yet created
    await maybeGenerateOnboardingPdfs(packet.id);

    const duration = Date.now() - start;
    dtLogger.trackRequest(
      'POST',
      `/public/onboarding/${packetId}/esignatures`,
      200,
      duration
    );

    return res.json({
      packetId,
      sectionKey: finalSectionKey,
      signedAt
    });
  } catch (error) {
    const duration = Date.now() - start;
    dtLogger.error('public_onboarding_esign_failed', error, { params: req.params });
    dtLogger.trackRequest(
      'POST',
      `/public/onboarding/${req.params.packetId}/esignatures`,
      500,
      duration
    );
    // eslint-disable-next-line no-console
    console.error('Error in public onboarding esign POST:', error);
    return res.status(500).json({ message: 'Failed to capture e-signature' });
  } finally {
    client.release();
  }
});

module.exports = router;

