'use strict';

/**
 * FN-1222: Unit tests for voice.controller.js.
 * Runs standalone with `node`. DB and external services are stubbed.
 */

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

// Stub @goodmen/shared modules not available outside the Docker build
require.cache[require.resolve('@goodmen/shared/utils/logger')] = {
  id: '@goodmen/shared/utils/logger',
  filename: '@goodmen/shared/utils/logger',
  loaded: true,
  exports: { info: () => {}, error: () => {}, warn: () => {} }
};

// --- Minimal stubs ---

const mockDb = {
  lookupResult: null,
  insertedConsent: null
};

// Load modules so patches apply before voice.controller is first required
const didMappingModule = require('../../voice/did-mapping.service');
const origLookupTenant = didMappingModule.lookupTenant;

const consentModule = require('../../voice/consent.service');
const origRecordConsent = consentModule.recordConsent;

// Pre-load controller so module cache already holds the module references
require('../../voice/voice.controller');

function makeApp(pendingCalls = {}) {
  return { locals: { pendingCalls, db: mockDb } };
}

function makeRes() {
  const r = {
    statusCode: 200,
    body: null,
    contentType: null,
    status(code) { r.statusCode = code; return r; },
    json(b) { r.body = b; return r; },
    type(t) { r.contentType = t; return r; },
    send(b) { r.body = b; return r; }
  };
  return r;
}

async function test_incoming_rejects_missing_params() {
  const { handleIncoming } = require('../../voice/voice.controller');
  const req = { body: {}, app: makeApp() };
  const res = makeRes();
  await handleIncoming(req, res);
  assert.equal(res.statusCode, 400, 'Should return 400 for missing Called/CallSid');
  console.log('PASS: incoming rejects missing params');
}

async function test_incoming_rejects_unmapped_did() {
  const { handleIncoming } = require('../../voice/voice.controller');

  // Patch lookupTenant to return null
  didMappingModule.lookupTenant = async () => null;

  const req = { body: { Called: '+15551234567', CallSid: 'CA123' }, app: makeApp() };
  const res = makeRes();
  await handleIncoming(req, res);
  assert.ok(res.body && res.body.includes('not registered'), 'Should say DID not registered');
  didMappingModule.lookupTenant = origLookupTenant;
  console.log('PASS: incoming rejects unmapped DID');
}

async function test_incoming_returns_consent_twiml() {
  const { handleIncoming } = require('../../voice/voice.controller');

  didMappingModule.lookupTenant = async () => 'tenant-abc';

  const req = { body: { Called: '+15551234567', CallSid: 'CA456' }, app: makeApp() };
  const res = makeRes();
  await handleIncoming(req, res, { consentBaseUrl: 'https://example.com' });

  assert.ok(res.body && res.body.includes('<Gather'), 'Should return TwiML with Gather');
  assert.ok(res.body && res.body.includes('consent'), 'Should point to consent action');
  assert.equal(res.statusCode, 200);

  didMappingModule.lookupTenant = origLookupTenant;
  console.log('PASS: incoming returns consent TwiML');
}

async function test_consent_declined() {
  const { handleConsentGather } = require('../../voice/voice.controller');

  consentModule.recordConsent = async () => 'declined';

  const req = {
    body: { Digits: '2', CallSid: 'CA789', Called: '+15551234567' },
    app: makeApp({ CA789: { tenantId: 'tenant-abc', called: '+15551234567' } })
  };
  const res = makeRes();
  await handleConsentGather(req, res);
  assert.ok(res.body && res.body.includes('<Hangup'), 'Should hang up on decline');

  consentModule.recordConsent = origRecordConsent;
  console.log('PASS: consent declined → hangup');
}

async function test_consent_granted_returns_stream_twiml() {
  const { handleConsentGather } = require('../../voice/voice.controller');

  consentModule.recordConsent = async () => 'granted';

  const req = {
    body: { Digits: '1', CallSid: 'CA999', Called: '+15551234567' },
    app: makeApp({ CA999: { tenantId: 'tenant-abc', called: '+15551234567' } })
  };
  process.env.VOICE_WS_URL = 'https://example.com';
  const res = makeRes();
  await handleConsentGather(req, res);
  assert.ok(res.body && res.body.includes('<Start>'), 'Should start Media Streams on consent');

  consentModule.recordConsent = origRecordConsent;
  console.log('PASS: consent granted → stream TwiML');
}

async function test_asr_session_events() {
  const { createAsrSession } = require('../../voice/asr.service');
  const session = createAsrSession('CA-TEST');
  const events = [];
  session.on('start', (e) => events.push({ type: 'start', ...e }));
  session.on('stop', (e) => events.push({ type: 'stop', ...e }));
  session.on('transcript', (e) => events.push(e));

  session.handleMessage({ event: 'start', streamSid: 'MZ001' });
  assert.equal(events[0].type, 'start');
  assert.equal(events[0].streamSid, 'MZ001');

  // Send 20 chunks to trigger interim transcript
  for (let i = 0; i < 20; i++) {
    session.handleMessage({ event: 'media', media: { payload: Buffer.alloc(160).toString('base64'), chunk: i } });
  }
  const interims = events.filter((e) => e.type === 'interim');
  assert.equal(interims.length, 1, 'Should emit 1 interim after 20 chunks');

  session.handleMessage({ event: 'stop' });
  const finals = events.filter((e) => e.type === 'final');
  assert.equal(finals.length, 1, 'Should emit final on stop');

  console.log('PASS: AsrSession emits start/interim/final/stop events');
}

async function test_normaliseDid() {
  const { normaliseDid } = require('../../voice/did-mapping.service');
  assert.equal(normaliseDid('+15551234567'), '+15551234567');
  assert.equal(normaliseDid('15551234567'), '+15551234567');
  assert.equal(normaliseDid('5551234567'), '+15551234567');
  console.log('PASS: normaliseDid formats DIDs correctly');
}

(async () => {
  let failed = 0;
  const tests = [
    test_incoming_rejects_missing_params,
    test_incoming_rejects_unmapped_did,
    test_incoming_returns_consent_twiml,
    test_consent_declined,
    test_consent_granted_returns_stream_twiml,
    test_asr_session_events,
    test_normaliseDid
  ];

  for (const t of tests) {
    try {
      await t();
    } catch (err) {
      console.error(`FAIL: ${t.name} — ${err.message}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log('\nAll voice controller tests passed.');
})();
