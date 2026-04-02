'use strict';

const express = require('express');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const rbacService = require('@goodmen/shared/services/rbac-service');
const knex = require('@goodmen/shared/config/knex');
const stripe = require('@goodmen/shared/config/stripe');
const stripeService = require('@goodmen/shared/services/stripeService');
const trialService = require('@goodmen/shared/services/trialService');
const extraSeatSyncService = require('@goodmen/shared/services/extraSeatSyncService');
const { PLANS, normalizePlanId } = require('@goodmen/shared/config/plans');

const BILLING_ADMIN_ROLES = new Set(['super_admin', 'admin', 'company_admin']);

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
 *       400:
 *         description: Stripe customer not initialized for this tenant
 */
router.post('/setup-intent', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);

    if (!tenant.stripe_customer_id) {
      return res.status(400).json({
        success: false,
        error: 'Stripe customer is not initialized for this tenant'
      });
    }

    const setupIntent = await stripeService.createSetupIntent(tenant.stripe_customer_id);

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
 *         description: Missing paymentMethodId or Stripe customer not initialized
 */
router.post('/payment-method/confirm', async (req, res) => {
  try {
    const tenant = await getTenantForRequest(req);
    const paymentMethodId = String(req.body?.paymentMethodId || '').trim();

    if (!paymentMethodId) {
      return res.status(400).json({ success: false, error: 'paymentMethodId is required' });
    }

    if (!tenant.stripe_customer_id) {
      return res.status(400).json({ success: false, error: 'Stripe customer is not initialized for this tenant' });
    }

    await stripeService.attachPaymentMethod(tenant.stripe_customer_id, paymentMethodId);

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

module.exports = router;
