'use strict';

const crypto = require('crypto');
const express = require('express');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const rbacService = require('@goodmen/shared/services/rbac-service');
const knex = require('@goodmen/shared/config/knex');
const stripe = require('@goodmen/shared/config/stripe');
const stripeService = require('@goodmen/shared/services/stripeService');
const trialService = require('@goodmen/shared/services/trialService');
const extraSeatSyncService = require('@goodmen/shared/services/extraSeatSyncService');
const { PLANS, VALID_PLAN_IDS, normalizePlanId } = require('@goodmen/shared/config/plans');

const BILLING_ADMIN_ROLES = new Set(['super_admin', 'admin', 'company_admin']);

/**
 * Map of plan IDs to their Stripe Price IDs, following the
 * STRIPE_PRICE_[PLAN_ID_UPPERCASE] env-var pattern used by jobs/processTrialConversions.js.
 */
function getPlanPriceMap() {
  return {
    basic: String(process.env.STRIPE_PRICE_BASIC || '').trim(),
    multi_mc: String(process.env.STRIPE_PRICE_MULTI_MC || '').trim(),
    end_to_end: String(process.env.STRIPE_PRICE_END_TO_END || '').trim(),
    enterprise: String(process.env.STRIPE_PRICE_ENTERPRISE || '').trim()
  };
}

function getExtraSeatPriceId() {
  return String(process.env.STRIPE_PRICE_EXTRA_USER_SEAT || '').trim() || null;
}

function getBillingReturnUrl() {
  const base = String(
    process.env.PUBLIC_APP_URL ||
      process.env.FRONTEND_URL ||
      process.env.APP_URL ||
      process.env.FRONTEND_BASE_URL ||
      'http://localhost:4200'
  ).trim();
  const root = base.replace(/\/+$/, '');
  return `${root}/billing`;
}

/**
 * Resolve an idempotency key for a Stripe write: honor a client-supplied
 * `Idempotency-Key` header (so frontend retries are safe), otherwise mint a
 * fresh one scoped to the operation.
 */
function resolveIdempotencyKey(req, prefix) {
  const provided = String(req.headers['idempotency-key'] || '').trim();
  return provided || `${prefix}:${crypto.randomUUID()}`;
}

/**
 * Send a sanitized error: log the underlying Stripe/internal detail server-side
 * but return only a generic public message so nothing leaks in the response body.
 */
function sendBillingError(res, publicMessage, err) {
  console.error(`[billing] ${publicMessage}:`, err?.cause?.message || err?.message || err);
  const status = err?.statusCode || 500;
  return res.status(status).json({ success: false, error: publicMessage });
}

/** Convert a Stripe unix-seconds timestamp to an ISO string, or null. */
function unixToIso(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/** Read the subscription-level current-period window, falling back to the first item. */
function readSubscriptionPeriod(sub) {
  const item = sub?.items?.data?.[0] || null;
  const start = sub?.current_period_start ?? item?.current_period_start ?? null;
  const end = sub?.current_period_end ?? item?.current_period_end ?? null;
  return { start: unixToIso(start), end: unixToIso(end) };
}

/** Shape a Stripe subscription into the documented `data` payload (FN-1688 contract). */
function formatSubscription(sub, planId) {
  const { start, end } = readSubscriptionPeriod(sub);
  const cancelAtPeriodEnd = Boolean(sub?.cancel_at_period_end);
  const lineItems = (sub?.items?.data || []).map((item) => ({
    priceId: item.price?.id || null,
    nickname: item.price?.nickname || null,
    quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
    unitAmount: Number.isFinite(Number(item.price?.unit_amount)) ? Number(item.price.unit_amount) : null,
    currency: item.price?.currency || null,
    interval: item.price?.recurring?.interval || null
  }));

  return {
    planId,
    status: sub?.status || 'unknown',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    nextRenewal: cancelAtPeriodEnd ? null : end,
    cancelAtPeriodEnd,
    lineItems
  };
}

async function requireBillingAdmin(req, res, next) {
  try {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const roles = await rbacService.getRolesForUser(userId).catch(() => []);
    const roleCodes = new Set((roles || []).map((r) => String(r.code || '').trim().toLowerCase()));
    const legacyRole = String(req.user?.role || '').trim().toLowerCase();
    const isAdmin = BILLING_ADMIN_ROLES.has(legacyRole) || [...BILLING_ADMIN_ROLES].some((code) => roleCodes.has(code));

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: billing access is restricted to admin roles (super_admin, admin, company_admin).'
      });
    }
    return next();
  } catch (err) {
    console.error('[billing] requireBillingAdmin error:', err?.message || err);
    return res.status(500).json({ success: false, error: 'Failed to validate billing access' });
  }
}

