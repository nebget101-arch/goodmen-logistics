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
const trialService = require('../services/trialService');
const authMiddleware = require('../middleware/auth-middleware');
const rbacService = require('../services/rbac-service');
const { PLANS, TRIAL_REQUEST_STATUSES } = require('../config/plans');

const INTERNAL_TRIAL_ADMIN_TENANT_NAME = 'FleetNeuron Default Tenant';

async function requireInternalTrialAdmin(req, res, next) {
  try {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const user = await trialRequestService.getUserTenantContext?.(userId);
    let tenantName = user?.tenantName || null;

    if (!tenantName) {
      const membership = await trialRequestService.getDefaultTenantMembership?.(userId);
      tenantName = membership?.tenantName || null;
    }

    if (!tenantName) {
      const knex = require('../config/knex');
      const membership = await knex('user_tenant_memberships as utm')
        .join('tenants as t', 't.id', 'utm.tenant_id')
        .where('utm.user_id', userId)
        .andWhere('utm.is_active', true)
        .orderBy('utm.is_default', 'desc')
        .orderBy('utm.created_at', 'asc')
        .select('t.name')
        .first();

      tenantName = membership?.name || null;

      if (!tenantName) {
        const legacyUser = await knex('users as u')
          .leftJoin('tenants as t', 't.id', 'u.tenant_id')
          .where('u.id', userId)
          .select('t.name as tenant_name')
          .first();
        tenantName = legacyUser?.tenant_name || null;
      }
    }

    if (String(tenantName || '').trim() !== INTERNAL_TRIAL_ADMIN_TENANT_NAME) {
      return res.status(403).json({ success: false, error: 'Forbidden: trial request admin is limited to the internal demo tenant' });
    }

    const roles = await rbacService.getRolesForUser(userId).catch(() => []);
    const roleCodes = new Set((roles || []).map((role) => String(role.code || '').trim().toLowerCase()));
    const legacyRole = String(req.user?.role || '').trim().toLowerCase();
    const isAllowed = roleCodes.has('super_admin') || roleCodes.has('company_admin') || legacyRole === 'admin';

    if (!isAllowed) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient admin access for trial request management' });
    }

    return next();
  } catch (err) {
    console.error('[trial-requests] authz error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to validate trial request admin access' });
  }
}

function getPublicAppBaseUrl(req) {
  const configured = String(
    process.env.TRIAL_PUBLIC_BASE_URL
    || process.env.PUBLIC_APP_BASE_URL
    || process.env.APP_BASE_URL
    || ''
  ).trim();
  if (configured) return configured.replace(/\/$/, '');

  const origin = String(req?.headers?.origin || '').trim();
  if (origin) return origin.replace(/\/$/, '');

  return 'https://fleetneuron.com';
}

function buildTrialSignupUrl(token, req) {
  const safeToken = String(token || '').trim();
  if (!safeToken) return null;

  const template = String(process.env.TRIAL_SIGNUP_URL_TEMPLATE || '').trim();
  if (template.includes('{token}')) {
    return template.replace('{token}', encodeURIComponent(safeToken));
  }

  return `${getPublicAppBaseUrl(req)}/trial-signup/${encodeURIComponent(safeToken)}`;
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

router.get('/', authMiddleware, requireInternalTrialAdmin, async (req, res) => {
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

// ─── ADMIN: Get (or regenerate) activation link for approved request ───────

router.get('/:id/activation-link', authMiddleware, requireInternalTrialAdmin, async (req, res) => {
  try {
    const forceRegenerate = String(req.query.regenerate || '').toLowerCase() === 'true';
    const record = await trialRequestService.getOrCreateApprovedSignupToken(
      req.params.id,
      req.user?.id || null,
      { forceRegenerate }
    );

    const activationLink = buildTrialSignupUrl(record.signup_token, req);
    return res.json({
      success: true,
      data: {
        id: record.id,
        status: record.status,
        requestedPlan: record.requested_plan,
        contactName: record.contact_name,
        email: record.email,
        activationLink,
        activationExpiresAt: record.signup_token_expires_at || null
      }
    });
  } catch (err) {
    if ([400, 404, 409].includes(err.statusCode)) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('[trial-requests] activation link error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to generate activation link' });
  }
});

// ─── ADMIN: Get single trial request ─────────────────────────────────────────

router.get('/:id', authMiddleware, requireInternalTrialAdmin, async (req, res) => {
  try {
    const record = await trialRequestService.getTrialRequestById(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('[trial-requests] get error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch trial request' });
  }
});

// ─── ADMIN: Reset tenant admin password (internal support action) ───────────

router.post('/:id/reset-tenant-admin-password', authMiddleware, requireInternalTrialAdmin, async (req, res) => {
  try {
    const result = await trialRequestService.resetTenantAdminPassword(req.params.id);
    return res.json({
      success: true,
      message: 'Tenant admin password reset successfully',
      data: result
    });
  } catch (err) {
    if ([400, 404, 409].includes(err.statusCode)) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('[trial-requests] reset tenant admin password error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to reset tenant admin password' });
  }
});

// ─── ADMIN: Update status ─────────────────────────────────────────────────────

router.patch('/:id/status', authMiddleware, requireInternalTrialAdmin, async (req, res) => {
  try {
    const { status, subscriptionId, trialDays } = req.body;
    if (!status) {
      return res.status(400).json({
        success: false,
        error: `status is required. Valid values: ${TRIAL_REQUEST_STATUSES.join(', ')}`
      });
    }
    const record = status === 'approved'
      ? await trialRequestService.approveTrialRequest(req.params.id, req.user?.id || null)
      : await trialRequestService.updateTrialRequestStatus(req.params.id, status);

    const actorUserId = req.user?.id || req.user?.sub || null;

    // FN-72: activate trial state when admin marks approved/converted and a tenant exists.
    if ((status === 'approved' || status === 'converted') && record?.created_tenant_id) {
      await trialService.activateTrial(
        record.created_tenant_id,
        record.requested_plan || 'basic',
        Number.isFinite(Number(trialDays)) ? Number(trialDays) : 14,
        actorUserId
      );

      if (status === 'converted') {
        const safeSubscriptionId = String(subscriptionId || '').trim();
        if (safeSubscriptionId) {
          await trialService.markConverted(record.created_tenant_id, safeSubscriptionId, actorUserId);
        }
      }
    }

    let requesterApprovedEmailResult = { sent: false, reason: 'not_attempted' };
    let activationUrl = null;

    if (status === 'approved') {
      activationUrl = buildTrialSignupUrl(record.signup_token, req);
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

// ─── ADMIN: Update DOT / MC number on a trial request ─────────────────────

/**
 * @openapi
 * /api/public/trial-requests/{id}:
 *   patch:
 *     summary: Update DOT / MC number on an existing trial request
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dot_number: { type: string, pattern: '^\\d{1,8}$' }
 *               mc_number:  { type: string, pattern: '^\\d{1,8}$' }
 *     responses:
 *       200:
 *         description: Updated trial request
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 */
router.patch('/:id', authMiddleware, requireInternalTrialAdmin, async (req, res) => {
  try {
    const { dot_number, mc_number } = req.body || {};
    const updated = await trialRequestService.updateTrialRequestDotMc(
      req.params.id,
      { dot_number, mc_number }
    );
    return res.json({ success: true, data: updated });
  } catch (err) {
    if ([400, 404].includes(err.statusCode)) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('[trial-requests] patch dot/mc error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to update trial request' });
  }
});

module.exports = router;
