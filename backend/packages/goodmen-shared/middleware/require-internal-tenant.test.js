'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createRequireInternalTenant } = require('./require-internal-tenant');

function fakeKnexReturning(row) {
  return function knex(tableName) {
    assert.equal(tableName, 'tenants');
    return {
      where(predicate) {
        this._predicate = predicate;
        return this;
      },
      first() {
        return Promise.resolve(row);
      },
    };
  };
}

function fakeKnexThrowing(err) {
  return function knex() {
    return {
      where() { return this; },
      first() { return Promise.reject(err); },
    };
  };
}

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

describe('requireInternalTenant', () => {
  it('allows the request when tenants.is_internal === true', async () => {
    const middleware = createRequireInternalTenant({
      knexClient: fakeKnexReturning({ is_internal: true }),
    });
    const req = { context: { tenantId: 't-1' } };
    const res = makeRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });

  it('returns 403 when tenants.is_internal === false', async () => {
    const middleware = createRequireInternalTenant({
      knexClient: fakeKnexReturning({ is_internal: false }),
    });
    const req = { context: { tenantId: 't-2' } };
    const res = makeRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /not a FleetNeuron-internal tenant/);
  });

  it('returns 403 when is_internal is null', async () => {
    const middleware = createRequireInternalTenant({
      knexClient: fakeKnexReturning({ is_internal: null }),
    });
    const req = { context: { tenantId: 't-3' } };
    const res = makeRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('returns 403 when no tenant row is found', async () => {
    const middleware = createRequireInternalTenant({
      knexClient: fakeKnexReturning(undefined),
    });
    const req = { context: { tenantId: 'missing' } };
    const res = makeRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('returns 403 when req.context.tenantId is missing', async () => {
    let queried = false;
    const middleware = createRequireInternalTenant({
      knexClient() { queried = true; return { where() { return this; }, first() { return Promise.resolve(null); } }; },
    });
    const req = {};
    const res = makeRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /tenant context missing/);
    assert.equal(queried, false, 'should short-circuit before querying the database');
  });

  it('returns 500 when the database lookup throws', async () => {
    const middleware = createRequireInternalTenant({
      knexClient: fakeKnexThrowing(new Error('boom')),
    });
    const req = { context: { tenantId: 't-x' } };
    const res = makeRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 500);
  });
});
