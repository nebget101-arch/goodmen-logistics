'use strict';

/**
 * Public Trial Request Routes
 *
 * POST   /api/public/trial-requests        → public, no auth
 * GET    /api/public/trial-requests        → admin only (auth required)
 * GET    /api/public/trial-requests/:id    → admin only (auth required)
 * PATCH  /api/public/trial-requests/:id/status → admin only (auth required)
 */

const express = require('express');
const router = express.Router();
const trialRequestService = require('../services/trial-request-service');
const trialRequestEmailService = require('../services/trial-request-email-service');
const authMiddleware = require('../middleware/auth-middleware');
const { PLANS, TRIAL_REQUEST_STATUSES } = require('../config/plans');

function getPublicAppBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://fleetneuron.com').replace(/\/$/, '');
}

function buildTrialSignupUrl(token) {
  const safeToken = String(token || '').trim();
  if (!safeToken) return null;

  const template = String(process.env.TRIAL_SIGNUP_URL_TEMPLATE || '').trim();
  if (template.includes('{token}')) {
    return template.replace('{token}', encodeURIComponent(safeToken));
  }

  return `${getPublicAppBaseUrl()}/trial-signup?token=${encodeURIComponent(safeToken)}`;
}

// ─── PUBLIC: Submit a trial request ──────────────────────────────────────────

/**
 * @openapi
 * /api/public/trial-requests:
 *   post:
 *     summary: Submit a free trial request
 *     tags:
 *       - Public
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [companyName, contactName, email, phone, requestedPlan]
 *             properties:
 *               companyName: { type: string }
 *               contactName: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               fleetSize: { type: string }
 *               currentSystem: { type: string }
 *               requestedPlan: { type: string, enum: [basic, multi_mc, end_to_end] }
 *               wantsDemoAssistance: { type: boolean }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Trial request received
 *       400:
 *         description: Validation error
 */
router.post('/', async (req, res) => {
  try {
    const record = await trialRequestService.createTrialRequest(req.body);
    let internalEmailResult = { sent: false, reason: 'not_attempted' };
    let requesterEmailResult = { sent: false, reason: 'not_attempted' };

    try {
      internalEmailResult = await trialRequestEmailService.sendNewTrialRequestNotification(record);
      if (!internalEmailResult?.sent) {
        console.warn('[trial-requests] internal email not sent:', internalEmailResult);
      }
    } catch (emailErr) {
      console.error('[trial-requests] email notification error:', emailErr.message);
    }

    try {
      requesterEmailResult = await trialRequestEmailService.sendRequesterUnderReviewEmail(record);
      if (!requesterEmailResult?.sent) {
        console.warn('[trial-requests] requester email not sent:', requesterEmailResult);
      }
    } catch (emailErr) {
      console.error('[trial-requests] requester email error:', emailErr.message);
    }

    return res.status(201).json({
      success: true,
      message:
        'Your trial request has been received. Our team will reach out to you shortly.',
      id: record.id,
      emailDelivery: {
        internalNotificationSent: Boolean(internalEmailResult?.sent),
        requesterNotificationSent: Boolean(requesterEmailResult?.sent),
        internalReason: internalEmailResult?.reason || null,
        requesterReason: requesterEmailResult?.reason || null,
        internalError: internalEmailResult?.error || null,
        requesterError: requesterEmailResult?.error || null
      }
    });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({
        success: false,
        error: err.message,
        details: err.validationErrors || undefined
      });
    }
    console.error('[trial-requests] create error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to process your request. Please try again later.'
    });
  }
});

// ─── PUBLIC: Fetch plan metadata (used by frontend) ──────────────────────────

router.get('/plans', (_req, res) => {
  return res.json({ success: true, data: PLANS });
});

// ─── PUBLIC: Read signup context by approved token ─────────────────────────

router.get('/signup/:token', async (req, res) => {
  try {
    const data = await trialRequestService.getSignupContextByToken(req.params.token);
    return res.json({ success: true, data });
  } catch (err) {
    if ([400, 404, 409, 410].includes(err.statusCode)) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('[trial-requests] signup context error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load signup details' });
  }
});

// ─── PUBLIC: Complete approved trial signup ─────────────────────────────────

router.post('/signup/:token/complete', async (req, res) => {
  try {
    const data = await trialRequestService.completeSignupFromToken(req.params.token, req.body || {});
    return res.status(201).json({
      success: true,
      message: 'Trial account created successfully. You can now sign in.',
      data
    });
  } catch (err) {
    if ([400, 404, 409, 410].includes(err.statusCode)) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('[trial-requests] complete signup error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to create trial account' });
  }
});

// ─── ADMIN: List trial requests ───────────────────────────────────────────────

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, page, pageSize } = req.query;
    const records = await trialRequestService.listTrialRequests({
      status: status || undefined,
      page: parseInt(page, 10) || 1,
      pageSize: Math.min(parseInt(pageSize, 10) || 25, 200)
    });
    return res.json({ success: true, data: records, count: records.length });
  } catch (err) {
    console.error('[trial-requests] list error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch trial requests' });
  }
});

// ─── ADMIN: Get single trial request ─────────────────────────────────────────

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const record = await trialRequestService.getTrialRequestById(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('[trial-requests] get error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch trial request' });
  }
});

// ─── ADMIN: Update status ─────────────────────────────────────────────────────

router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({
        success: false,
        error: `status is required. Valid values: ${TRIAL_REQUEST_STATUSES.join(', ')}`
      });
    }
    const record = status === 'approved'
      ? await trialRequestService.approveTrialRequest(req.params.id, req.user?.id || null)
      : await trialRequestService.updateTrialRequestStatus(req.params.id, status);
    let requesterApprovedEmailResult = { sent: false, reason: 'not_attempted' };
    let activationUrl = null;

    if (status === 'approved') {
      activationUrl = buildTrialSignupUrl(record.signup_token);
      try {
        requesterApprovedEmailResult = await trialRequestEmailService.sendRequesterApprovedEmail(record, {
          activationUrl
        });
        if (!requesterApprovedEmailResult?.sent) {
          console.warn('[trial-requests] requester approved email not sent:', requesterApprovedEmailResult);
        }
      } catch (emailErr) {
        console.error('[trial-requests] requester approved email error:', emailErr.message);
      }
    }

    return res.json({
      success: true,
      data: record,
      emailDelivery: status === 'approved'
        ? {
            requesterApprovedNotificationSent: Boolean(requesterApprovedEmailResult?.sent),
            requesterReason: requesterApprovedEmailResult?.reason || null,
            requesterError: requesterApprovedEmailResult?.error || null,
            activationLink: activationUrl,
            activationExpiresAt: record.signup_token_expires_at || null
          }
        : undefined
    });
  } catch (err) {
    if (err.statusCode === 400 || err.statusCode === 404 || err.statusCode === 409) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('[trial-requests] update status error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to update trial request' });
  }
});

module.exports = router;
