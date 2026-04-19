'use strict';

/**
 * Unit tests for pure helpers used by the inbound-email webhook.
 * DB-touching functions (load creation, tenant resolution, notifications)
 * are covered separately by QA integration tests in FN-763.
 *
 * Run:
 *   cd backend/microservices/integrations-service
 *   node --test services/inbound-email-service.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAddress,
  parseToAddresses,
  buildLoc,
  normalizeDate,
  verifyWebhookSecret
} = require('./inbound-email-helpers');

describe('parseAddress', () => {
  it('extracts bare address from angle brackets', () => {
    assert.equal(
      parseAddress('FleetOps <ops@fleetneuron.ai>'),
      'ops@fleetneuron.ai'
    );
  });

  it('accepts plain email', () => {
    assert.equal(parseAddress('ops@fleetneuron.ai'), 'ops@fleetneuron.ai');
  });

  it('lowercases the result', () => {
    assert.equal(parseAddress('OPS@FleetNeuron.AI'), 'ops@fleetneuron.ai');
  });

  it('returns null when no email present', () => {
    assert.equal(parseAddress(''), null);
    assert.equal(parseAddress('just a name'), null);
    assert.equal(parseAddress(null), null);
  });
});

describe('parseToAddresses', () => {
  it('handles comma-separated recipients with display names', () => {
    const result = parseToAddresses(
      'FleetOps <ops@fleetneuron.ai>, Dispatch <d@f.com>'
    );
    assert.deepEqual(result, ['ops@fleetneuron.ai', 'd@f.com']);
  });

  it('handles a single plain address', () => {
    assert.deepEqual(parseToAddresses('loads@example.com'), [
      'loads@example.com'
    ]);
  });

  it('filters out garbage segments', () => {
    assert.deepEqual(parseToAddresses('garbage, loads@a.com'), ['loads@a.com']);
  });

  it('returns empty array when input is falsy', () => {
    assert.deepEqual(parseToAddresses(''), []);
    assert.deepEqual(parseToAddresses(null), []);
  });
});

describe('buildLoc', () => {
  it('joins city/state with zip suffix', () => {
    assert.equal(
      buildLoc({ city: 'Dallas', state: 'TX', zip: '75201' }),
      'Dallas, TX 75201'
    );
  });

  it('returns UNKNOWN when all fields empty', () => {
    assert.equal(buildLoc({}), 'UNKNOWN');
  });

  it('handles zip-only input', () => {
    assert.equal(buildLoc({ zip: '10001' }), '10001');
  });
});

describe('normalizeDate', () => {
  it('trims to ten chars (YYYY-MM-DD)', () => {
    assert.equal(normalizeDate('2026-04-18T10:00:00Z', '2026-04-20'), '2026-04-18');
  });

  it('returns fallback when input empty', () => {
    assert.equal(normalizeDate('', '2026-04-20'), '2026-04-20');
    assert.equal(normalizeDate(null, '2026-04-20'), '2026-04-20');
  });
});

describe('verifyWebhookSecret', () => {
  it('skips verification when no secret is configured', () => {
    const prev = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    try {
      const result = verifyWebhookSecret({ headers: {}, query: {} });
      assert.equal(result.ok, true);
      assert.equal(result.reason, 'no_secret_configured');
    } finally {
      if (prev !== undefined) process.env.INBOUND_EMAIL_WEBHOOK_SECRET = prev;
    }
  });

  it('accepts matching secret in header', () => {
    const prev = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = 'sekret-123';
    try {
      const result = verifyWebhookSecret({
        headers: { 'x-webhook-secret': 'sekret-123' },
        query: {}
      });
      assert.equal(result.ok, true);
    } finally {
      if (prev === undefined) delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
      else process.env.INBOUND_EMAIL_WEBHOOK_SECRET = prev;
    }
  });

  it('rejects mismatched secret', () => {
    const prev = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = 'sekret-123';
    try {
      const result = verifyWebhookSecret({
        headers: { 'x-webhook-secret': 'wrong' },
        query: {}
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'bad_secret');
    } finally {
      if (prev === undefined) delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
      else process.env.INBOUND_EMAIL_WEBHOOK_SECRET = prev;
    }
  });

  it('rejects length-mismatched provided secret', () => {
    const prev = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = 'sekret-123';
    try {
      const result = verifyWebhookSecret({
        headers: { 'x-webhook-secret': 'short' },
        query: {}
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'bad_secret');
    } finally {
      if (prev === undefined) delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
      else process.env.INBOUND_EMAIL_WEBHOOK_SECRET = prev;
    }
  });

  it('rejects missing secret when env var is set', () => {
    const prev = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = 'sekret-123';
    try {
      const result = verifyWebhookSecret({ headers: {}, query: {} });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'missing_secret');
    } finally {
      if (prev === undefined) delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
      else process.env.INBOUND_EMAIL_WEBHOOK_SECRET = prev;
    }
  });
});
