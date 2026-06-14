'use strict';

/**
 * FN-1791 (story FN-1787): Tests for agreement-fields-handler.
 * Runs standalone with `node`. No jest/mocha required.
 * The Anthropic client is mocked via deps.anthropic so no real API calls are made.
 */

const assert = require('node:assert/strict');
const {
  handleAgreementDetectFields,
  normalizeDetection,
  validateBody,
  FIELD_TYPES,
  ROLES,
  DOC_TYPES,
  MAX_FILE_BYTES,
  PDF_TYPE
} = require('../agreement-fields-handler');

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

// Mock Anthropic client returning a fixed text payload. `usage` is optional.
function makeMockAnthropic(text, usage) {
  return {
    messages: {
      create: async () => ({
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text }],
        usage: usage || null
      })
    }
  };
}

// A client whose first call returns bad text and second (retry) returns good JSON.
function makeRetryAnthropic(badText, goodText) {
  let n = 0;
  return {
    callCount: () => n,
    messages: {
      create: async () => {
        n += 1;
        return {
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: n === 1 ? badText : goodText }],
          usage: null
        };
      }
    }
  };
}

function makeAlwaysBadAnthropic(badText) {
  let n = 0;
  return {
    callCount: () => n,
    messages: {
      create: async () => {
        n += 1;
        return {
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: badText }],
          usage: null
        };
      }
    }
  };
}

function makeThrowingAnthropic(status) {
  return {
    messages: {
      create: async () => {
        const err = new Error('upstream boom');
        if (status) err.status = status;
        throw err;
      }
    }
  };
}

