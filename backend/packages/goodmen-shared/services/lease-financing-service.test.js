'use strict';

/**
 * FN-1803: unit tests for the lease-to-own e-sign integration helpers.
 *
 * Covers the DB-free decision logic wired into the generic signature engine:
 *   - chooseSignatureTemplate — which finalized lease_agreement template to sign
 *   - planSignatureCompletion — what the signature-completion hook changes and
 *     whether it auto-activates the lease (lifecycle guard)
 * No DB / no network. The DB orchestration (applySignatureCompletion) and the
 * end-to-end send→sign flow are validated by QA (FN-1805).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const svc = require('./lease-financing-service');

describe('chooseSignatureTemplate', () => {
  const ready = (id, documentType = 'lease_agreement') => ({ id, status: 'ready', documentType });
  const draft = (id, documentType = 'lease_agreement') => ({ id, status: 'draft', documentType });

  it('returns the newest finalized lease_agreement template when no id is given', () => {
    // listTemplates() is newest-first, so the first ready lease_agreement wins.
    const templates = [draft('d1'), ready('t-new'), ready('t-old')];
    assert.strictEqual(svc.chooseSignatureTemplate(templates).id, 't-new');
  });

  it('returns the explicitly requested template when it is finalized', () => {
    const templates = [ready('t-new'), ready('t-old')];
    assert.strictEqual(svc.chooseSignatureTemplate(templates, 't-old').id, 't-old');
  });

  it('returns null when the requested id is not a finalized lease_agreement', () => {
    const templates = [draft('t-draft'), ready('t-generic', 'generic')];
    assert.strictEqual(svc.chooseSignatureTemplate(templates, 't-draft'), null);
    assert.strictEqual(svc.chooseSignatureTemplate(templates, 't-generic'), null);
  });

  it('ignores draft and non-lease_agreement templates in the fallback', () => {
    const templates = [draft('d1'), ready('g1', 'generic'), ready('lease1')];
    assert.strictEqual(svc.chooseSignatureTemplate(templates).id, 'lease1');
  });

  it('returns null when nothing is eligible or the list is empty/invalid', () => {
    assert.strictEqual(svc.chooseSignatureTemplate([]), null);
    assert.strictEqual(svc.chooseSignatureTemplate(null), null);
    assert.strictEqual(svc.chooseSignatureTemplate([draft('d1'), ready('g', 'generic')]), null);
  });
});

describe('planSignatureCompletion', () => {
  const agreement = (overrides = {}) => ({ id: 'a1', status: 'pending_signature', ...overrides });

  it('returns null for a missing agreement', () => {
    assert.strictEqual(svc.planSignatureCompletion(null), null);
  });

  it('auto-activates a pending_signature lease with no truck conflict', () => {
    const plan = svc.planSignatureCompletion(agreement(), { signedPdfStorageKey: 'k.pdf' });
    assert.strictEqual(plan.activate, true);
    assert.strictEqual(plan.nextStatus, 'active');
    assert.strictEqual(plan.documentStorageKey, 'k.pdf');
  });

  it('records the signature but does NOT activate when the truck has a competing lease', () => {
    const plan = svc.planSignatureCompletion(agreement(), { hasTruckConflict: true });
    assert.strictEqual(plan.activate, false);
    assert.strictEqual(plan.nextStatus, 'pending_signature');
  });

  it('does not regress or re-activate an already-active lease', () => {
    const plan = svc.planSignatureCompletion(agreement({ status: 'active' }), { signedPdfStorageKey: 'k.pdf' });
    assert.strictEqual(plan.activate, false);
    assert.strictEqual(plan.nextStatus, 'active');
    assert.strictEqual(plan.documentStorageKey, 'k.pdf');
  });

  it('never advances a draft lease (only pending_signature auto-activates)', () => {
    const plan = svc.planSignatureCompletion(agreement({ status: 'draft' }));
    assert.strictEqual(plan.activate, false);
    assert.strictEqual(plan.nextStatus, 'draft');
  });

  it('leaves the document key unchanged (null) when no signed PDF is available', () => {
    const plan = svc.planSignatureCompletion(agreement());
    assert.strictEqual(plan.documentStorageKey, null);
  });
});

describe('signature engine integration', () => {
  it('exposes applySignatureCompletion and the engine accepts an onSigned hook', () => {
    assert.strictEqual(typeof svc.applySignatureCompletion, 'function');
    const engine = require('./signature-service');
    assert.strictEqual(typeof engine.onSigned, 'function');
    // Registering is idempotent and side-effect-free here (no signing occurs).
    assert.doesNotThrow(() => engine.onSigned(() => {}));
  });

  it('applySignatureCompletion no-ops for non-lease document types', async () => {
    const res = await svc.applySignatureCompletion({ requestId: 'r1', documentType: 'generic' });
    assert.strictEqual(res, null);
  });

  it('applySignatureCompletion no-ops without a requestId', async () => {
    assert.strictEqual(await svc.applySignatureCompletion({}), null);
  });
});
