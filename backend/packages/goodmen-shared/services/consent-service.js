const { query, getClient } = require('../internal/db');
const { upsertRequirementStatus, computeAndUpdateDqfCompleteness } = require('./dqf-service');

/**
 * Mapping from consent_key to dqf requirement_key.
 * When a consent is signed, the corresponding DQF requirement is marked complete.
 */
const CONSENT_DQF_MAP = {
  clearinghouse_full: 'clearinghouse_consent_received',
  release_of_information: 'release_of_info_signed',
  fcra_authorization: 'fcra_authorization',
  psp_consent: 'psp_consent'
};

async function getActiveTemplates() {
  const result = await query(
    `SELECT * FROM consent_templates
     WHERE is_active = true
     ORDER BY key, version DESC`
  );
  return result.rows;
}

async function getTemplateByKey(key) {
  if (!key) throw new Error('key is required');
  const result = await query(
    `SELECT * FROM consent_templates
     WHERE key = $1 AND is_active = true
     ORDER BY version DESC
     LIMIT 1`,
    [key]
  );
  return result.rows[0] || null;
}

async function createConsentRequest({ driverId, consentKey, packetId, expiresAt }) {
  if (!driverId || !consentKey) {
    throw new Error('driverId and consentKey are required');
  }

  const template = await getTemplateByKey(consentKey);
  if (!template) {
    throw new Error(`No active consent template found for key: ${consentKey}`);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const consentResult = await client.query(
      `INSERT INTO driver_consents (
        driver_id,
        template_id,
        consent_key,
        consent_version,
        packet_id,
        status,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, 'pending', $6)
      RETURNING *`,
      [
        driverId,
        template.id,
        consentKey,
        template.version,
        packetId || null,
        expiresAt || null
      ]
    );

    const consent = consentResult.rows[0];

    await client.query(
      `INSERT INTO consent_audit_log (consent_id, action, performed_by, ip_address, user_agent)
       VALUES ($1, 'sent', NULL, NULL, NULL)`,
      [consent.id]
    );

    await client.query('COMMIT');
    return consent;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function signConsent(consentId, { signerName, signatureType, signatureValue, ipAddress, userAgent }) {
  if (!consentId) throw new Error('consentId is required');
  if (!signerName || !signatureValue) {
    throw new Error('signerName and signatureValue are required');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const consentRes = await client.query(
      'SELECT * FROM driver_consents WHERE id = $1 FOR UPDATE',
      [consentId]
    );
    if (consentRes.rows.length === 0) {
      throw new Error('Consent not found');
    }
    const consent = consentRes.rows[0];

    if (consent.status === 'signed') {
      throw new Error('Consent has already been signed');
    }
    if (consent.status === 'revoked') {
      throw new Error('Consent has been revoked');
    }

    const templateRes = await client.query(
      'SELECT * FROM consent_templates WHERE id = $1',
      [consent.template_id]
    );
    const template = templateRes.rows[0];
    if (!template) {
      throw new Error('Consent template not found');
    }

    const updatedRes = await client.query(
      `UPDATE driver_consents SET
        status = 'signed',
        signed_at = NOW(),
        signer_name = $1,
        signature_type = $2,
        signature_value = $3,
        ip_address = $4,
        user_agent = $5,
        consent_text_snapshot = $6,
        consent_version = $7
      WHERE id = $8
      RETURNING *`,
      [
        signerName,
        signatureType || 'typed_name',
        signatureValue,
        ipAddress || null,
        userAgent || null,
        template.body_text,
        template.version,
        consentId
      ]
    );

    await client.query(
      `INSERT INTO consent_audit_log (consent_id, action, performed_by, ip_address, user_agent)
       VALUES ($1, 'signed', $2, $3, $4)`,
      [consentId, signerName, ipAddress || null, userAgent || null]
    );

    await client.query('COMMIT');

    // Auto-update DQF requirement if a mapping exists
    const dqfKey = CONSENT_DQF_MAP[consent.consent_key];
    if (dqfKey) {
      try {
        await upsertRequirementStatus(consent.driver_id, dqfKey, 'complete', null);
        await computeAndUpdateDqfCompleteness(consent.driver_id);
      } catch (dqfError) {
        // Non-blocking: DQF update failure should not break consent signing
        // eslint-disable-next-line no-console
        console.error('consent_dqf_update_failed', dqfError);
      }
    }

    return updatedRes.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function revokeConsent(consentId, { revokedBy, ipAddress, userAgent }) {
  if (!consentId) throw new Error('consentId is required');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const updatedRes = await client.query(
      `UPDATE driver_consents SET status = 'revoked' WHERE id = $1 RETURNING *`,
      [consentId]
    );
    if (updatedRes.rows.length === 0) {
      throw new Error('Consent not found');
    }

    await client.query(
      `INSERT INTO consent_audit_log (consent_id, action, performed_by, ip_address, user_agent)
       VALUES ($1, 'revoked', $2, $3, $4)`,
      [consentId, revokedBy || null, ipAddress || null, userAgent || null]
    );

    await client.query('COMMIT');
    return updatedRes.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getDriverConsents(driverId) {
  if (!driverId) throw new Error('driverId is required');

  const result = await query(
    `SELECT dc.*, ct.key AS template_key, ct.title AS template_title, ct.version AS template_version
     FROM driver_consents dc
     LEFT JOIN consent_templates ct ON ct.id = dc.template_id
     WHERE dc.driver_id = $1
     ORDER BY dc.created_at DESC`,
    [driverId]
  );
  return result.rows;
}

async function checkConsentStatus(driverId, consentKey) {
  if (!driverId || !consentKey) {
    throw new Error('driverId and consentKey are required');
  }

  const result = await query(
    `SELECT id FROM driver_consents
     WHERE driver_id = $1
       AND consent_key = $2
       AND status = 'signed'
     LIMIT 1`,
    [driverId, consentKey]
  );
  return result.rows.length > 0;
}

async function getConsentAuditLog(consentId) {
  if (!consentId) throw new Error('consentId is required');

  const result = await query(
    `SELECT * FROM consent_audit_log
     WHERE consent_id = $1
     ORDER BY created_at ASC`,
    [consentId]
  );
  return result.rows;
}

module.exports = {
  getActiveTemplates,
  getTemplateByKey,
  createConsentRequest,
  signConsent,
  revokeConsent,
  getDriverConsents,
  checkConsentStatus,
  getConsentAuditLog
};
