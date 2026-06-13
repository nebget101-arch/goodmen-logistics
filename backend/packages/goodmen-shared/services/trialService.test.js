'use strict';

/**
 * FN-1733 — Tests for trialService.ensureStripeCustomer (lazy Stripe customer
 * creation shared by trial activation and the billing endpoints).
 *
 * Uses an in-memory knex-shaped stub injected via setDatabase() (same spirit as
 * geofence-event-worker.test.js) plus method overrides on the real stripeService
 * module — no Postgres or Stripe needed. The DB is injected BEFORE requiring
 * trialService because trialService destructures `knex` from internal/db at load.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// ─── In-memory knex stub ─────────────────────────────────────────────────────
//
// `state[table]` is read fresh on every query so tests can reset rows between
// runs by reassigning `state.tenants`. update() mutates rows in place so a
// later first() observes the persisted change (used for persistence assertions).

function makeKnex(state) {
  function qb(table) {
    const preds = [];
    const builder = {
      where(conds) {
        preds.push((r) => Object.entries(conds).every(([k, v]) => r[k] === v));
        return builder;
      },
      whereNull(col) {
        preds.push((r) => r[col] === null || r[col] === undefined);
        return builder;
      },
      async first(cols) {
        const row = (state[table] || []).filter((r) => preds.every((p) => p(r)))[0];
        if (!row) return undefined;
        if (Array.isArray(cols) && cols.length) {
          const projected = {};
          for (const c of cols) projected[c] = row[c];
          return projected;
        }
        return { ...row };
      },
      async update(patch) {
        const rows = (state[table] || []).filter((r) => preds.every((p) => p(r)));
        for (const r of rows) Object.assign(r, patch);
        return rows.length;
      }
    };
    return builder;
  }
  const knex = (table) => qb(table);
  knex.fn = { now: () => '__now__' };
  return knex;
}

const state = { tenants: [] };

const shared = require('../index');
shared.setDatabase({ pool: null, query: async () => ({ rows: [] }), getClient: async () => null, knex: makeKnex(state) });

// Require AFTER the DB is injected (trialService captures knex at load time).
const stripeService = require('./stripeService');
const trialService = require('./trialService');

// ─── stripeService stubs ─────────────────────────────────────────────────────

let originalCreateCustomer;
let originalIsConfigured;
let createCustomerCalls;

beforeEach(() => {
  state.tenants = [];
  createCustomerCalls = [];
  originalCreateCustomer = stripeService.createCustomer;
  originalIsConfigured = stripeService.isStripeConfigured;
  stripeService.isStripeConfigured = () => true;
  stripeService.createCustomer = async (tenantId, email, name) => {
    createCustomerCalls.push({ tenantId, email, name });
    return { id: 'cus_new' };
  };
});

afterEach(() => {
  stripeService.createCustomer = originalCreateCustomer;
  stripeService.isStripeConfigured = originalIsConfigured;
});

// ─── ensureStripeCustomer ────────────────────────────────────────────────────

describe('trialService.ensureStripeCustomer', () => {
  it('returns the existing customer id without calling Stripe', async () => {
    state.tenants = [{ id: 't1', stripe_customer_id: 'cus_existing', email: 'a@b.com', legal_name: 'Acme', name: 'Acme' }];

    const id = await trialService.ensureStripeCustomer('t1');

    assert.strictEqual(id, 'cus_existing');
    assert.strictEqual(createCustomerCalls.length, 0);
  });

  it('creates the customer and persists it when absent', async () => {
    state.tenants = [{ id: 't1', stripe_customer_id: null, email: 'a@b.com', legal_name: 'Acme LLC', name: 'Acme' }];

    const id = await trialService.ensureStripeCustomer('t1');

    assert.strictEqual(id, 'cus_new');
    // Persisted to the tenant row.
    assert.strictEqual(state.tenants[0].stripe_customer_id, 'cus_new');
    // Stripe called exactly once with activateTrial's identity (email, legal_name).
    assert.strictEqual(createCustomerCalls.length, 1);
    assert.deepStrictEqual(createCustomerCalls[0], { tenantId: 't1', email: 'a@b.com', name: 'Acme LLC' });
  });

  it('falls back to legal_name then name when email is missing', async () => {
    state.tenants = [{ id: 't1', stripe_customer_id: null, email: null, legal_name: 'Legal Co', name: 'Display Co' }];

    await trialService.ensureStripeCustomer('t1');

    assert.deepStrictEqual(createCustomerCalls[0], { tenantId: 't1', email: 'Legal Co', name: 'Legal Co' });
  });

  it('is idempotent: a second call after creation does not create another customer', async () => {
    state.tenants = [{ id: 't1', stripe_customer_id: null, email: 'a@b.com', legal_name: 'Acme', name: 'Acme' }];

    const first = await trialService.ensureStripeCustomer('t1');
    const second = await trialService.ensureStripeCustomer('t1');

    assert.strictEqual(first, 'cus_new');
    assert.strictEqual(second, 'cus_new');
    assert.strictEqual(createCustomerCalls.length, 1);
  });

  it('is race-safe: if a concurrent caller wins the persist, returns the persisted id, not the orphan', async () => {
    state.tenants = [{ id: 't1', stripe_customer_id: null, email: 'a@b.com', legal_name: 'Acme', name: 'Acme' }];
    // Simulate a concurrent winner: the row gets a customer id set between our
    // create call and our conditional persist. Our create returns a different
    // (orphan) id; the whereNull update then claims 0 rows.
    stripeService.createCustomer = async (tenantId, email, name) => {
      createCustomerCalls.push({ tenantId, email, name });
      state.tenants[0].stripe_customer_id = 'cus_winner';
      return { id: 'cus_orphan' };
    };

    const id = await trialService.ensureStripeCustomer('t1');

    assert.strictEqual(id, 'cus_winner');
    assert.strictEqual(state.tenants[0].stripe_customer_id, 'cus_winner');
  });

  it('throws a clear 503 (not "not initialized") when Stripe is not configured', async () => {
    state.tenants = [{ id: 't1', stripe_customer_id: null, email: 'a@b.com', legal_name: 'Acme', name: 'Acme' }];
    stripeService.isStripeConfigured = () => false;

    await assert.rejects(
      () => trialService.ensureStripeCustomer('t1'),
      (err) => {
        assert.strictEqual(err.statusCode, 503);
        assert.strictEqual(err.code, 'STRIPE_NOT_CONFIGURED');
        assert.match(err.message, /not configured/i);
        assert.doesNotMatch(err.message, /not initialized/i);
        return true;
      }
    );
    assert.strictEqual(createCustomerCalls.length, 0);
  });

  it('throws 404 when the tenant does not exist', async () => {
    state.tenants = [];

    await assert.rejects(
      () => trialService.ensureStripeCustomer('missing'),
      (err) => {
        assert.strictEqual(err.statusCode, 404);
        return true;
      }
    );
  });

  it('throws 400 when tenantId is missing', async () => {
    await assert.rejects(
      () => trialService.ensureStripeCustomer(''),
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );
  });
});
