'use strict';

const express = require('express');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const knex = require('@goodmen/shared/config/knex');
const stripeService = require('@goodmen/shared/services/stripeService');
const trialService = require('@goodmen/shared/services/trialService');
const { PLANS } = require('@goodmen/shared/config/plans');

const router = express.Router();

router.use(authMiddleware, tenantContextMiddleware);

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
      'trial_status',
      'trial_start',
      'trial_end'
    ]);

  if (!tenant) {
    const err = new Error('Tenant not found');
    err.statusCode = 404;
    throw err;
  }

  return tenant;
}

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
