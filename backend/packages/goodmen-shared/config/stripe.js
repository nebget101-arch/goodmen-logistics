'use strict';

const dtLogger = require('../utils/logger');
const { VALID_PLAN_IDS, PLAN_PRICE_ENV_VARS, buildPlanPriceMap } = require('./plans');

/**
 * Stripe env vars that are required for billing/go-live, in addition to the
 * per-plan price IDs derived from `PLAN_PRICE_ENV_VARS`.
 */
const REQUIRED_STRIPE_ENV_VARS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const EXTRA_SEAT_PRICE_ENV_VAR = 'STRIPE_PRICE_EXTRA_USER_SEAT';

function isPresent(value) {
  return Boolean(String(value == null ? '' : value).trim());
}

/**
 * Inspect Stripe configuration without ever exposing secret values.
 * Returns a per-key present/absent map plus the list of missing keys, covering
 * the secret/webhook keys, every plan's price ID (PLAN_PRICE_MAP pattern), and
 * the extra-seat add-on price.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{ keys: Record<string, boolean>, missing: string[], missingPlans: string[], ok: boolean }}
 */
function getStripeConfigStatus(env = process.env) {
  const keys = {};

  for (const name of REQUIRED_STRIPE_ENV_VARS) {
    keys[name] = isPresent(env[name]);
  }

  const planPriceMap = buildPlanPriceMap(env);
  const missingPlans = [];
  for (const planId of VALID_PLAN_IDS) {
    const envVar = PLAN_PRICE_ENV_VARS[planId];
    const present = isPresent(planPriceMap[planId]);
    keys[envVar] = present;
    if (!present) missingPlans.push(planId);
  }

  keys[EXTRA_SEAT_PRICE_ENV_VAR] = isPresent(env[EXTRA_SEAT_PRICE_ENV_VAR]);

  const missing = Object.keys(keys).filter((k) => !keys[k]);
  return { keys, missing, missingPlans, ok: missing.length === 0 };
}

/**
 * Validate Stripe configuration on startup. Logs a clear warning listing any
 * missing keys but never throws — billing degrades gracefully (mirrors the
 * disabled-mock client below) instead of crashing the service.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {ReturnType<typeof getStripeConfigStatus>}
 */
function validateStripeConfig(env = process.env) {
  const status = getStripeConfigStatus(env);
  if (status.ok) {
    dtLogger.info('[stripe] configuration validated — all required keys present');
  } else {
    dtLogger.warn(
      `[stripe] configuration incomplete — missing keys: ${status.missing.join(', ')}. ` +
        'Affected billing features will be degraded until these are set.'
    );
  }
  return status;
}

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  dtLogger.warn('[stripe] STRIPE_SECRET_KEY is not configured. Stripe features are disabled.');
}

const stripe = secretKey
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : {
      _disabled: true,
      webhooks: {
        constructEvent() {
          throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is missing');
        }
      }
    };

// Preserve the existing default export (the Stripe client or disabled mock)
// while exposing the config-validation helpers as properties on it.
stripe.getStripeConfigStatus = getStripeConfigStatus;
stripe.validateStripeConfig = validateStripeConfig;
stripe.REQUIRED_STRIPE_ENV_VARS = REQUIRED_STRIPE_ENV_VARS;
stripe.EXTRA_SEAT_PRICE_ENV_VAR = EXTRA_SEAT_PRICE_ENV_VAR;

module.exports = stripe;
