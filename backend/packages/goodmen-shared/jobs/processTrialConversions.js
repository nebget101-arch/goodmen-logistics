'use strict';

const { knex } = require('../internal/db');
const stripeService = require('./stripeService');
const trialService = require('./trialService');
const dtLogger = require('../utils/logger');

/**
 * Mapping of subscription plan IDs to their corresponding Stripe Price IDs.
 * Environment variables follow the pattern: STRIPE_PRICE_[PLAN_ID_UPPERCASE]
 */
const PLAN_PRICE_MAP = {
  basic: process.env.STRIPE_PRICE_BASIC,
  multi_mc: process.env.STRIPE_PRICE_MULTI_MC,
  end_to_end: process.env.STRIPE_PRICE_END_TO_END,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE
};

/**
 * Process trial conversions: for each tenant with an expired trial,
 * either create a subscription (if card on file) or expire the trial (if no card).
 * Runs daily at midnight UTC.
 */
async function processTrialConversions() {
  const startTime = Date.now();

  try {
    dtLogger.info('[trial-conversions] job started');

    // Query for all tenants with active trials that have expired
    const expiredTrials = await knex('tenants')
      .where('trial_status', 'active')
      .whereRaw('trial_end <= NOW()')
      .select('id', 'subscription_plan', 'stripe_customer_id', 'stripe_payment_method_id', 'trial_end');

    if (expiredTrials.length === 0) {
      dtLogger.info('[trial-conversions] no expired trials found');
      return;
    }

    dtLogger.info('[trial-conversions] processing', { count: expiredTrials.length });

    let successCount = 0;
    let expiredCount = 0;
    let errorCount = 0;

    for (const tenant of expiredTrials) {
      try {
        if (tenant.stripe_payment_method_id && tenant.stripe_customer_id) {
          // ── Tenant has a card on file: create a subscription ──
          await processTrialWithCard(tenant);
          successCount++;
        } else {
          // ── No card on file: expire the trial ──
          await trialService.expireTrial(tenant.id, null);
          expiredCount++;

          dtLogger.info('[trial-conversions] trial expired (no card)', { tenantId: tenant.id });
        }
      } catch (err) {
        errorCount++;
        dtLogger.error('[trial-conversions] tenant conversion failed', err, {
          tenantId: tenant.id,
          error: err?.message
        });
      }
    }

    const duration = Date.now() - startTime;
    dtLogger.info('[trial-conversions] job completed', {
      total: expiredTrials.length,
      subscriptionsCreated: successCount,
      trialsExpired: expiredCount,
      errors: errorCount,
      durationMs: duration
    });
  } catch (err) {
    dtLogger.error('[trial-conversions] job failure', err, { error: err?.message });
  }
}

/**
 * Create a subscription for a tenant with a card on file.
 * @private
 */
async function processTrialWithCard(tenant) {
  const { id: tenantId, subscription_plan: planId, stripe_customer_id: customerId } = tenant;

  const stripePriceId = PLAN_PRICE_MAP[planId];
  if (!stripePriceId) {
    throw new Error(`No STRIPE_PRICE_* env var found for plan: ${planId}`);
  }

  // Create the subscription
  const subscription = await stripeService.createSubscription(customerId, stripePriceId);

  // Mark the trial as converted in the database
  await trialService.markConverted(tenantId, subscription.id, null);

  dtLogger.info('[trial-conversions] subscription created', {
    tenantId,
    subscriptionId: subscription.id,
    plan: planId
  });
}

/**
 * Start the daily trial conversion job at midnight UTC.
 * Retries every 24 hours.
 */
function startTrialConversionJob() {
  // Calculate milliseconds until next midnight UTC
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  const initialDelayMs = nextMidnight.getTime() - now.getTime();

  dtLogger.info('[trial-conversions] job scheduled', {
    nextRunIn: Math.round(initialDelayMs / 1000 / 60) + ' minutes'
  });

  // Run once at the next midnight
  setTimeout(() => {
    processTrialConversions();
    // Then run every 24 hours
    setInterval(() => {
      processTrialConversions();
    }, 24 * 60 * 60 * 1000);
  }, initialDelayMs);
}

module.exports = {
  processTrialConversions,
  startTrialConversionJob
};