let passed = 0;
function ok(name) {
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ok  ${name}`);
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('agreement-fields-handler tests');

  // ---- Pure normalizeDetection / hallucination guard ----------------------
  {
    const out = normalizeDetection({
      documentType: 'lease_agreement',
      pageCount: 2,
      fields: [
        { key: 'lessee_name', label: 'Lessee Name', type: 'text', page: 1, bbox: [0.1, 0.2, 0.3, 0.05], suggestedRole: 'signer', suggestedValue: null, confidence: 0.82 },
        { key: 'driver_signature', label: 'Driver Signature', type: 'signature', page: 2, bbox: [0.1, 0.8, 0.4, 0.08], suggestedRole: 'signer', confidence: 0.91 }
      ]
    });
    assert.equal(out.documentType, 'lease_agreement');
    assert.equal(out.pageCount, 2);
    assert.equal(out.fields.length, 2);
    assert.equal(out.guardHits, 0);
    assert.deepEqual(out.fields[0].bbox, [0.1, 0.2, 0.3, 0.05]);
    assert.equal(out.fields[0].suggestedValue, null);
    assert.equal(out.fields[1].confidence, 0.91);
    ok('valid detection passes through unchanged');
  }

  {
    // Invalid type + invalid role → coerced to defaults with confidence 0.
    const out = normalizeDetection({
      documentType: 'weird_type',
      pageCount: 1,
      fields: [
        { key: 'x', label: 'X', type: 'radio', page: 1, bbox: [0, 0, 0.1, 0.1], suggestedRole: 'witness', confidence: 0.99 }
      ]
    });
    assert.equal(out.documentType, 'generic'); // invalid doc type → default
    assert.equal(out.fields[0].type, 'text'); // invalid type → default
    assert.equal(out.fields[0].suggestedRole, 'internal'); // invalid role → default
    assert.equal(out.fields[0].confidence, 0); // guard forces 0
    assert.equal(out.guardHits, 1);
    ok('hallucination guard coerces invalid type/role and zeroes confidence');
  }

  {
    // Only one of the two invalid still trips the guard.
    const out = normalizeDetection({
      fields: [
        { key: 'a', label: 'A', type: 'signature', page: 1, bbox: [0, 0, 0, 0], suggestedRole: 'nobody', confidence: 0.7 }
      ]
    });
    assert.equal(out.fields[0].type, 'signature');
    assert.equal(out.fields[0].suggestedRole, 'internal');
    assert.equal(out.fields[0].confidence, 0);
    assert.equal(out.guardHits, 1);
    ok('guard trips when only suggestedRole is invalid');
  }

  {
    // bbox sanitation: wrong length, non-numbers, out-of-range all clamped.
    const out = normalizeDetection({
      fields: [
        { key: 'b1', type: 'text', page: 1, bbox: [1.5, -0.2, 'x', 0.3], suggestedRole: 'internal', confidence: 0.5 },
        { key: 'b2', type: 'text', page: 1, bbox: [0, 0, 0.1], suggestedRole: 'internal', confidence: 0.5 },
        { key: 'b3', type: 'text', page: 1, bbox: 'not-an-array', suggestedRole: 'internal', confidence: 0.5 }
      ]
    });
    assert.deepEqual(out.fields[0].bbox, [1, 0, 0, 0.3]);
    assert.deepEqual(out.fields[1].bbox, [0, 0, 0, 0]); // wrong length → zero box
    assert.deepEqual(out.fields[2].bbox, [0, 0, 0, 0]); // not array → zero box
    ok('bbox values are clamped and malformed boxes zeroed');
  }

  {
    // confidence clamping for valid fields.
    const out = normalizeDetection({
      fields: [
        { key: 'c1', type: 'text', page: 1, bbox: [0, 0, 0, 0], suggestedRole: 'internal', confidence: 1.7 },
        { key: 'c2', type: 'text', page: 1, bbox: [0, 0, 0, 0], suggestedRole: 'internal', confidence: -3 },
        { key: 'c3', type: 'text', page: 1, bbox: [0, 0, 0, 0], suggestedRole: 'internal', confidence: 'nope' }
      ]
    });
    assert.equal(out.fields[0].confidence, 1);
    assert.equal(out.fields[1].confidence, 0);
    assert.equal(out.fields[2].confidence, 0);
    ok('confidence clamped to [0,1] for valid fields');
  }

  {
    // Duplicate / missing keys → unique snake_case keys derived from label.
    const out = normalizeDetection({
      fields: [
        { label: 'Lessee Name', type: 'text', page: 1, suggestedRole: 'signer', confidence: 0.5 },
        { key: 'lessee_name', type: 'text', page: 1, suggestedRole: 'signer', confidence: 0.5 },
        { type: 'text', page: 1, suggestedRole: 'internal', confidence: 0.5 }
      ]
    });
    assert.equal(out.fields[0].key, 'lessee_name');
    assert.equal(out.fields[1].key, 'lessee_name_2'); // de-duped
    assert.equal(out.fields[2].key, 'field_3'); // no key/label → positional
    ok('keys are slugified, de-duplicated, and back-filled');
  }

  {
    // pageCount derives from highest field page when model under-reports.
    const out = normalizeDetection({
      pageCount: 1,
      fields: [
        { key: 'p', type: 'initials', page: 6, bbox: [0, 0, 0, 0], suggestedRole: 'signer', confidence: 0.5 }
      ]
    });
    assert.equal(out.pageCount, 6);
    assert.equal(out.fields[0].page, 6);
    ok('pageCount falls back to highest detected page');
  }

  {
    // Non-object / non-array inputs degrade gracefully.
    const out = normalizeDetection(null);
    assert.equal(out.documentType, 'generic');
    assert.equal(out.pageCount, 1);
    assert.deepEqual(out.fields, []);
    assert.equal(out.guardHits, 0);
    ok('null input yields empty, safe result');
  }

  // ---- validateBody -------------------------------------------------------
  {
    assert.equal(validateBody(null).code, 'AI_BAD_REQUEST');
    assert.equal(validateBody({}).code, 'AI_BAD_REQUEST');
    assert.equal(validateBody({ base64: 'abc' }).code, 'AI_BAD_REQUEST'); // missing contentType
    assert.equal(validateBody({ base64: 'abc', contentType: 'text/plain' }).code, 'AI_BAD_REQUEST');
    assert.equal(validateBody({ fileUrl: 'ftp://x' }).code, 'AI_BAD_REQUEST');
    assert.equal(validateBody({ fileUrl: 'https://x/y.pdf', contentType: 'text/plain' }).code, 'AI_BAD_REQUEST');

    const okUrl = validateBody({ fileUrl: 'https://x/y.pdf', contentType: PDF_TYPE });
    assert.equal(okUrl.ok, true);
    assert.equal(okUrl.fileUrl, 'https://x/y.pdf');

    const okUrlNoCt = validateBody({ fileUrl: 'https://x/y.png' });
    assert.equal(okUrlNoCt.ok, true);

    const okB64 = validateBody({ base64: 'AAAA', contentType: 'image/png' });
    assert.equal(okB64.ok, true);
    assert.equal(typeof okB64.approxBytes, 'number');
    ok('validateBody accepts valid url/base64 and rejects bad inputs');
  }

  {
    // File too large.
    const big = 'A'.repeat(Math.ceil((MAX_FILE_BYTES + 1024) * 4 / 3));
    const out = validateBody({ base64: big, contentType: 'image/jpeg' });
    assert.equal(out.code, 'AI_FILE_TOO_LARGE');
    ok('validateBody rejects oversized base64 payloads');
  }

  // ---- handler happy path -------------------------------------------------
  {
    const res = makeRes();
    const text = JSON.stringify({
      documentType: 'lease_agreement',
      pageCount: 3,
      fields: [
        { key: 'lessee_name', label: 'Lessee Name', type: 'text', page: 1, bbox: [0.1, 0.2, 0.3, 0.04], suggestedRole: 'signer', suggestedValue: null, confidence: 0.8 },
        { key: 'lessor_signature', label: 'Lessor Signature', type: 'signature', page: 3, bbox: [0.1, 0.85, 0.3, 0.06], suggestedRole: 'internal', confidence: 0.9 }
      ]
    });
    const anthropic = makeMockAnthropic(text, { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 });
    await handleAgreementDetectFields(
      { body: { base64: 'AAAA', contentType: 'image/png' } },
      res,
      { anthropic }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.documentType, 'lease_agreement');
    assert.equal(res.body.data.pageCount, 3);
    assert.equal(res.body.data.fields.length, 2);
    assert.equal(res.body.data.fields[0].suggestedRole, 'signer');
    assert.equal(res.body.meta.usage.inputTokens, 1200);
    assert.equal(res.body.meta.usage.cacheReadTokens, 1000);
    assert.equal(typeof res.body.meta.processingTimeMs, 'number');
    ok('handler returns normalized contract with usage meta');
  }

  // ---- handler markdown-fenced JSON ---------------------------------------
  {
    const res = makeRes();
    const text = '```json\n' + JSON.stringify({ documentType: 'generic', pageCount: 1, fields: [] }) + '\n```';
    await handleAgreementDetectFields(
      { body: { fileUrl: 'https://x/y.pdf', contentType: PDF_TYPE } },
      res,
      { anthropic: makeMockAnthropic(text) }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.documentType, 'generic');
    assert.deepEqual(res.body.data.fields, []);
    ok('handler strips markdown fences before parsing');
  }

  // ---- handler retry-once-then-success ------------------------------------
  {
    const res = makeRes();
    const good = JSON.stringify({ documentType: 'generic', pageCount: 1, fields: [] });
    const anthropic = makeRetryAnthropic('this is not json', good);
    await handleAgreementDetectFields(
      { body: { base64: 'AAAA', contentType: 'image/png' } },
      res,
      { anthropic }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(anthropic.callCount(), 2); // retried once
    ok('handler retries once on parse failure then succeeds');
  }

  // ---- handler retry-then-422 ---------------------------------------------
  {
    const res = makeRes();
    const anthropic = makeAlwaysBadAnthropic('still not json');
    await handleAgreementDetectFields(
      { body: { base64: 'AAAA', contentType: 'image/png' } },
      res,
      { anthropic }
    );
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'AI_PARSE_ERROR');
    assert.equal(anthropic.callCount(), 2); // initial + one retry
    ok('handler returns 422 after two parse failures');
  }

  // ---- handler upstream error → 502 ---------------------------------------
  {
    const res = makeRes();
    await handleAgreementDetectFields(
      { body: { base64: 'AAAA', contentType: 'image/png' } },
      res,
      { anthropic: makeThrowingAnthropic(529) }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_UPSTREAM_ERROR');
    ok('handler returns 502 on upstream failure');
  }

  // ---- handler bad request ------------------------------------------------
  {
    const res = makeRes();
    await handleAgreementDetectFields({ body: {} }, res, { anthropic: makeMockAnthropic('{}') });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    ok('handler returns 400 on missing fileUrl/base64');
  }

  // ---- enum exports sanity ------------------------------------------------
  {
    assert.deepEqual(FIELD_TYPES, ['text', 'date', 'number', 'checkbox', 'signature', 'initials']);
    assert.deepEqual(ROLES, ['internal', 'signer']);
    assert.deepEqual(DOC_TYPES, ['lease_agreement', 'generic']);
    ok('contract enums match FN-1787');
  }

  // eslint-disable-next-line no-console
  console.log(`all ${passed} tests passed`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