const router = express.Router();

router.use(authMiddleware, tenantContextMiddleware, requireBillingAdmin);

function parsePlanAmount(planId) {
  const raw = String(PLANS?.[planId]?.priceLabel || '').trim();
  const match = raw.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

async function getTenantForRequest(req) {
  const tenantId = req.context?.tenantId || null;
  if (!tenantId) {
    const err = new Error('Tenant context is required');
    err.statusCode = 403;
    throw err;
  }

  const tenant = await knex('tenants')
    .where({ id: tenantId })
    .first([
      'id',
      'subscription_plan',
      'stripe_customer_id',
      'stripe_payment_method_id',
      'stripe_subscription_id',
      'trial_status',
      'trial_start',
      'trial_end',
      'extra_paid_seats',
      'stripe_extra_seats_subscription_item_id'
    ]);

  if (!tenant) {
    const err = new Error('Tenant not found');
    err.statusCode = 404;
    throw err;
  }

  return tenant;
}

function getIncludedUsersForPlanId(planId) {
  const normalized = normalizePlanId(planId, 'basic');
  const plan = PLANS[normalized] || null;
  const n = Number(plan?.includedUsers);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function countActiveUsersForTenantId(tenantId) {
  if (!tenantId) return 0;
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) return 0;
  const hasIsActive = await knex.schema.hasColumn('users', 'is_active');
  const row = await knex('users')
    .where({ tenant_id: tenantId })
    .modify((qb) => {
      if (hasIsActive) qb.andWhere('is_active', true);
    })
    .count({ count: 'id' })
    .first();
  const count = Number(row?.count || 0);
  return Number.isFinite(count) ? count : 0;
}

function buildSeatPurchaseEligibility(tenant) {
  const planId = normalizePlanId(tenant.subscription_plan, 'basic');
  const plan = PLANS[planId] || null;
  const priceUsd = Number(plan?.additionalUserPriceUsd);
  const extraSeatPriceConfigured = Boolean(String(process.env.STRIPE_PRICE_EXTRA_USER_SEAT || '').trim());

  if (!extraSeatPriceConfigured) {
    return { canPurchase: false, reason: 'Extra seat billing is not configured for this environment.' };
  }
  if (stripe?._disabled) {
    return { canPurchase: false, reason: 'Stripe is not configured.' };
  }
  if (!(Number.isFinite(priceUsd) && priceUsd > 0)) {
    return { canPurchase: false, reason: 'Additional seats for your plan are not available for self-serve purchase.' };
  }
  if (!tenant.stripe_subscription_id) {
    return { canPurchase: false, reason: 'An active subscription is required before you can add seats.' };
  }
  if (!tenant.stripe_payment_method_id) {
    return { canPurchase: false, reason: 'Add a payment method on the Billing page first.' };
  }
  return { canPurchase: true, reason: null };
}

/**
 * @openapi
 * /api/billing/seat-usage:
 *   get:
 *     summary: Get seat usage and purchase eligibility
 *     description: Returns current seat counts (included, extra paid, active users, effective limit) and whether the tenant can purchase additional seats via Stripe.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Seat usage details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     planId: { type: string }
 *                     includedUsers: { type: integer, nullable: true }
 *                     extraPaidSeats: { type: integer }
 *                     effectiveSeatLimit: { type: integer, nullable: true }
 *                     activeUsers: { type: integer }
 *                     additionalUserPriceUsd: { type: number, nullable: true }
 *                     canPurchaseExtraSeat: { type: boolean }
 *                     purchaseBlockedReason: { type: string, nullable: true }
 *       403:
 *         description: Tenant context missing
 *       404:
 *         description: Tenant not found
 */
router.get('/seat-usage', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);
    const planId = normalizePlanId(tenant.subscription_plan, 'basic');
    const plan = PLANS[planId] || null;
    const includedUsers = getIncludedUsersForPlanId(planId);
    const extraPaidSeats = Math.max(0, Math.floor(Number(tenant.extra_paid_seats) || 0));
    const activeUsers = await countActiveUsersForTenantId(tenant.id);
    const effectiveSeatLimit = includedUsers != null ? includedUsers + extraPaidSeats : null;
    const additionalUserPriceUsd =
      plan && Number.isFinite(Number(plan.additionalUserPriceUsd)) ? Number(plan.additionalUserPriceUsd) : null;

    const { canPurchase, reason } = buildSeatPurchaseEligibility(tenant);

    return res.json({
      success: true,
      data: {
        planId,
        includedUsers,
        extraPaidSeats,
        effectiveSeatLimit,
        activeUsers,
        additionalUserPriceUsd,
        canPurchaseExtraSeat: canPurchase,
        purchaseBlockedReason: reason
      }
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, error: err.message || 'Failed to load seat usage' });
  }
});

