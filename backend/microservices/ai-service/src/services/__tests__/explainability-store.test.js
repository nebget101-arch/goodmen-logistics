'use strict';

/**
 * FN-1176: Tests for explainability-store.
 * Runs standalone with `node`. No mocks needed.
 */

const assert = require('node:assert/strict');
const explainabilityStore = require('../explainability-store');

async function runCase(name, fn) {
  explainabilityStore.clearAll();
  try {
    await fn();
    // eslint-disable-next-line no-console
    console.log(`  ok  ${name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('explainability-store tests');

  await runCase('mint returns a token in expected format', () => {
    const token = explainabilityStore.mint({ kind: 'briefing-section' });
    assert.match(token, /^expl_[a-f0-9]{32}$/);
    assert.equal(explainabilityStore.size(), 1);
  });

  await runCase('isValidTokenFormat accepts minted tokens, rejects junk', () => {
    const token = explainabilityStore.mint({ kind: 'severity' });
    assert.equal(explainabilityStore.isValidTokenFormat(token), true);
    assert.equal(explainabilityStore.isValidTokenFormat('abc'), false);
    assert.equal(explainabilityStore.isValidTokenFormat('expl_short'), false);
    assert.equal(
      explainabilityStore.isValidTokenFormat('expl_GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG'),
      false
    );
    assert.equal(explainabilityStore.isValidTokenFormat(null), false);
    assert.equal(explainabilityStore.isValidTokenFormat(undefined), false);
    assert.equal(explainabilityStore.isValidTokenFormat(42), false);
  });

  await runCase('mint rejects non-object rationale', () => {
    assert.throws(() => explainabilityStore.mint(null), TypeError);
    assert.throws(() => explainabilityStore.mint('string'), TypeError);
    assert.throws(() => explainabilityStore.mint([1, 2, 3]), TypeError);
    assert.throws(() => explainabilityStore.mint(42), TypeError);
  });

  await runCase('get returns rationale + ISO timestamps for valid token', () => {
    const rationale = {
      kind: 'briefing-section',
      section: 'throughput',
      headline: '11 of 14 loads delivered'
    };
    const token = explainabilityStore.mint(rationale);
    const out = explainabilityStore.get(token);
    assert.ok(out);
    assert.deepEqual(out.rationale, rationale);
    assert.ok(typeof out.createdAt === 'string');
    assert.ok(typeof out.expiresAt === 'string');
    // ISO 8601 with Z suffix
    assert.match(out.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(out.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  await runCase('get returns null for unknown token', () => {
    const fake = 'expl_' + 'a'.repeat(32);
    assert.equal(explainabilityStore.get(fake), null);
  });

  await runCase('get returns null for malformed token', () => {
    assert.equal(explainabilityStore.get('not-a-token'), null);
    assert.equal(explainabilityStore.get(''), null);
    assert.equal(explainabilityStore.get(null), null);
  });

  await runCase('expired entries are evicted on read', () => {
    const t0 = 1_000_000_000_000;
    const token = explainabilityStore.mint({ kind: 'severity' }, { now: t0, ttlMs: 1000 });
    assert.ok(explainabilityStore.get(token, t0 + 500));
    assert.equal(explainabilityStore.get(token, t0 + 1500), null);
    // After eviction, store should not retain the entry
    assert.equal(explainabilityStore.size(), 0);
  });

  await runCase('default TTL is 30 days', () => {
    const t0 = 1_000_000_000_000;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const token = explainabilityStore.mint({ kind: 'severity' }, { now: t0 });
    // Just before expiry: still present
    assert.ok(explainabilityStore.get(token, t0 + thirtyDaysMs - 1));
    // At/after expiry: gone
    assert.equal(explainabilityStore.get(token, t0 + thirtyDaysMs), null);
    assert.equal(
      explainabilityStore.DEFAULT_TTL_MS,
      thirtyDaysMs,
      'DEFAULT_TTL_MS exported correctly'
    );
  });

  await runCase('mint generates unique tokens across calls', () => {
    const tokens = new Set();
    for (let i = 0; i < 50; i += 1) {
      tokens.add(explainabilityStore.mint({ kind: 'severity', i }));
    }
    assert.equal(tokens.size, 50);
    assert.equal(explainabilityStore.size(), 50);
  });

  await runCase('purgeExpired removes only expired entries', () => {
    const t0 = 1_000_000_000_000;
    const fresh = explainabilityStore.mint({ kind: 'a' }, { now: t0, ttlMs: 10_000 });
    const stale = explainabilityStore.mint({ kind: 'b' }, { now: t0, ttlMs: 100 });
    assert.equal(explainabilityStore.size(), 2);
    const removed = explainabilityStore.purgeExpired(t0 + 500);
    assert.equal(removed, 1);
    assert.equal(explainabilityStore.size(), 1);
    assert.ok(explainabilityStore.get(fresh, t0 + 500));
    assert.equal(explainabilityStore.get(stale, t0 + 500), null);
  });

  await runCase('clearAll empties the store', () => {
    explainabilityStore.mint({ kind: 'a' });
    explainabilityStore.mint({ kind: 'b' });
    assert.equal(explainabilityStore.size(), 2);
    explainabilityStore.clearAll();
    assert.equal(explainabilityStore.size(), 0);
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
