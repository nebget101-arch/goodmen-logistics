'use strict';

/**
 * FN-1240: Tests for the incident WebSocket broadcaster.
 * Runs standalone with `node` — no jest.
 *
 *   node backend/gateway/__tests__/incident-ws.test.js
 */

const assert = require('node:assert/strict');
const { buildIncidentBroadcaster, EVENT_INCIDENT_STATE_CHANGED } = require('../services/incident-broadcaster');

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✅ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${label}: ${err.message}`);
    failed++;
  }
}

// ── buildIncidentBroadcaster ─────────────────────────────────────────────────

console.log('\nbuildIncidentBroadcaster');

test('throws if emit is not a function', () => {
  assert.throws(() => buildIncidentBroadcaster({ emit: null }), /emit function is required/);
});

test('broadcastStateChanged returns delivered:false on missing tenantId', () => {
  const { broadcastStateChanged } = buildIncidentBroadcaster({ emit: () => {} });
  const result = broadcastStateChanged({ incidentId: 'i1', state: 'on_site', version: 1 });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, 'missing_required_fields');
});

test('broadcastStateChanged returns delivered:false on missing incidentId', () => {
  const { broadcastStateChanged } = buildIncidentBroadcaster({ emit: () => {} });
  const result = broadcastStateChanged({ tenantId: 't1', state: 'on_site', version: 1 });
  assert.equal(result.delivered, false);
});

test('broadcastStateChanged returns delivered:false on missing state', () => {
  const { broadcastStateChanged } = buildIncidentBroadcaster({ emit: () => {} });
  const result = broadcastStateChanged({ tenantId: 't1', incidentId: 'i1', version: 1 });
  assert.equal(result.delivered, false);
});

test('broadcastStateChanged calls emit with correct event and payload', () => {
  const calls = [];
  const { broadcastStateChanged } = buildIncidentBroadcaster({
    emit: (args) => { calls.push(args); return { delivered: true }; }
  });
  const result = broadcastStateChanged({
    tenantId: 'tenant-1',
    incidentId: 'inc-42',
    state: 'triage_complete',
    version: 3,
    meta: { urgency: 'high' }
  });
  assert.equal(result.delivered, true);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.tenantId, 'tenant-1');
  assert.equal(call.event, EVENT_INCIDENT_STATE_CHANGED);
  assert.equal(call.payload.incidentId, 'inc-42');
  assert.equal(call.payload.state, 'triage_complete');
  assert.equal(call.payload.version, 3);
  assert.equal(call.payload.tenantId, 'tenant-1');
  assert.deepEqual(call.payload.meta, { urgency: 'high' });
  assert.ok(call.payload.changedAt, 'changedAt should be set');
});

test('broadcastStateChanged passes through custom changedAt', () => {
  const calls = [];
  const { broadcastStateChanged } = buildIncidentBroadcaster({
    emit: (args) => { calls.push(args); return { delivered: true }; }
  });
  const ts = '2026-06-10T12:00:00.000Z';
  broadcastStateChanged({ tenantId: 't', incidentId: 'i', state: 'complete', version: 5, changedAt: ts });
  assert.equal(calls[0].payload.changedAt, ts);
});

test('broadcastStateChanged propagates emit failure', () => {
  const { broadcastStateChanged } = buildIncidentBroadcaster({
    emit: () => ({ delivered: false, reason: 'no_ws_server' })
  });
  const result = broadcastStateChanged({ tenantId: 't', incidentId: 'i', state: 'complete', version: 1 });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, 'no_ws_server');
});

test('EVENT_INCIDENT_STATE_CHANGED constant is correct', () => {
  assert.equal(EVENT_INCIDENT_STATE_CHANGED, 'incident.state_changed');
});

// ── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
