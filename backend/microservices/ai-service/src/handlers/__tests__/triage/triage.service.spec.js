'use strict';

/**
 * FN-1215: Unit tests for triage.service.js
 * Runs standalone with `node`.
 */

const assert = require('node:assert/strict');
const { parseAndValidate, buildUserMessage, PROMPT_VERSION } = require('../../../triage/triage.service');

// ---------------------------------------------------------------------------
// parseAndValidate
// ---------------------------------------------------------------------------

function validPayload(overrides) {
  return {
    severity: 'HIGH',
    serviceCategory: 'TOWING',
    urgency: 'WITHIN_HOUR',
    vendorSkills: ['heavy_tow', 'flatbed'],
    rationale: 'Vehicle fully disabled on highway shoulder.',
    safetyRisk: false,
    ...overrides
  };
}

// Happy path
{
  const result = parseAndValidate(JSON.stringify(validPayload()));
  assert.ok(result, 'should return a record for valid JSON');
  assert.equal(result.severity, 'HIGH');
  assert.equal(result.serviceCategory, 'TOWING');
  assert.equal(result.urgency, 'WITHIN_HOUR');
  assert.deepEqual(result.vendorSkills, ['heavy_tow', 'flatbed']);
  assert.equal(result.safetyRisk, false);
  console.log('PASS: happy-path triage record');
}

// Strips markdown code fences
{
  const raw = '```json\n' + JSON.stringify(validPayload({ severity: 'CRITICAL' })) + '\n```';
  const result = parseAndValidate(raw);
  assert.ok(result, 'should strip markdown fences');
  assert.equal(result.severity, 'CRITICAL');
  console.log('PASS: strips markdown fences');
}

// Case-insensitive field coercion
{
  const raw = JSON.stringify(validPayload({ severity: 'medium', urgency: 'immediate' }));
  const result = parseAndValidate(raw);
  assert.ok(result, 'should coerce lowercase values');
  assert.equal(result.severity, 'MEDIUM');
  assert.equal(result.urgency, 'IMMEDIATE');
  console.log('PASS: case-insensitive coercion');
}

// Invalid severity → null
{
  const raw = JSON.stringify(validPayload({ severity: 'UNKNOWN' }));
  const result = parseAndValidate(raw);
  assert.equal(result, null, 'should return null for invalid severity');
  console.log('PASS: invalid severity returns null');
}

// Invalid serviceCategory → null
{
  const raw = JSON.stringify(validPayload({ serviceCategory: 'MAGIC' }));
  const result = parseAndValidate(raw);
  assert.equal(result, null, 'should return null for invalid serviceCategory');
  console.log('PASS: invalid serviceCategory returns null');
}

// Empty vendorSkills → null
{
  const raw = JSON.stringify(validPayload({ vendorSkills: [] }));
  const result = parseAndValidate(raw);
  assert.equal(result, null, 'should return null for empty vendorSkills');
  console.log('PASS: empty vendorSkills returns null');
}

// Missing rationale → null
{
  const raw = JSON.stringify(validPayload({ rationale: '' }));
  const result = parseAndValidate(raw);
  assert.equal(result, null, 'should return null for empty rationale');
  console.log('PASS: empty rationale returns null');
}

// Malformed JSON → null
{
  const result = parseAndValidate('not json {{{');
  assert.equal(result, null, 'should return null for malformed JSON');
  console.log('PASS: malformed JSON returns null');
}

// safetyRisk defaults false when missing
{
  const payload = validPayload();
  delete payload.safetyRisk;
  const result = parseAndValidate(JSON.stringify(payload));
  assert.ok(result);
  assert.equal(result.safetyRisk, false, 'safetyRisk should default to false when absent');
  console.log('PASS: safetyRisk defaults to false');
}

// safetyRisk true preserved
{
  const result = parseAndValidate(JSON.stringify(validPayload({ safetyRisk: true, severity: 'CRITICAL' })));
  assert.ok(result);
  assert.equal(result.safetyRisk, true);
  console.log('PASS: safetyRisk=true preserved');
}

// ---------------------------------------------------------------------------
// buildUserMessage
// ---------------------------------------------------------------------------

{
  const msg = buildUserMessage({ description: 'flat tire', tenantId: 't1', vehicleType: 'semi', location: 'I-35', tenantPolicy: null });
  const parsed = JSON.parse(msg);
  assert.equal(parsed.description, 'flat tire');
  assert.equal(parsed.tenantId, 't1');
  assert.equal(parsed.vehicleType, 'semi');
  assert.equal(parsed.location, 'I-35');
  assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'tenantPolicyOverride'), 'should omit tenantPolicyOverride when null');
  console.log('PASS: buildUserMessage without tenantPolicy');
}

{
  const msg = buildUserMessage({ description: 'stalled', tenantId: 't2', vehicleType: null, location: null, tenantPolicy: 'escalate all highway' });
  const parsed = JSON.parse(msg);
  assert.equal(parsed.tenantPolicyOverride, 'escalate all highway');
  console.log('PASS: buildUserMessage with tenantPolicy');
}

// ---------------------------------------------------------------------------
// PROMPT_VERSION constant
// ---------------------------------------------------------------------------
assert.ok(typeof PROMPT_VERSION === 'string' && PROMPT_VERSION.length > 0);
console.log('PASS: PROMPT_VERSION exported');

// ---------------------------------------------------------------------------
// triageIncident integration (mocked Anthropic)
// ---------------------------------------------------------------------------

async function runIntegrationTests() {
  const { triageIncident } = require('../../../triage/triage.service');

  function makeMockAnthropic(responsePayload) {
    return {
      messages: {
        create: async () => ({
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: JSON.stringify(responsePayload) }],
          usage: { cache_read_input_tokens: 500, cache_creation_input_tokens: 0, input_tokens: 100, output_tokens: 50 }
        })
      }
    };
  }

  // Successful triage
  {
    const record = await triageIncident(
      { tenantId: 'tenant-1', description: 'driver reports blown tire on I-35', vehicleType: 'semi' },
      { anthropic: makeMockAnthropic(validPayload({ serviceCategory: 'TIRE_CHANGE', vendorSkills: ['roadside_tire'] })) }
    );
    assert.equal(record.severity, 'HIGH');
    assert.equal(record.serviceCategory, 'TIRE_CHANGE');
    assert.equal(record.prompt_version, PROMPT_VERSION);
    assert.ok(typeof record.latency_ms === 'number');
    assert.equal(record.cache_read_tokens, 500);
    console.log('PASS: triageIncident returns full record');
  }

  // Parse error propagates
  {
    const badClient = { messages: { create: async () => ({ model: 'x', content: [{ type: 'text', text: 'not json' }], usage: {} }) } };
    await assert.rejects(
      () => triageIncident({ tenantId: 't', description: 'stalled' }, { anthropic: badClient }),
      err => err.code === 'TRIAGE_PARSE_ERROR'
    );
    console.log('PASS: triageIncident rejects with TRIAGE_PARSE_ERROR on bad output');
  }

  // Upstream error propagates
  {
    const failClient = { messages: { create: async () => { throw Object.assign(new Error('upstream'), { status: 503 }); } } };
    await assert.rejects(
      () => triageIncident({ tenantId: 't', description: 'stalled' }, { anthropic: failClient }),
      err => err.message === 'upstream'
    );
    console.log('PASS: triageIncident propagates upstream errors');
  }
}

runIntegrationTests().then(() => {
  console.log('\nAll triage.service tests passed.');
}).catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
