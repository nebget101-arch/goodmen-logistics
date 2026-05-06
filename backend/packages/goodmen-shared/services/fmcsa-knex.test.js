const assert = require('node:assert/strict');
const { describe, it, after } = require('node:test');

const { getFmcsaKnex } = require('./fmcsa-knex');
const mainKnex = require('../config/knex');

describe('fmcsa-knex accessor', () => {
  it('returns an object exposing the Knex query API', () => {
    const k = getFmcsaKnex();
    assert.ok(k, 'expected a Knex instance');
    assert.equal(typeof k.raw, 'function');
    assert.equal(typeof k.select, 'function');
    assert.equal(typeof k.transaction, 'function');
    assert.ok(k.client, 'expected a Knex client');
  });

  it('returns the same instance on repeated calls (Phase 1: shared with main DB)', () => {
    assert.strictEqual(getFmcsaKnex(), getFmcsaKnex());
    assert.strictEqual(getFmcsaKnex(), mainKnex);
  });

  it('runs a SELECT 1 round-trip against the database', async (t) => {
    const k = getFmcsaKnex();
    try {
      const result = await k.raw('SELECT 1 AS value');
      const value = Array.isArray(result?.rows) ? result.rows[0]?.value : undefined;
      assert.equal(Number(value), 1);
    } catch (err) {
      // Local dev environments without Postgres are allowed to skip this assertion;
      // FN-1419 covers the live-DB smoke for this accessor.
      if (err && /ECONNREFUSED|ENOTFOUND|password authentication|database .* does not exist/i.test(err.message)) {
        t.skip(`no database available for SELECT 1 smoke (${err.code || err.message})`);
        return;
      }
      throw err;
    }
  });

  after(async () => {
    // Release the shared connection pool so node:test can exit. node --test runs each
    // file in its own process, so destroying here does not affect other test files.
    await mainKnex.destroy();
  });
});
