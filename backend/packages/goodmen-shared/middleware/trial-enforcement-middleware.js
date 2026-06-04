'use strict';

/**
 * FN-1694 (Story B / FN-1687) — Trial & payment access enforcement.
 *
 * Blocks a tenant's API access when its billing state says it should no longer
 * have it. Trial/payment state is already TRACKED on the `tenants` row (written
 * by trialService + the Stripe webhook) but was never ENFORCED — this middleware
 * is that gate. Mirrors `plan-access-middleware`: same per-route-group mounting,
 * same short read-through cache so the hot path costs one cached lookup.
 *
 * Block conditions (either one):
 *   1. `now > payment_grace_period_end` — a payment failed and the grace window
 *      set by the `invoice.payment_failed` webhook has elapsed. → PAYMENT_PAST_DUE
 *   2. `trial_status = 'expired'` AND no `stripe_payment_method_id` — the trial
 *      ended and the tenant never put a card on file. → TRIAL_EXPIRED_NO_PAYMENT_METHOD
 *
 * Response: a structured 402 (Payment Required) the frontend can branch on via
 * the machine-readable `code`. Deliberately NO internal detail (no dates, plan,
 * or Stripe ids) — no info leak; the app already knows the tenant's own billing
 * state through the billing endpoints.
 *
 * Exemptions:
 *   - super_admin / platform_admin (req.context.isGlobalAdmin, role fallback) —
 *     platform operators must never be locked out.
 *   - Billing/Stripe paths (so a blocked tenant can still reach the screens that
 *     let it pay and clear the block). These services don't host billing routes
 *     today, but the allowlist keeps the middleware safe to mount anywhere.
 *   - No tenant context (unauthenticated/public routes) — nothing to enforce.
 *
 * Failure mode: FAIL OPEN. If the state lookup throws (transient DB blip), we log
 * and call next() rather than 402 every tenant — a DB hiccup must not take paying
 * customers offline. plan-access makes the same fail-open choice for its lookup.
 */

// Lazily resolved so importing this module (e.g. in unit tests that inject their
// own knexClient) never pulls in the real DB pool.
let sharedKnex = null;
function getSharedKnex() {
  if (!sharedKnex) sharedKnex = require('../config/knex');
  return sharedKnex;
}

const STATE_CACHE_TTL_MS = 60 * 1000;
const tenantBillingStateCache = new Map();

// Default path prefixes that must stay reachable for a blocked tenant to recover.
const DEFAULT_EXEMPT_PREFIXES = ['/billing', '/stripe', '/account/billing', '/subscription'];

function normalizeForMatch(value) {
  return String(value || '').split('?')[0].split('#')[0].trim().toLowerCase();
}

function isExemptPath(req, exemptPrefixes) {
  // req.path is relative to the router mount; originalUrl is absolute. Check both
  // so the allowlist works regardless of where the middleware is mounted.
  const candidates = [normalizeForMatch(req.path), normalizeForMatch(req.originalUrl)];
  return exemptPrefixes.some((prefix) => {
    const p = normalizeForMatch(prefix);
    return candidates.some((c) => c === p || c.startsWith(`${p}/`) || c.includes(p));
  });
}

function isExemptRole(req) {
  if (req.context && req.context.isGlobalAdmin === true) return true;
  const role = String(req.user?.role || '').trim().toLowerCase();
  return role === 'super_admin' || role === 'platform_admin';
}

async function getTenantBillingState(knexClient, tenantId) {
  const now = Date.now();
  const cached = tenantBillingStateCache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    return cached.state;
  }

  const tenant = await knexClient('tenants')
    .where({ id: tenantId })
    .first('trial_status', 'payment_grace_period_end', 'stripe_payment_method_id');

  const state = {
    trialStatus: tenant?.trial_status || null,
    gracePeriodEnd: tenant?.payment_grace_period_end || null,
    hasPaymentMethod: !!tenant?.stripe_payment_method_id
  };
  tenantBillingStateCache.set(tenantId, { state, expiresAt: now + STATE_CACHE_TTL_MS });
  return state;
}

/**
 * Decide whether a tenant is blocked. Returns a reason code string or null.
 * `nowMs` is injectable for tests.
 */
function evaluateBlock(state, nowMs = Date.now()) {
  if (!state) return null;

  if (state.gracePeriodEnd) {
    const graceEndMs = new Date(state.gracePeriodEnd).getTime();
    if (Number.isFinite(graceEndMs) && nowMs > graceEndMs) {
      return 'PAYMENT_PAST_DUE';
    }
  }

  if (state.trialStatus === 'expired' && !state.hasPaymentMethod) {
    return 'TRIAL_EXPIRED_NO_PAYMENT_METHOD';
  }

  return null;
}

function createTrialEnforcementMiddleware(options = {}) {
  const {
    knexClient = null,
    exemptPathPrefixes = DEFAULT_EXEMPT_PREFIXES,
    denyStatusCode = 402
  } = options;

  return async function trialEnforcementMiddleware(req, res, next) {
    try {
      const tenantId = req.context?.tenantId || req.user?.tenant_id || null;
      if (!tenantId) return next(); // unauthenticated / public route — nothing to enforce
      if (isExemptRole(req)) return next(); // platform operators are never blocked
      if (isExemptPath(req, exemptPathPrefixes)) return next(); // keep the "pay now" path open

      const state = await getTenantBillingState(knexClient || getSharedKnex(), tenantId);
      const reason = evaluateBlock(state);
      if (!reason) return next();

      return res.status(denyStatusCode).json({
        success: false,
        error: 'Your subscription is inactive. Update your billing details to restore access.',
        code: reason,
        action: 'UPDATE_BILLING'
      });
    } catch (err) {
      // Fail OPEN: a transient lookup failure must not lock out paying tenants.
      console.warn('[trial-enforcement-middleware] state check failed; allowing request', err?.message || err);
      return next();
    }
  };
}

/** Test/ops helper — drop cached billing state (e.g. after a webhook updates a tenant). */
function clearTenantBillingStateCache(tenantId) {
  if (tenantId) tenantBillingStateCache.delete(tenantId);
  else tenantBillingStateCache.clear();
}

module.exports = createTrialEnforcementMiddleware;
module.exports.createTrialEnforcementMiddleware = createTrialEnforcementMiddleware;
module.exports.evaluateBlock = evaluateBlock;
module.exports.clearTenantBillingStateCache = clearTenantBillingStateCache;
