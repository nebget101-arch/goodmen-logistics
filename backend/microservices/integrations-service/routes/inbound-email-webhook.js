'use strict';

/**
 * POST /api/webhooks/email-inbound — FN-760
 *
 * Receives forwarded rate-confirmation emails from the configured inbound
 * provider (SendGrid Inbound Parse primary, AWS SES compatible). Parses the
 * multipart payload, hands it to the inbound-email processor, and responds
 * 200 quickly so the provider does not retry.
 *
 * Shared-secret auth: the provider is configured to send
 * `x-webhook-secret: <INBOUND_EMAIL_WEBHOOK_SECRET>`. When the env var is
 * unset (dev), the check is skipped and the request is logged.
 */

const express = require('express');
const multer = require('multer');

const dtLogger = require('@goodmen/shared/utils/logger');
const {
  processInboundEmail,
  verifyWebhookSecret
} = require('../services/inbound-email-service');

const router = express.Router();

const MAX_ATTACHMENT_MB = parseInt(process.env.INBOUND_EMAIL_MAX_MB || '25', 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_MB * 1024 * 1024,
    files: 20
  }
});

/**
 * @openapi
 * /api/webhooks/email-inbound:
 *   post:
 *     summary: Inbound email webhook (SendGrid/SES)
 *     description: Accepts forwarded rate-confirmation emails, creates DRAFT loads.
 *     tags:
 *       - Inbound Email
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               from: { type: string }
 *               to: { type: string }
 *               subject: { type: string }
 *               text: { type: string }
 *               html: { type: string }
 *     responses:
 *       200: { description: Webhook accepted (even if tenant not matched) }
 *       401: { description: Missing or invalid shared secret }
 */
router.post('/', upload.any(), async (req, res) => {
  const startedAt = Date.now();

  const sig = verifyWebhookSecret(req);
  if (!sig.ok) {
    dtLogger.warn('inbound_email_webhook_rejected', {
      reason: sig.reason,
      remoteAddress: req.ip || null
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body || {};
    const result = await processInboundEmail({
      from: body.from || body.sender || '',
      to: body.to || body.recipient || body.envelope?.to || '',
      subject: body.subject || '',
      text: body.text || body['text-plain'] || body.plain || '',
      html: body.html || body['text-html'] || '',
      files: Array.isArray(req.files) ? req.files : []
    });

    const durationMs = Date.now() - startedAt;

    // Always return 200 once the payload has been accepted, even when we could
    // not match a tenant, so the provider does not retry. Errors are logged.
    return res.status(200).json({
      received: result.received !== false,
      status: result.status,
      loadId: result.loadId || null,
      tenantId: result.tenantId || null,
      reason: result.reason || null,
      durationMs
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    dtLogger.error('inbound_email_webhook_unhandled', err, { durationMs });
    // Return 200 with failure flag so we avoid retry storms on truly broken
    // payloads; dispatchers can inspect the inbound_emails log manually.
    return res.status(200).json({
      received: false,
      status: 'failed',
      reason: 'unhandled_error'
    });
  }
});

module.exports = router;
