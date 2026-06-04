'use strict';

/**
 * FN-1694 — Tests for trial-enforcement-middleware.
 *
 * Covers the pure block decision (evaluateBlock) and the middleware's gate
 * behavior with an injected fake knex: exemptions (no tenant / super_admin /
 * billing path), block → 402 with machine-readable code, allow → next(), and
 * fail-open when the state lookup throws.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const createTrialEnforcementMiddleware = require('./trial-enforcement-middleware');
const { evaluateBlock, clearTenantBillingStateCache } = require('./trial-enforcement-middleware');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal knex stub: knexClient('tenants').where({id}).first(...) → resolves row. */
function fakeKnex(rowByTenantId, { throwOnQuery = false } = {}) {
  return function tenants() {
    let whereId = null;
    const builder = {
      where(obj) { whereId = obj && obj.id; return builder; },
      first() {
        if (throwOnQuery) return Promise.reject(new Error('db down'));
        return Promise.resolve(rowByTenantId[whereId] || null);
      }
    };
    return builder;
  };
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

describe('evaluateBlock', () => {
  const now = Date.now();

  it('allows an active trial with no grace period', () => {
    assert.equal(evaluateBlock({ trialStatus: 'active', gracePeriodEnd: null, hasPaymentMethod: false }, now), null);
  });

  it('blocks PAYMENT_PAST_DUE when grace period has elapsed', () => {
    const state = { trialStatus: 'converted', gracePeriodEnd: new Date(now - DAY_MS), hasPaymentMethod: true };
    assert.equal(evaluateBlock(state, now), 'PAYMENT_PAST_DUE');
  });

  it('allows when grace period is still in the future', () => {
    const state = { trialStatus: 'converted', gracePeriodEnd: new Date(now + DAY_MS), hasPaymentMethod: true };
    assert.equal(evaluateBlock(state, now), null);
  });

  it('blocks TRIAL_EXPIRED_NO_PAYMENT_METHOD when expired with no card', () => {
    assert.equal(
      evaluateBlock({ trialStatus: 'expired', gracePeriodEnd: null, hasPaymentMethod: false }, now),
      'TRIAL_EXPIRED_NO_PAYMENT_METHOD'
    );
  });

  it('allows an expired trial that has a card on file', () => {
    assert.equal(evaluateBlock({ trialStatus: 'expired', gracePeriodEnd: null, hasPaymentMethod: true }, now), null);
  });

  it('prioritizes past-due grace over trial status', () => {
    const state = { trialStatus: 'expired', gracePeriodEnd: new Date(now - 1000), hasPaymentMethod: false };
    assert.equal(evaluateBlock(state, now), 'PAYMENT_PAST_DUE');
  });
});

describe('trialEnforcementMiddleware', () => {
  beforeEach(() => clearTenantBillingStateCache());

  function run(mw, req) {
    const res = mockRes();
    let nextCalled = false;
    return mw(req, res, () => { nextCalled = true; }).then(() => ({ res, nextCalled }));
  }

  it('passes through when there is no tenant context (public route)', async () => {
    const mw = createTrialEnforcementMiddleware({ knexClient: fakeKnex({}) });
    const { nextCalled } = await run(mw, { path: '/loads', context: {} });
    assert.equal(nextCalled, true);
  });

  it('exempts super_admin (isGlobalAdmin)', async () => {
    const mw = createTrialEnforcementMiddleware({
      knexClient: fakeKnex({ t1: { trial_status: 'expired', payment_grace_period_end: null, stripe_payment_method_id: null } })
    });
    const { nextCalled, res } = await run(mw, { path: '/loads', context: { tenantId: 't1', isGlobalAdmin: true } });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });

  it('exempts billing paths so a blocked tenant can still pay', async () => {
    const mw = createTrialEnforcementMiddleware({
      knexClient: fakeKnex({ t1: { trial_status: 'expired', payment_grace_period_end: null, stripe_payment_method_id: null } })
    });
    const { nextCalled } = await run(mw, { path: '/billing/portal', originalUrl: '/api/billing/portal', context: { tenantId: 't1' } });
    assert.equal(nextCalled, true);
  });

  it('blocks an expired-no-card tenant with a 402 + machine-readable code', async () => {
    const mw = createTrialEnforcementMiddleware({
      knexClient: fakeKnex({ t1: { trial_status: 'expired', payment_grace_period_end: null, stripe_payment_method_id: null } })
    });
    const { nextCalled, res } = await run(mw, { path: '/loads', context: { tenantId: 't1' } });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.code, 'TRIAL_EXPIRED_NO_PAYMENT_METHOD');
    assert.equal(res.body.success, false);
    // No info leak — only the safe fields.
    assert.deepEqual(Object.keys(res.body).sort(), ['action', 'code', 'error', 'success']);
  });

  it('allows a healthy tenant', async () => {
    const mw = createTrialEnforcementMiddleware({
      knexClient: fakeKnex({ t2: { trial_status: 'converted', payment_grace_period_end: null, stripe_payment_method_id: 'pm_1' } })
    });
    const { nextCalled, res } = await run(mw, { path: '/loads', context: { tenantId: 't2' } });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });

  it('fails OPEN when the state lookup throws', async () => {
    const mw = createTrialEnforcementMiddleware({ knexClient: fakeKnex({}, { throwOnQuery: true }) });
    const { nextCalled, res } = await run(mw, { path: '/loads', context: { tenantId: 't3' } });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });
});