/**
 * @openapi
 * /api/billing/extra-seats/purchase:
 *   post:
 *     summary: Purchase additional user seats
 *     description: Adds extra seat quantity to the tenant Stripe subscription. Requires an active subscription and payment method. Syncs the extra_paid_seats column after purchase.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quantity: { type: integer, minimum: 1, maximum: 100, default: 1 }
 *     responses:
 *       200:
 *         description: Extra seats purchased
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     extraPaidSeats: { type: integer }
 *                     quantityAdded: { type: integer }
 *       400:
 *         description: Unable to purchase (missing subscription, payment method, or plan config)
 */
router.post('/extra-seats/purchase', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);
    const { canPurchase, reason } = buildSeatPurchaseEligibility(tenant);
    if (!canPurchase) {
      return res.status(400).json({ success: false, error: reason || 'Unable to purchase extra seats.' });
    }

    const priceId = String(process.env.STRIPE_PRICE_EXTRA_USER_SEAT || '').trim();
    const qty = Math.min(100, Math.max(1, Math.floor(Number(req.body?.quantity) || 1)));

    await stripeService.applyExtraSeatPurchase(tenant.stripe_subscription_id, priceId, qty);

    await extraSeatSyncService.syncTenantExtraSeats(
      knex,
      stripe,
      tenant.stripe_customer_id,
      tenant.stripe_subscription_id
    );

    const updated = await knex('tenants').where({ id: tenant.id }).first('extra_paid_seats');
    const extraPaidSeats = Math.max(0, Math.floor(Number(updated?.extra_paid_seats) || 0));

    return res.json({
      success: true,
      data: {
        extraPaidSeats,
        quantityAdded: qty
      }
    });
  } catch (err) {
    const status = err.statusCode || 500;
    const message = err.message || 'Failed to purchase extra seats';
    return res.status(status).json({ success: false, error: message });
  }
});

/**
 * @openapi
 * /api/billing/setup-intent:
 *   post:
 *     summary: Create a Stripe SetupIntent for saving a payment method
 *     description: Creates a Stripe SetupIntent for the tenant Stripe customer. Returns a client_secret for confirming the setup on the frontend with Stripe.js.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: SetupIntent created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     clientSecret: { type: string, description: Stripe SetupIntent client_secret }
 *       503:
 *         description: Billing is not configured (Stripe disabled)
 */
router.post('/setup-intent', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);

    // Lazily create the Stripe customer if the tenant doesn't have one yet
    // (e.g. trial pending admin approval) so a card can be added pre-approval.
    const stripeCustomerId = await trialService.ensureStripeCustomer(tenant.id);

    const setupIntent = await stripeService.createSetupIntent(stripeCustomerId);

    return res.json({
      success: true,
      data: {
        clientSecret: setupIntent.client_secret
      }
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, error: err.message || 'Failed to create setup intent' });
  }
});

/**
 * @openapi
 * /api/billing/payment-method/confirm:
 *   post:
 *     summary: Confirm and attach a payment method to the tenant
 *     description: Attaches a Stripe PaymentMethod to the tenant Stripe customer and stores its ID on the tenant record. Call this after the frontend confirms a SetupIntent.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentMethodId]
 *             properties:
 *               paymentMethodId: { type: string, description: Stripe PaymentMethod ID (e.g. pm_xxx) }
 *     responses:
 *       200:
 *         description: Payment method attached
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     paymentMethodId: { type: string }
 *       400:
 *         description: Missing paymentMethodId
 *       503:
 *         description: Billing is not configured (Stripe disabled)
 */
