'use strict';

/**
 * Public, token-gated e-signature routes (no auth middleware).
 *
 * FN-1797 (story FN-1788). Mirrors public-employer-investigations.js: a signer
 * opens a secure tokenized link, reads the agreement + their assigned fields,
 * fills them, applies an in-house e-signature (typed name + IP/UA capture) and
 * submits. The signature-service validates the token, records the signature,
 * generates the signed PDF and stores it in R2.
 *
 *   GET  /public/agreements/sign/:token  — document + signer fields; sets viewed
 *   POST /public/agreements/sign/:token  — { fieldValues, signerName,
 *                                            signatureValue, consent } → signed
 *
 * Mounted with NO auth/tenant middleware — the token IS the credential.
 */

const express = require('express');
const router = express.Router();
const dtLogger = require('../utils/logger');
const { getSignerView, submitSignature } = require('../services/signature-service');

// ---------------------------------------------------------------------------
// Rate limiter (mirrors public-employer-investigations.js)
// ---------------------------------------------------------------------------
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

/** Best-effort client IP (honours the gateway's X-Forwarded-For). */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || null;
}

// ---------------------------------------------------------------------------
// GET /sign/:token — load the agreement + signer-assigned fields
// ---------------------------------------------------------------------------
router.get('/sign/:token', rateLimited, async (req, res) => {
  const start = Date.now();
  try {
    const result = await getSignerView({ token: req.params.token });
    const status = result.error ? result.status : 200;
    dtLogger.trackRequest('GET', '/public/agreements/sign/:token', status, Date.now() - start);
    if (result.error) {
      return res.status(status).json({ message: result.error });
    }
    return res.json(result);
  } catch (error) {
    dtLogger.error('public_agreement_sign_get_failed', error);
    dtLogger.trackRequest('GET', '/public/agreements/sign/:token', 500, Date.now() - start);
    return res.status(500).json({ message: 'Failed to load agreement' });
  }
});

// ---------------------------------------------------------------------------
// POST /sign/:token — submit the signature
// ---------------------------------------------------------------------------
router.post('/sign/:token', rateLimited, express.json(), async (req, res) => {
  const start = Date.now();
  try {
    const body = req.body || {};
    const result = await submitSignature({
      token: req.params.token,
      fieldValues: body.fieldValues || {},
      signerName: body.signerName,
      signatureValue: body.signatureValue,
      consent: body.consent,
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null
    });
    const status = result.error ? result.status : 200;
    dtLogger.trackRequest('POST', '/public/agreements/sign/:token', status, Date.now() - start);
    if (result.error) {
      return res.status(status).json({ message: result.error });
    }
    return res.json(result);
  } catch (error) {
    dtLogger.error('public_agreement_sign_post_failed', error);
    dtLogger.trackRequest('POST', '/public/agreements/sign/:token', 500, Date.now() - start);
    return res.status(500).json({ message: 'Failed to submit signature' });
  }
});

module.exports = router;
