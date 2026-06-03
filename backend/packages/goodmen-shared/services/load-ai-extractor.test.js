'use strict';

// Stub heavyweight dependencies before loading the extractor so the test
// module stays self-contained (goodmen-shared does not install axios /
// pdf-parse; those come from the microservice host at runtime).
const Module = require('node:module');
const originalResolve = Module._resolveFilename;
const STUB_PATH = require('path').join(__dirname, '__load_ai_extractor_stub__.js');
require.cache[STUB_PATH] = {
  id: STUB_PATH,
  filename: STUB_PATH,
  loaded: true,
  exports: new Proxy(function () {}, {
    get: () => () => ({ data: {} }),
    apply: () => ({}),
  }),
};
Module._resolveFilename = function patchedResolve(request, parent, ...rest) {
  if (request === 'axios' || request === 'pdf-parse') return STUB_PATH;
  return originalResolve.call(this, request, parent, ...rest);
};

const assert = require('node:assert/strict');
const { describe, it, after } = require('node:test');

const {
  buildAiMetadata,
  AI_METADATA_FIELD_KEYS,
  confidenceTier,
  computeOverallConfidence,
} = require('./load-ai-extractor');

after(() => {
  Module._resolveFilename = originalResolve;
  delete require.cache[STUB_PATH];
});

describe('load-ai-extractor confidence helpers', () => {
  it('confidenceTier maps 0–1 scores to green/yellow/red', () => {
    assert.equal(confidenceTier(0.99), 'green');
    assert.equal(confidenceTier(0.90), 'yellow');
    assert.equal(confidenceTier(0.80), 'yellow');
    assert.equal(confidenceTier(0.70), 'red');
    assert.equal(confidenceTier(0), 'red');
  });

  it('computeOverallConfidence returns the weakest required field', () => {
    assert.equal(
      computeOverallConfidence({ brokerName: 0.95, rate: 0.4, pickup: 0.9, delivery: 0.9 }),
      0.4
    );
    assert.equal(
      computeOverallConfidence({ brokerName: 1, rate: 1, pickup: 1, delivery: 1 }),
      1
    );
    // Missing keys count as 0 (conservative).
    assert.equal(computeOverallConfidence({}), 0);
  });
});

describe('buildAiMetadata (FN-817)', () => {
  it('returns null for empty / non-object inputs', () => {
    assert.equal(buildAiMetadata(null), null);
    assert.equal(buildAiMetadata(undefined), null);
    assert.equal(buildAiMetadata('string'), null);
    assert.equal(buildAiMetadata({}), null);
  });

  it('returns null when the payload has no confidence signal', () => {
    assert.equal(buildAiMetadata({ confidence: {} }), null);
    assert.equal(buildAiMetadata({ confidence: { ignored: 'not-a-number' } }), null);
  });

  it('captures overall_confidence + per-field confidence and derives the tier', () => {
    const meta = buildAiMetadata({
      overall_confidence: 0.83,
      confidence: { brokerName: 0.97, poNumber: 0.62, rate: 0.83, pickup: 0.9, delivery: 0.91 },
    }, 'ratecon.pdf');

    assert.ok(meta);
    assert.equal(meta.overall_confidence, 0.83);
    assert.equal(meta.overall_confidence_tier, 'yellow'); // 0.83 is in the yellow band
    assert.equal(meta.source_document, 'ratecon.pdf');
    assert.match(meta.extracted_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(meta.fields, {
      brokerName: 0.97, poNumber: 0.62, rate: 0.83, pickup: 0.9, delivery: 0.91
    });
  });

  it('prefers an explicit overall_confidence_tier over the derived one', () => {
    const meta = buildAiMetadata({
      overall_confidence: 0.83,
      overall_confidence_tier: 'green', // extractor said green; trust it
      confidence: { brokerName: 0.83 },
    });
    assert.equal(meta.overall_confidence_tier, 'green');
  });

  it('drops non-finite confidence values so NaN cannot leak into jsonb', () => {
    const meta = buildAiMetadata({
      overall_confidence: 0.9,
      confidence: { brokerName: 0.9, rate: Number.NaN, pickup: Infinity, delivery: 0.8 },
    });
    assert.ok(meta);
    assert.deepEqual(Object.keys(meta.fields).sort(), ['brokerName', 'delivery']);
  });

  it('only persists the canonical field-key set', () => {
    const meta = buildAiMetadata({
      overall_confidence: 0.9,
      confidence: {
        brokerName: 0.9, poNumber: 0.9, rate: 0.9, pickup: 0.9, delivery: 0.9,
        unknownField: 0.9,
      },
    });
    assert.deepEqual(Object.keys(meta.fields).sort(), [...AI_METADATA_FIELD_KEYS].sort());
  });

  it('null source_document when filename not provided', () => {
    const meta = buildAiMetadata({
      overall_confidence: 0.9, confidence: { brokerName: 0.9 },
    });
    assert.equal(meta.source_document, null);
  });
});
