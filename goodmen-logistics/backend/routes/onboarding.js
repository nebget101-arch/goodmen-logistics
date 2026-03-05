const express = require('express');
const router = express.Router();
const auth = require('./auth-middleware');
const { query, getClient } = require('../config/database');
const { generateToken, hashToken } = require('../services/token-service');
const { sendOnboardingLink } = require('../services/notification-service');
const dtLogger = require('../utils/logger');

// Admin / safety only for now
router.use(auth(['admin', 'safety']));

/** Get base URL for onboarding links. In production, localhost is not allowed. */
function getOnboardingBaseUrl(res) {
  const base =
    process.env.FRONTEND_ONBOARDING_BASE_URL ||
    (process.env.PUBLIC_APP_URL ? `${process.env.PUBLIC_APP_URL.replace(/\/$/, '')}/onboard` : 'http://localhost:4200/onboard');
  const basePublicUrl = base.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production' && (basePublicUrl.includes('localhost') || basePublicUrl.startsWith('http://127.'))) {
    dtLogger.error('Onboarding URL would be localhost in production', null, {
      hint: 'Set FRONTEND_ONBOARDING_BASE_URL or PUBLIC_APP_URL to your production frontend URL'
    });
    if (res) {
      res.status(500).json({
        message: 'Server misconfiguration: production frontend URL not set. Set FRONTEND_ONBOARDING_BASE_URL or PUBLIC_APP_URL.'
      });
    }
    return null;
  }
  return basePublicUrl;
}

async function findOrCreateDriverFromPayload(payload) {
  const {
    firstName,
    lastName,
    phone,
    email,
    cdlNumber,
    cdlState
  } = payload || {};

  if (!cdlNumber || !cdlState) {
    throw new Error('cdlNumber and cdlState are required to create driver');
  }

  const normState = cdlState.toString().trim().toUpperCase();
  const normNumber = cdlNumber.toString().trim();

  const existing = await query(
    'SELECT id FROM drivers WHERE cdl_number = $1 AND cdl_state = $2 LIMIT 1',
    [normNumber, normState]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const created = await query(
    `INSERT INTO drivers (
      first_name,
      last_name,
      email,
      phone,
      cdl_number,
      cdl_state,
      cdl_class,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'A', 'applicant')
    RETURNING id`,
    [
      firstName || '',
      lastName || '',
      email || null,
      phone || null,
      normNumber,
      normState
    ]
  );

  return created.rows[0].id;
}

// POST /api/onboarding/packets
router.post('/packets', async (req, res) => {
  const start = Date.now();
  const client = await getClient();
  try {
    const { driverId, driver } = req.body || {};
    await client.query('BEGIN');

    let finalDriverId = driverId || null;
    if (!finalDriverId) {
      finalDriverId = await findOrCreateDriverFromPayload(driver);
    }

    const token = generateToken();
    const tokenHash = hashToken(token);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const packetResult = await client.query(
      `INSERT INTO driver_onboarding_packets (
        driver_id,
        status,
        token_hash,
        expires_at,
        created_by
      )
      VALUES ($1, 'draft', $2, $3, $4)
      RETURNING id`,
      [finalDriverId, tokenHash, expiresAt.toISOString(), req.user?.id || null]
    );

    const packetId = packetResult.rows[0].id;

    const sectionKeys = ['employment_application', 'mvr_authorization', 'uploads'];
    // eslint-disable-next-line no-restricted-syntax
    for (const key of sectionKeys) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO driver_onboarding_sections (packet_id, section_key, status)
         VALUES ($1, $2, 'not_started')
         ON CONFLICT (packet_id, section_key) DO NOTHING`,
        [packetId, key]
      );
    }

    await client.query('COMMIT');

    const basePublicUrl = getOnboardingBaseUrl(res);
    if (!basePublicUrl) return;
    const publicUrl = `${basePublicUrl}/${packetId}?token=${encodeURIComponent(token)}`;

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', '/api/onboarding/packets', 201, duration, {
      driverId: finalDriverId,
      packetId
    });

    res.status(201).json({
      packetId,
      token,
      publicUrl
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const duration = Date.now() - start;
    dtLogger.error('Failed to create onboarding packet', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/onboarding/packets', 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error creating onboarding packet:', error);
    res.status(500).json({ message: 'Failed to create onboarding packet' });
  } finally {
    client.release();
  }
});

// POST /api/onboarding/packets/:id/send
router.post('/packets/:id/send', async (req, res) => {
  const start = Date.now();
  const client = await getClient();
  try {
    const packetId = req.params.id;
    const { via, phone, email } = req.body || {};

    if (!via || !['sms', 'email', 'both'].includes(via)) {
      return res.status(400).json({ message: 'via must be sms, email, or both' });
    }

    await client.query('BEGIN');

    const packetRes = await client.query(
      'SELECT * FROM driver_onboarding_packets WHERE id = $1 FOR UPDATE',
      [packetId]
    );
    if (packetRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Onboarding packet not found' });
    }

    const packet = packetRes.rows[0];

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const sentToPhone = phone || packet.sent_to_phone || null;
    const sentToEmail = email || packet.sent_to_email || null;

    const updated = await client.query(
      `UPDATE driver_onboarding_packets
       SET status = 'sent',
           token_hash = $1,
           expires_at = $2,
           sent_via = $3,
           sent_to_phone = $4,
           sent_to_email = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING driver_id`,
      [tokenHash, expiresAt.toISOString(), via, sentToPhone, sentToEmail, packetId]
    );

    await client.query('COMMIT');

    const basePublicUrl = getOnboardingBaseUrl(res);
    if (!basePublicUrl) return;
    const publicUrl = `${basePublicUrl}/${packetId}?token=${encodeURIComponent(token)}`;

    // Resolve driver name for message body (optional)
    let driverName = '';
    const driverId = updated.rows[0].driver_id;
    const driverRes = await query(
      'SELECT first_name, last_name FROM drivers WHERE id = $1',
      [driverId]
    );
    if (driverRes.rows.length > 0) {
      const d = driverRes.rows[0];
      driverName = [d.first_name, d.last_name].filter(Boolean).join(' ').trim();
    }

    const delivery = await sendOnboardingLink({
      publicUrl,
      phone: sentToPhone,
      email: sentToEmail,
      via,
      driverName: driverName || undefined
    });

    dtLogger.info('driver_onboarding_packet_sent', {
      packetId,
      driverId,
      via,
      phone: sentToPhone,
      email: sentToEmail,
      smsSent: delivery.sms.sent,
      emailSent: delivery.email.sent,
      publicUrlPreview: publicUrl
    });

    const duration = Date.now() - start;
    dtLogger.trackRequest('POST', `/api/onboarding/packets/${packetId}/send`, 200, duration);

    return res.json({
      packetId,
      sentVia: via,
      sentToPhone,
      sentToEmail,
      publicUrl,
      delivery: {
        sms: { sent: delivery.sms.sent, error: delivery.sms.error },
        email: { sent: delivery.email.sent, error: delivery.email.error }
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const duration = Date.now() - start;
    dtLogger.error('Failed to send onboarding packet', error, { params: req.params, body: req.body });
    dtLogger.trackRequest('POST', `/api/onboarding/packets/${req.params.id}/send`, 500, duration);
    // eslint-disable-next-line no-console
    console.error('Error sending onboarding packet:', error);
    return res.status(500).json({ message: 'Failed to send onboarding packet' });
  } finally {
    client.release();
  }
});

module.exports = router;