router.post('/payment-method/confirm', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);
    const paymentMethodId = String(req.body?.paymentMethodId || '').trim();

    if (!paymentMethodId) {
      return res.status(400).json({ success: false, error: 'paymentMethodId is required' });
    }

    // Lazily create the Stripe customer if absent so cards can be attached
    // before the trial is approved (FN-1733).
    const stripeCustomerId = await trialService.ensureStripeCustomer(tenant.id);

    await stripeService.attachPaymentMethod(stripeCustomerId, paymentMethodId);

    await knex('tenants')
      .where({ id: tenant.id })
      .update({
        stripe_payment_method_id: paymentMethodId,
        updated_at: knex.fn.now()
      });

    return res.json({ success: true, data: { paymentMethodId } });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, error: err.message || 'Failed to confirm payment method' });
  }
});

/**
 * @openapi
 * /api/billing/payment-method:
 *   get:
 *     summary: Get the tenant saved payment method
 *     description: Returns card brand, last4, and expiration for the tenant saved Stripe payment method, or hasCard=false if none is on file.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment method details or empty indicator
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     hasCard: { type: boolean }
 *                     brand: { type: string }
 *                     last4: { type: string }
 *                     expMonth: { type: integer }
 *                     expYear: { type: integer }
 */
router.get('/payment-method', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);

    if (!tenant.stripe_payment_method_id) {
      return res.json({ success: true, data: { hasCard: false } });
    }

    const pm = await stripeService.getPaymentMethod(tenant.stripe_payment_method_id);

    return res.json({
      success: true,
      data: {
        hasCard: true,
        brand: pm.brand,
        last4: pm.last4,
        expMonth: pm.exp_month,
        expYear: pm.exp_year
      }
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, error: err.message || 'Failed to load payment method' });
  }
});

/**
 * @openapi
 * /api/billing/payment-method:
 *   delete:
 *     summary: Remove the tenant saved payment method
 *     description: Detaches the Stripe PaymentMethod from the customer and clears the reference on the tenant record.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment method removed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     hasCard: { type: boolean, example: false }
 */
router.delete('/payment-method', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);

    if (tenant.stripe_payment_method_id) {
      await stripeService.detachPaymentMethod(tenant.stripe_payment_method_id);
    }

    await knex('tenants')
      .where({ id: tenant.id })
      .update({
        stripe_payment_method_id: null,
        updated_at: knex.fn.now()
      });

    return res.json({ success: true, data: { hasCard: false } });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, error: err.message || 'Failed to remove payment method' });
  }
});

/**
 * @openapi
 * /api/billing/trial-status:
 *   get:
 *     summary: Get trial status for the current tenant
 *     description: Returns the tenant trial lifecycle status including days remaining, plan details, and monthly plan amount.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Trial status details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     trialStatus: { type: string }
 *                     trialStart: { type: string, format: date-time, nullable: true }
 *                     trialEnd: { type: string, format: date-time, nullable: true }
 *                     daysRemaining: { type: integer }
 *                     planId: { type: string, nullable: true }
 *                     planName: { type: string, nullable: true }
 *                     planAmount: { type: number, nullable: true }
 */
router.get('/trial-status', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);
    const status = await trialService.getTrialStatus(tenant.id);
    const planId = tenant.subscription_plan || null;
    const planAmount = parsePlanAmount(planId || 'basic');
    const planName = planId && PLANS[planId] ? PLANS[planId].name : null;

    return res.json({
      success: true,
      data: {
        ...status,
        daysRemaining: Number.isFinite(Number(status.daysRemaining)) ? Math.max(0, Math.floor(Number(status.daysRemaining))) : 0,
        planAmount,
        planId,
        planName
      }
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, error: err.message || 'Failed to load trial status' });
  }
});

