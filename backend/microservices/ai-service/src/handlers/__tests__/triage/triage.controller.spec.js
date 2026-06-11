'use strict';

/**
 * FN-1215: Unit tests for triage.controller.js
 * Runs standalone with `node`.
 * Mocks the Anthropic client via deps.anthropic so no real API calls are made.
 */

const assert = require('node:assert/strict');
const { handleRoadsideTriage } = require('../../../triage/triage.controller');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

function makeReq(body) {
  return { body: body || {} };
}

function makeSuccessAnthropic() {
  const record = {
    severity: 'HIGH',
    serviceCategory: 'TOWING',
    urgency: 'WITHIN_HOUR',
    vendorSkills: ['heavy_tow'],
    rationale: 'Disabled on highway.',
    safetyRisk: false
  };
  return {
    messages: {
      create: async () => ({
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: JSON.stringify(record) }],
        usage: { cache_read_input_tokens: 200, cache_creation_input_tokens: 0, input_tokens: 80, output_tokens: 40 }
      })
    }
  };
}

function makeParseErrorAnthropic() {
  return {
    messages: {
      create: async () => ({
        model: 'x',
        content: [{ type: 'text', text: 'not valid json {{' }],
        usage: {}
      })
    }
  };
}

function makeUpstreamErrorAnthropic() {
  return {
    messages: {
      create: async () => { throw Object.assign(new Error('upstream'), { status: 503 }); }
    }
  };
}

async function runTests() {
  // 400 — missing tenantId
  {
    const req = makeReq({ description: 'flat tire' });
    const res = makeRes();
    await handleRoadsideTriage(req, res, {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'TRIAGE_BAD_REQUEST');
    assert.ok(res.body.error.includes('tenantId'));
    console.log('PASS: 400 when tenantId missing');
  }

  // 400 — missing description
  {
    const req = makeReq({ tenantId: 't1' });
    const res = makeRes();
    await handleRoadsideTriage(req, res, {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'TRIAGE_BAD_REQUEST');
    assert.ok(res.body.error.includes('description'));
    console.log('PASS: 400 when description missing');
  }

  // 400 — empty string body
  {
    const req = makeReq({});
    const res = makeRes();
    await handleRoadsideTriage(req, res, {});
    assert.equal(res.statusCode, 400);
    console.log('PASS: 400 for empty body');
  }

  // 200 — happy path
  {
    const deps = { anthropic: makeSuccessAnthropic() };
    const req = makeReq({ tenantId: 't1', description: 'driver reports blown tire', vehicleType: 'semi' });
    const res = makeRes();
    await handleRoadsideTriage(req, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.severity, 'HIGH');
    assert.equal(res.body.data.serviceCategory, 'TOWING');
    assert.ok(typeof res.body.data.latency_ms === 'number');
    assert.ok(typeof res.body.data.prompt_version === 'string');
    console.log('PASS: 200 with valid triage record');
  }

  // 502 — parse error from bad model output
  {
    const deps = { anthropic: makeParseErrorAnthropic() };
    const req = makeReq({ tenantId: 't1', description: 'stalled' });
    const res = makeRes();
    await handleRoadsideTriage(req, res, deps);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'TRIAGE_PARSE_ERROR');
    console.log('PASS: 502 with TRIAGE_PARSE_ERROR code');
  }

  // 502 — upstream error
  {
    const deps = { anthropic: makeUpstreamErrorAnthropic() };
    const req = makeReq({ tenantId: 't1', description: 'stalled' });
    const res = makeRes();
    await handleRoadsideTriage(req, res, deps);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'TRIAGE_UPSTREAM_ERROR');
    console.log('PASS: 502 with TRIAGE_UPSTREAM_ERROR on generic error');
  }

  // Whitespace trimmed
  {
    const deps = { anthropic: makeSuccessAnthropic() };
    const req = makeReq({ tenantId: '  t1  ', description: '  flat tire  ' });
    const res = makeRes();
    await handleRoadsideTriage(req, res, deps);
    assert.equal(res.statusCode, 200);
    console.log('PASS: trims whitespace from tenantId and description');
  }

  // Optional vehicleType and location forwarded
  {
    const deps = { anthropic: makeSuccessAnthropic() };
    const req = makeReq({ tenantId: 't1', description: 'stalled', vehicleType: 'pickup', location: 'I-35' });
    const res = makeRes();
    await handleRoadsideTriage(req, res, deps);
    assert.equal(res.statusCode, 200);
    console.log('PASS: optional vehicleType and location forwarded');
  }

  console.log('\nAll triage.controller tests passed.');
}

runTests().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
