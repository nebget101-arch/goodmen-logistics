'use strict';

/**
 * FN-800: Tests for loads-nlq-handler.
 * Runs standalone with `node`. No jest/mocha required.
 * The Anthropic client is mocked via deps.anthropic so no real API calls are made.
 */

const assert = require('node:assert/strict');
const {
  handleLoadsNlq,
  ALLOWED_FILTERS,
  validateFilters
} = require('../loads-nlq-handler');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function makeMockAnthropic(modelOutputObj) {
  return {
    messages: {
      create: async () => ({
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: JSON.stringify(modelOutputObj) }]
      })
    }
  };
}

function makeBrokenAnthropic(rawText) {
  return {
    messages: {
      create: async () => ({
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: rawText }]
      })
    }
  };
}

async function runCase(name, { query, modelOutput, rawText, expect }) {
  const res = makeRes();
  const deps = {
    anthropic: rawText != null
      ? makeBrokenAnthropic(rawText)
      : makeMockAnthropic(modelOutput)
  };
  await handleLoadsNlq({ body: { query } }, res, deps);
  try {
    expect(res);
    // eslint-disable-next-line no-console
    console.log(`  ok  ${name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${name}`);
    // eslint-disable-next-line no-console
    console.error('       response:', JSON.stringify(res.body));
    throw err;
  }
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('loads-nlq-handler tests');

  assert.ok(ALLOWED_FILTERS && typeof ALLOWED_FILTERS === 'object');
  assert.ok(Object.isFrozen(ALLOWED_FILTERS));

  await runCase("query 1 - Smith's pending loads over $1000", {
    query: "Smith's pending loads over $1000",
    modelOutput: {
      driver_name: 'Smith',
      billing_status: 'PENDING',
      rate_min: 1000
    },
    expect: (res) => {
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.fallback, false);
      assert.deepEqual(res.body.filters, {
        driver_name: 'Smith',
        billing_status: 'PENDING',
        rate_min: 1000
      });
      assert.ok(res.body.meta.model);
      assert.equal(typeof res.body.meta.processingTimeMs, 'number');
    }
  });

  await runCase('query 2 - delivered loads from TX to FL last month', {
    query: 'delivered loads from TX to FL last month',
    modelOutput: {
      status: 'DELIVERED',
      pickup_state: 'TX',
      delivery_state: 'FL',
      date_from: '2026-03-01',
      date_to: '2026-03-31'
    },
    expect: (res) => {
      assert.equal(res.body.success, true);
      assert.deepEqual(res.body.filters, {
        status: 'DELIVERED',
        pickup_state: 'TX',
        delivery_state: 'FL',
        date_from: '2026-03-01',
        date_to: '2026-03-31'
      });
    }
  });

  await runCase('query 3 - loads for broker CH Robinson under $2500', {
    query: 'loads for broker CH Robinson under $2500',
    modelOutput: {
      broker_name: 'CH Robinson',
      rate_max: 2500
    },
    expect: (res) => {
      assert.deepEqual(res.body.filters, {
        broker_name: 'CH Robinson',
        rate_max: 2500
      });
    }
  });

  await runCase('query 4 - load number ABC-123', {
    query: 'load number ABC-123',
    modelOutput: { load_number: 'ABC-123' },
    expect: (res) => {
      assert.deepEqual(res.body.filters, { load_number: 'ABC-123' });
    }
  });

  await runCase('query 5 - gibberish returns fallback', {
    query: 'random gibberish asdfjkl',
    modelOutput: {},
    expect: (res) => {
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.fallback, true);
      assert.equal(res.body.meta.reason, 'no_filters_extracted');
      assert.equal(res.body.filters, undefined);
    }
  });

  await runCase('validator drops unknown fields', {
    query: "Smith's loads",
    modelOutput: {
      driver_name: 'Smith',
      unknown_field: 'x',
      bogus: 42
    },
    expect: (res) => {
      assert.deepEqual(res.body.filters, { driver_name: 'Smith' });
      assert.equal(Object.prototype.hasOwnProperty.call(res.body.filters, 'unknown_field'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(res.body.filters, 'bogus'), false);
    }
  });

  await runCase('unparseable model output returns fallback', {
    query: 'anything',
    rawText: 'not json at all, just prose',
    expect: (res) => {
      assert.equal(res.body.success, true);
      assert.equal(res.body.fallback, true);
      assert.equal(res.body.meta.reason, 'unparseable_model_output');
    }
  });

  {
    const res = makeRes();
    await handleLoadsNlq({ body: {} }, res, { anthropic: makeMockAnthropic({}) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  missing query returns 400');
  }

  {
    const res = makeRes();
    await handleLoadsNlq({ body: { query: 123 } }, res, { anthropic: makeMockAnthropic({}) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  non-string query returns 400');
  }

  {
    const out = validateFilters({
      billing_status: 'not-a-status',
      status: 'delivered',
      pickup_state: 'tx',
      delivery_state: 'usa',
      rate_min: -5,
      rate_max: '2500',
      date_from: '2025-13-40',
      date_to: '2025-01-15',
      driver_name: '   ',
      load_number: 'X'
    });
    assert.deepEqual(out, {
      status: 'DELIVERED',
      pickup_state: 'TX',
      rate_max: 2500,
      date_to: '2025-01-15',
      load_number: 'X'
    });
    // eslint-disable-next-line no-console
    console.log('  ok  validator normalises and drops bad values');
  }

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
