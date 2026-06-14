'use strict';

/**
 * FN-1783 (story FN-1782): unit tests for the vehicle DOT-readiness rule engine
 * and the activation guard.
 *
 * Run: cd backend/packages/goodmen-shared && node --test test/vehicle-readiness.test.js
 *
 * These tests target the PURE functions (rules + evaluator + guard) so they need
 * no database and no express — only the service module itself.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  READINESS_RULES,
  getRequiredDocumentTypes,
  evaluateReadiness,
  isActivationStatus,
  evaluateActivationGuard,
  NOT_READY_CODE,
} = require('../services/vehicle-readiness.service');

// Fixed "now" so date comparisons are deterministic.
const NOW = new Date('2026-06-14T12:00:00Z');
const FUTURE = '2026-12-31';
const PAST = '2026-01-01';

function doc(type, expiry, id = `${type}-doc`) {
  return { id, document_type: type, expiry_date: expiry };
}

describe('vehicle-readiness — rule set', () => {
  it('truck requires registration, insurance, inspection, ifta', () => {
    assert.deepStrictEqual(getRequiredDocumentTypes('truck'), [
      'registration',
      'insurance',
      'inspection',
      'ifta',
    ]);
    assert.deepStrictEqual(READINESS_RULES.truck, ['registration', 'insurance', 'inspection', 'ifta']);
  });

  it('trailer requires registration, inspection only', () => {
    assert.deepStrictEqual(getRequiredDocumentTypes('trailer'), ['registration', 'inspection']);
  });

  it('defaults a missing/blank vehicle_type to truck rules', () => {
    assert.deepStrictEqual(getRequiredDocumentTypes(''), getRequiredDocumentTypes('truck'));
    assert.deepStrictEqual(getRequiredDocumentTypes(null), getRequiredDocumentTypes('truck'));
  });

  it('returns no rules for non-DOT units (e.g. customer_vehicle)', () => {
    assert.deepStrictEqual(getRequiredDocumentTypes('customer_vehicle'), []);
  });

  it('returns a fresh array (callers cannot mutate the source of truth)', () => {
    const a = getRequiredDocumentTypes('truck');
    a.push('mutated');
    assert.deepStrictEqual(READINESS_RULES.truck, ['registration', 'insurance', 'inspection', 'ifta']);
  });
});

describe('vehicle-readiness — evaluator', () => {
  it('truck is ready when every requirement is satisfied (columns + ifta doc)', () => {
    const vehicle = {
      vehicle_type: 'truck',
      registration_expiry: FUTURE,
      insurance_expiry: FUTURE,
      inspection_expiry: FUTURE,
    };
    const result = evaluateReadiness(vehicle, [doc('ifta', FUTURE)], NOW);
    assert.strictEqual(result.ready, true);
    assert.strictEqual(result.vehicleType, 'truck');
    assert.deepStrictEqual(result.missing, []);
    assert.deepStrictEqual(result.expired, []);
    assert.strictEqual(result.requiredDocuments.length, 4);
  });

  it('truck with valid columns but no ifta document → ifta missing, not ready', () => {
    const vehicle = {
      vehicle_type: 'truck',
      registration_expiry: FUTURE,
      insurance_expiry: FUTURE,
      inspection_expiry: FUTURE,
    };
    const result = evaluateReadiness(vehicle, [], NOW);
    assert.strictEqual(result.ready, false);
    assert.deepStrictEqual(result.missing, ['ifta']);
    assert.deepStrictEqual(result.expired, []);
  });

  it('ifta is satisfied ONLY by a document row (no column fallback)', () => {
    const vehicle = {
      vehicle_type: 'truck',
      registration_expiry: FUTURE,
      insurance_expiry: FUTURE,
      inspection_expiry: FUTURE,
    };
    const ready = evaluateReadiness(vehicle, [doc('ifta', FUTURE, 'ifta-1')], NOW);
    const iftaEntry = ready.requiredDocuments.find((r) => r.type === 'ifta');
    assert.strictEqual(iftaEntry.state, 'valid');
    assert.strictEqual(iftaEntry.documentId, 'ifta-1');
    assert.strictEqual(ready.ready, true);
  });

  it('reports a missing requirement (truck missing insurance)', () => {
    const vehicle = {
      vehicle_type: 'truck',
      registration_expiry: FUTURE,
      insurance_expiry: null,
      inspection_expiry: FUTURE,
    };
    const result = evaluateReadiness(vehicle, [doc('ifta', FUTURE)], NOW);
    assert.strictEqual(result.ready, false);
    assert.deepStrictEqual(result.missing, ['insurance']);
    const ins = result.requiredDocuments.find((r) => r.type === 'insurance');
    assert.strictEqual(ins.state, 'missing');
    assert.strictEqual(ins.expiryDate, null);
    assert.strictEqual(ins.documentId, null);
  });

  it('reports an expired requirement (inspection column in the past)', () => {
    const vehicle = {
      vehicle_type: 'truck',
      registration_expiry: FUTURE,
      insurance_expiry: FUTURE,
      inspection_expiry: PAST,
    };
    const result = evaluateReadiness(vehicle, [doc('ifta', FUTURE)], NOW);
    assert.strictEqual(result.ready, false);
    assert.deepStrictEqual(result.expired, ['inspection']);
    const insp = result.requiredDocuments.find((r) => r.type === 'inspection');
    assert.strictEqual(insp.state, 'expired');
    assert.strictEqual(insp.expiryDate, PAST);
  });

  it('dual-source: a future document satisfies even when the column is expired', () => {
    const vehicle = {
      vehicle_type: 'truck',
      registration_expiry: PAST, // column lapsed
      insurance_expiry: FUTURE,
      inspection_expiry: FUTURE,
    };
    const result = evaluateReadiness(
      vehicle,
      [doc('registration', FUTURE, 'reg-1'), doc('ifta', FUTURE)],
      NOW
    );
    const reg = result.requiredDocuments.find((r) => r.type === 'registration');
    assert.strictEqual(reg.state, 'valid');
    assert.strictEqual(reg.documentId, 'reg-1'); // document preferred so UI can link
    assert.strictEqual(result.ready, true);
  });

  it('dual-source: a future column satisfies even when the only document is expired', () => {
    const vehicle = {
      vehicle_type: 'truck',
      registration_expiry: FUTURE, // column current
      insurance_expiry: FUTURE,
      inspection_expiry: FUTURE,
    };
    const result = evaluateReadiness(
      vehicle,
      [doc('registration', PAST, 'reg-old'), doc('ifta', FUTURE)],
      NOW
    );
    const reg = result.requiredDocuments.find((r) => r.type === 'registration');
    assert.strictEqual(reg.state, 'valid');
    assert.strictEqual(reg.expiryDate, FUTURE);
    assert.strictEqual(result.ready, true);
  });

  it('trailer ignores insurance and ifta (only registration + inspection)', () => {
    const vehicle = {
      vehicle_type: 'trailer',
      registration_expiry: FUTURE,
      insurance_expiry: null,
      inspection_expiry: FUTURE,
    };
    const result = evaluateReadiness(vehicle, [], NOW);
    assert.strictEqual(result.ready, true);
    assert.deepStrictEqual(
      result.requiredDocuments.map((r) => r.type),
      ['registration', 'inspection']
    );
  });

  it('trailer blocked when its inspection is missing', () => {
    const vehicle = {
      vehicle_type: 'trailer',
      registration_expiry: FUTURE,
      inspection_expiry: null,
    };
    const result = evaluateReadiness(vehicle, [], NOW);
    assert.strictEqual(result.ready, false);
    assert.deepStrictEqual(result.missing, ['inspection']);
  });

  it('matches free-string document_type variants (annual_inspection, ifta_decal)', () => {
    const vehicle = { vehicle_type: 'truck', registration_expiry: FUTURE, insurance_expiry: FUTURE };
    const result = evaluateReadiness(
      vehicle,
      [doc('annual_inspection', FUTURE, 'insp-1'), doc('ifta_decal', FUTURE, 'ifta-9')],
      NOW
    );
    assert.strictEqual(result.ready, true);
    assert.strictEqual(result.requiredDocuments.find((r) => r.type === 'inspection').documentId, 'insp-1');
    assert.strictEqual(result.requiredDocuments.find((r) => r.type === 'ifta').documentId, 'ifta-9');
  });

  it('a non-DOT unit (customer_vehicle) is ready with no requirements', () => {
    const result = evaluateReadiness({ vehicle_type: 'customer_vehicle' }, [], NOW);
    assert.strictEqual(result.ready, true);
    assert.deepStrictEqual(result.requiredDocuments, []);
    assert.deepStrictEqual(result.missing, []);
    assert.deepStrictEqual(result.expired, []);
  });

  it('treats a present-but-undated document as not yet valid (expired)', () => {
    const vehicle = { vehicle_type: 'trailer', registration_expiry: FUTURE };
    const result = evaluateReadiness(vehicle, [doc('inspection', null, 'insp-x')], NOW);
    const insp = result.requiredDocuments.find((r) => r.type === 'inspection');
    assert.strictEqual(insp.state, 'expired');
    assert.strictEqual(insp.documentId, 'insp-x');
    assert.strictEqual(result.ready, false);
  });
});

describe('vehicle-readiness — activation guard', () => {
  it('recognizes in-service / active (case-insensitive) as activation', () => {
    assert.strictEqual(isActivationStatus('in-service'), true);
    assert.strictEqual(isActivationStatus('IN-SERVICE'), true);
    assert.strictEqual(isActivationStatus('active'), true);
    assert.strictEqual(isActivationStatus('out-of-service'), false);
    assert.strictEqual(isActivationStatus(''), false);
    assert.strictEqual(isActivationStatus(undefined), false);
  });

  it('returns null when activation is not requested', () => {
    const vehicle = { vehicle_type: 'truck' };
    assert.strictEqual(evaluateActivationGuard(vehicle, [], 'out-of-service', NOW), null);
    assert.strictEqual(evaluateActivationGuard(vehicle, [], undefined, NOW), null);
  });

  it('blocks activation with a 422 payload when not ready', () => {
    const vehicle = {
      vehicle_type: 'truck',
      registration_expiry: FUTURE,
      insurance_expiry: null, // missing
      inspection_expiry: PAST, // expired
    };
    const guard = evaluateActivationGuard(vehicle, [], 'in-service', NOW);
    assert.ok(guard, 'expected a guard error');
    assert.strictEqual(guard.code, NOT_READY_CODE);
    assert.ok(typeof guard.message === 'string' && guard.message.length > 0);
    assert.deepStrictEqual(guard.missing, ['insurance', 'ifta']);
    assert.deepStrictEqual(guard.expired, ['inspection']);
  });

  it('allows activation (returns null) when the unit is ready — happy path', () => {
    const vehicle = {
      vehicle_type: 'truck',
      registration_expiry: FUTURE,
      insurance_expiry: FUTURE,
      inspection_expiry: FUTURE,
    };
    const guard = evaluateActivationGuard(vehicle, [doc('ifta', FUTURE)], 'in-service', NOW);
    assert.strictEqual(guard, null);
  });

  it('a trailer can activate from columns alone (no documents needed)', () => {
    const vehicle = {
      vehicle_type: 'trailer',
      registration_expiry: FUTURE,
      inspection_expiry: FUTURE,
    };
    assert.strictEqual(evaluateActivationGuard(vehicle, [], 'in-service', NOW), null);
  });
});
