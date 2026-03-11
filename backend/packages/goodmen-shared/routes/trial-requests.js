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
const authMiddleware = require('../middleware/auth-middleware');
const { PLANS, TRIAL_REQUEST_STATUSES } = require('../config/plans');

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
    return res.status(201).json({
      success: true,
      message:
        'Your trial request has been received. Our team will reach out to you shortly.',
      id: record.id
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
    const record = await trialRequestService.updateTrialRequestStatus(req.params.id, status);
    return res.json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode === 400 || err.statusCode === 404) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('[trial-requests] update status error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to update trial request' });
  }
});

module.exports = router;