/**
 * @openapi
 * /api/billing/config-status:
 *   get:
 *     summary: Stripe configuration status (go-live verification)
 *     description: >
 *       Admin-only. Returns a per-key present/absent map for the Stripe secret,
 *       webhook secret, every plan price ID, and the extra-seat add-on price.
 *       Booleans only — secret values are never returned.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stripe configuration status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     stripeEnabled: { type: boolean, description: false when STRIPE_SECRET_KEY is missing (disabled mock) }
 *                     ok: { type: boolean, description: true when all required keys are present }
 *                     keys:
 *                       type: object
 *                       additionalProperties: { type: boolean }
 *                       description: Per-env-var present (true) / absent (false) flags. Never includes secret values.
 *                     missing:
 *                       type: array
 *                       items: { type: string }
 *                       description: Env var names that are absent.
 *                     missingPlans:
 *                       type: array
 *                       items: { type: string }
 *                       description: Plan IDs whose Stripe price ID is not configured.
 */
router.get('/config-status', async (req, res) => {
  try {
    const status = stripe.getStripeConfigStatus();
    return res.json({
      success: true,
      data: {
        stripeEnabled: !stripe._disabled,
        ok: status.ok,
        keys: status.keys,
        missing: status.missing,
        missingPlans: status.missingPlans
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to load Stripe config status' });
  }
});

/**
 * @openapi
 * /api/billing/portal-session:
 *   post:
 *     summary: Create a Stripe Customer Portal session
 *     description: Creates a Stripe Billing Customer Portal session for the tenant and returns the redirect URL. Billing-admin only.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Portal session created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     url: { type: string, description: Stripe Customer Portal redirect URL }
 *       503:
 *         description: Billing is not configured (Stripe disabled)
 */
router.post('/portal-session', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);

    // Lazily create the Stripe customer if absent (FN-1733) so the portal is
    // reachable even before the trial is approved.
    const stripeCustomerId = await trialService.ensureStripeCustomer(tenant.id);

    const { url } = await stripeService.createBillingPortalSession(stripeCustomerId, getBillingReturnUrl());

    return res.json({ success: true, data: { url } });
  } catch (err) {
    return sendBillingError(res, 'Failed to create portal session', err);
  }
});

/**
 * @openapi
 * /api/billing/subscription:
 *   get:
 *     summary: Get the tenant current subscription
 *     description: Returns the current plan, status, billing period, next renewal, cancel-at-period-end flag, and line items.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription details (data.status = "none" when no active subscription)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     planId: { type: string, nullable: true }
 *                     status: { type: string }
 *                     currentPeriodStart: { type: string, format: date-time, nullable: true }
 *                     currentPeriodEnd: { type: string, format: date-time, nullable: true }
 *                     nextRenewal: { type: string, format: date-time, nullable: true }
 *                     cancelAtPeriodEnd: { type: boolean }
 *                     lineItems: { type: array, items: { type: object } }
 */
router.get('/subscription', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);
    const planId = tenant.subscription_plan ? normalizePlanId(tenant.subscription_plan, 'basic') : null;

    if (!tenant.stripe_subscription_id || stripe?._disabled) {
      return res.json({
        success: true,
        data: {
          planId,
          status: 'none',
          currentPeriodStart: null,
          currentPeriodEnd: null,
          nextRenewal: null,
          cancelAtPeriodEnd: false,
          lineItems: []
        }
      });
    }

    const sub = await stripeService.getSubscription(tenant.stripe_subscription_id);
    return res.json({ success: true, data: formatSubscription(sub, planId) });
  } catch (err) {
    return sendBillingError(res, 'Failed to load subscription', err);
  }
});

/**
 * @openapi
 * /api/billing/change-plan:
 *   post:
 *     summary: Change the tenant subscription plan
 *     description: Updates the base plan on the tenant Stripe subscription with proration. Validates the target plan against plans.js and updates tenants.subscription_plan on success. Billing-admin only.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [planId]
 *             properties:
 *               planId: { type: string, enum: [basic, multi_mc, end_to_end, enterprise] }
 *     responses:
 *       200:
 *         description: Plan changed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   description: Updated subscription (same shape as GET /subscription data)
 *       400:
 *         description: Invalid plan, plan not configured, or no active subscription
 */
