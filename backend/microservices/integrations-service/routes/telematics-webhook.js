'use strict';

/**
 * POST /api/webhooks/telematics/:provider?secret=<shared-secret> — FN-1661
 *
 * Provider-agnostic telematics ingress, mirroring the SendGrid inbound-email
 * webhook. Two independent auth layers run before any work:
 *
 *   1. Shared secret  — `?secret=` query param (or `x-webhook-secret` header)
 *                       compared timing-safe against TELEMATICS_WEBHOOK_SECRET.
 *   2. Provider HMAC  — the adapter verifies the provider's request signature
 *                       over the raw body (see Samsara/Motive adapters).
 *
 * On success the body is parsed → normalized → persisted to
 * `vehicle_position_pings`. We always answer 200 quickly (even on unmatched
 * devices) so providers do not enter retry storms; rejections are logged and
 * returned with a `reason`.
 *
 * Requires the raw request body for HMAC: server.js installs a body-parser
 * `verify` hook that stashes `req.rawBody`.
 */

const crypto = require('crypto');
const express = require('express');

const dtLogger = require('@goodmen/shared/utils/logger');
const { getAdapter, SUPPORTED_PROVIDERS } = require('@goodmen/shared/services/telematics');
const { persistPings } = require('../services/telematics-ingest-service');

const router = express.Router();

/**
 * Shared-secret gate. Parity with inbound-email `verifyWebhookSecret`: when no
 * secret is configured (dev), the check is skipped and flagged.
 */
function verifyWebhookSecret(req) {
  const expected = process.env.TELEMATICS_WEBHOOK_SECRET;
  if (!expected) return { ok: true, reason: 'no_secret_configured' };
  const provided = (
    req?.query?.secret ||
    req?.headers?.['x-webhook-secret'] ||
    ''
  ).toString();
  if (!provided) return { ok: false, reason: 'missing_secret' };
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: 'bad_secret' };
  try {
    return crypto.timingSafeEqual(a, b)
      ? { ok: true }
      : { ok: false, reason: 'bad_secret' };
  } catch (_err) {
    return { ok: false, reason: 'bad_secret' };
  }
}

/**
 * @openapi
 * /api/webhooks/telematics/{provider}:
 *   post:
 *     summary: Telematics provider webhook (Samsara/Motive)
 *     description: >
 *       Accepts position-update webhooks, verifies the shared secret and the
 *       provider HMAC signature, then persists normalized pings.
 *     tags:
 *       - Telematics
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [samsara, motive] }
 *       - in: query
 *         name: secret
 *         schema: { type: string }
 *         description: Shared secret (alternative to x-webhook-secret header)
 *     responses:
 *       200: { description: Accepted (even when no device matched) }
 *       400: { description: Unknown provider }
 *       401: { description: Bad shared secret or provider signature }
 */
router.post('/:provider', async (req, res) => {
  const startedAt = Date.now();
  const provider = (req.params.provider || '').toString().toLowerCase();

  const adapter = getAdapter(provider);
  if (!adapter) {
    return res.status(400).json({
      error: 'unknown_provider',
      supported: SUPPORTED_PROVIDERS
    });
  }

  // Layer 1 — shared secret
  const secretCheck = verifyWebhookSecret(req);
  if (!secretCheck.ok) {
    dtLogger.warn('telematics_webhook_rejected', {
      provider,
      reason: secretCheck.reason,
      remoteAddress: req.ip || null
    });
    return res.status(401).json({ error: 'Unauthorized', reason: secretCheck.reason });
  }

  // Layer 2 — provider HMAC signature
  const sigCheck = adapter.verifyWebhookSignature(req);
  if (!sigCheck.ok) {
    dtLogger.warn('telematics_webhook_bad_signature', {
      provider,
      reason: sigCheck.reason,
      remoteAddress: req.ip || null
    });
    return res.status(401).json({ error: 'Unauthorized', reason: sigCheck.reason });
  }

  try {
    const rawEvents = adapter.parseEvent(req.body);
    const pings = rawEvents
      .map((ev) => {
        try {
          return adapter.normalizePing(ev);
        } catch (err) {
          dtLogger.error('telematics_normalize_failed', err, { provider });
          return null;
        }
      })
      .filter(Boolean);

    const stats = await persistPings(provider, pings);
    const durationMs = Date.now() - startedAt;

    dtLogger.info('telematics_webhook_processed', {
      provider,
      ...stats,
      durationMs
    });

    return res.status(200).json({ received: true, provider, ...stats, durationMs });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    dtLogger.error('telematics_webhook_unhandled', err, { provider, durationMs });
    // 200 with failure flag to avoid provider retry storms on broken payloads.
    return res.status(200).json({
      received: false,
      provider,
      reason: 'unhandled_error'
    });
  }
});

module.exports = router;
