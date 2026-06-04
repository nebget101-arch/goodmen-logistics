'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { getStripeConfigStatus } = require('./stripe');
const { buildPlanPriceMap, VALID_PLAN_IDS, PLAN_PRICE_ENV_VARS } = require('./plans');

const FULL_ENV = {
  STRIPE_SECRET_KEY: 'sk_live_abc',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc',
  STRIPE_PRICE_BASIC: 'price_basic',
  STRIPE_PRICE_MULTI_MC: 'price_multi',
  STRIPE_PRICE_END_TO_END: 'price_e2e',
  STRIPE_PRICE_ENTERPRISE: 'price_ent',
  STRIPE_PRICE_EXTRA_USER_SEAT: 'price_seat'
};

describe('plans.buildPlanPriceMap', () => {
  it('maps every plan id to its STRIPE_PRICE_* env var', () => {
    const map = buildPlanPriceMap(FULL_ENV);
    assert.deepEqual(Object.keys(map).sort(), [...VALID_PLAN_IDS].sort());
    assert.equal(map.basic, 'price_basic');
    assert.equal(map.enterprise, 'price_ent');
  });

  it('resolves missing plan prices to undefined', () => {
    const map = buildPlanPriceMap({ STRIPE_PRICE_BASIC: 'price_basic' });
    assert.equal(map.basic, 'price_basic');
    assert.equal(map.multi_mc, undefined);
  });

  it('covers all plan ids in PLAN_PRICE_ENV_VARS', () => {
    for (const planId of VALID_PLAN_IDS) {
      assert.ok(PLAN_PRICE_ENV_VARS[planId], `missing env var mapping for plan ${planId}`);
    }
  });
});

describe('stripe.getStripeConfigStatus', () => {
  it('reports ok when every required key is present', () => {
    const status = getStripeConfigStatus(FULL_ENV);
    assert.equal(status.ok, true);
    assert.deepEqual(status.missing, []);
    assert.deepEqual(status.missingPlans, []);
    assert.equal(status.keys.STRIPE_SECRET_KEY, true);
    assert.equal(status.keys.STRIPE_PRICE_EXTRA_USER_SEAT, true);
  });

  it('lists missing keys and missing plans when env is empty', () => {
    const status = getStripeConfigStatus({});
    assert.equal(status.ok, false);
    assert.ok(status.missing.includes('STRIPE_SECRET_KEY'));
    assert.ok(status.missing.includes('STRIPE_WEBHOOK_SECRET'));
    assert.ok(status.missing.includes('STRIPE_PRICE_EXTRA_USER_SEAT'));
    assert.deepEqual([...status.missingPlans].sort(), [...VALID_PLAN_IDS].sort());
  });

  it('treats blank/whitespace values as absent', () => {
    const status = getStripeConfigStatus({ ...FULL_ENV, STRIPE_PRICE_BASIC: '   ' });
    assert.equal(status.keys.STRIPE_PRICE_BASIC, false);
    assert.equal(status.ok, false);
    assert.deepEqual(status.missing, ['STRIPE_PRICE_BASIC']);
    assert.deepEqual(status.missingPlans, ['basic']);
  });

  it('only ever returns booleans for keys — never the secret values', () => {
    const status = getStripeConfigStatus(FULL_ENV);
    for (const [name, value] of Object.entries(status.keys)) {
      assert.equal(typeof value, 'boolean', `key ${name} should be a boolean`);
    }
    const serialized = JSON.stringify(status);
    assert.ok(!serialized.includes('sk_live_abc'));
    assert.ok(!serialized.includes('price_basic'));
  });
});