router.post('/change-plan', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);

    // Strict validation: normalizePlanId always coerces unknown input to a valid
    // plan ('basic' fallback), so it cannot detect bad input. Match the canonical
    // plan IDs directly (the documented enum) to avoid a silent downgrade.
    const planId = String(req.body?.planId || '').trim().toLowerCase();
    if (!VALID_PLAN_IDS.includes(planId)) {
      return res.status(400).json({ success: false, error: 'A valid planId is required.' });
    }

    if (stripe?._disabled) {
      return res.status(400).json({ success: false, error: 'Billing is not configured for this environment.' });
    }
    if (!tenant.stripe_subscription_id) {
      return res.status(400).json({ success: false, error: 'An active subscription is required to change plans.' });
    }

    const newPriceId = getPlanPriceMap()[planId];
    if (!newPriceId) {
      return res.status(400).json({ success: false, error: 'The selected plan is not available for self-serve changes.' });
    }

    const updated = await stripeService.changePlan(
      tenant.stripe_subscription_id,
      newPriceId,
      getExtraSeatPriceId(),
      resolveIdempotencyKey(req, 'change-plan')
    );

    await knex('tenants')
      .where({ id: tenant.id })
      .update({ subscription_plan: planId, updated_at: knex.fn.now() });

    return res.json({ success: true, data: formatSubscription(updated, planId) });
  } catch (err) {
    return sendBillingError(res, 'Failed to change plan', err);
  }
});

/**
 * @openapi
 * /api/billing/cancel:
 *   post:
 *     summary: Cancel the tenant subscription at period end
 *     description: Marks the tenant Stripe subscription to cancel at the end of the current billing period. Billing-admin only.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cancellation scheduled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     cancelAtPeriodEnd: { type: boolean, example: true }
 *                     currentPeriodEnd: { type: string, format: date-time, nullable: true }
 *       400:
 *         description: No active subscription to cancel
 */
router.post('/cancel', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);

    if (stripe?._disabled) {
      return res.status(400).json({ success: false, error: 'Billing is not configured for this environment.' });
    }
    if (!tenant.stripe_subscription_id) {
      return res.status(400).json({ success: false, error: 'There is no active subscription to cancel.' });
    }

    const updated = await stripeService.cancelSubscription(
      tenant.stripe_subscription_id,
      resolveIdempotencyKey(req, 'cancel')
    );
    const { end } = readSubscriptionPeriod(updated);

    return res.json({
      success: true,
      data: {
        cancelAtPeriodEnd: Boolean(updated?.cancel_at_period_end),
        currentPeriodEnd: end
      }
    });
  } catch (err) {
    return sendBillingError(res, 'Failed to cancel subscription', err);
  }
});

/**
 * @openapi
 * /api/billing/invoices:
 *   get:
 *     summary: List the tenant Stripe invoices
 *     description: Returns the tenant invoices/receipts (id, date, amount, status, hosted invoice + PDF URLs). Billing-admin only.
 *     tags:
 *       - Billing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Invoice list (empty array when no Stripe customer / billing disabled)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     invoices:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           created: { type: string, format: date-time, nullable: true }
 *                           amountDue: { type: integer, description: Amount in the smallest currency unit (cents) }
 *                           amountPaid: { type: integer, description: Amount in the smallest currency unit (cents) }
 *                           currency: { type: string, nullable: true }
 *                           status: { type: string, nullable: true }
 *                           hostedInvoiceUrl: { type: string, nullable: true }
 *                           pdfUrl: { type: string, nullable: true }
 */
router.get('/invoices', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);

    if (!tenant.stripe_customer_id || stripe?._disabled) {
      return res.json({ success: true, data: { invoices: [] } });
    }

    const invoices = await stripeService.listInvoices(tenant.stripe_customer_id);
    const data = invoices.map((inv) => ({
      id: inv.id,
      created: unixToIso(inv.created),
      amountDue: Number.isFinite(Number(inv.amount_due)) ? Number(inv.amount_due) : null,
      amountPaid: Number.isFinite(Number(inv.amount_paid)) ? Number(inv.amount_paid) : null,
      currency: inv.currency || null,
      status: inv.status || null,
      hostedInvoiceUrl: inv.hosted_invoice_url || null,
      pdfUrl: inv.invoice_pdf || null
    }));

    return res.json({ success: true, data: { invoices: data } });
  } catch (err) {
    return sendBillingError(res, 'Failed to load invoices', err);
  }
});

module.exports = router;
