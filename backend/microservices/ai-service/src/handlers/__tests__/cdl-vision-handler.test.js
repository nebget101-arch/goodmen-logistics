'use strict';

/**
 * FN-1626: Tests for cdl-vision-handler.
 * Runs standalone with `node`. The Anthropic client is mocked via deps.anthropic.
 * Mirrors the pattern used by loads-nlq-handler.test.js and load-driver-match-handler.test.js.
 */

const assert = require('node:assert/strict');

// Spy on logAiInteraction BEFORE requiring the handler — the handler captures
// the function reference at require-time via destructuring, so the spy must be
// installed first. Tests use the `loggerCalls` array to inspect every call.
const loggerModule = require('../../analytics/logger');
const originalLogAiInteraction = loggerModule.logAiInteraction;
const loggerCalls = [];
loggerModule.logAiInteraction = (payload) => { loggerCalls.push(payload); };

const {
  handleCdlVision,
  FIELD_KEYS
} = require('../cdl-vision-handler');

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

function fullValidLlmFields(overrides = {}) {
  // A complete, valid LLM response. Tests override individual fields.
  const base = {
    firstName:     { value: 'JOHN',          confidence: 0.95 },
    middleName:    { value: 'Q',             confidence: 0.8  },
    lastName:      { value: 'DOE',           confidence: 0.95 },
    dateOfBirth:   { value: '1985-04-12',    confidence: 0.9  },
    streetAddress: { value: '123 Main St',   confidence: 0.85 },
    city:          { value: 'Dallas',        confidence: 0.85 },
    state:         { value: 'TX',            confidence: 0.95 },
    zipCode:       { value: '75201',         confidence: 0.9  },
    cdlNumber:     { value: '12345678',      confidence: 0.9  },
    cdlState:      { value: 'TX',            confidence: 0.95 },
    cdlClass:      { value: 'A',             confidence: 0.95 },
    cdlExpiry:     { value: '2030-04-12',    confidence: 0.85 }
  };
  return { ...base, ...overrides };
}

function makeMockAnthropic(modelOutputObj, { capture, throwErr } = {}) {
  return {
    messages: {
      create: async (req) => {
        if (capture) capture.lastRequest = req;
        if (throwErr) throw throwErr;
        return {
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: JSON.stringify(modelOutputObj) }]
        };
      }
    }
  };
}

// A small valid PNG-ish base64 payload (just bytes — content doesn't matter
// because the Anthropic call is mocked). Decodes to ~6 bytes.
const TINY_BASE64 = Buffer.from('hello!').toString('base64');

function clearLoggerCalls() {
  loggerCalls.length = 0;
}

// Mark these as referenced for linters that flag unused requires.
void originalLogAiInteraction;

async function runCase(name, fn) {
  try {
    await fn();
    // eslint-disable-next-line no-console
    console.log(`  ok  ${name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('cdl-vision-handler tests');

  // ---- 1. missing imageBase64 → 400 AI_BAD_REQUEST ----
  await runCase('missing imageBase64 returns 400 AI_BAD_REQUEST', async () => {
    const res = makeRes();
    await handleCdlVision(
      { body: { mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeMockAnthropic(fullValidLlmFields()) }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    assert.equal(res.body.error, 'imageBase64 is required');
  });

  // ---- 2. missing mimeType → 400 AI_BAD_REQUEST ----
  await runCase('missing mimeType returns 400 AI_BAD_REQUEST', async () => {
    const res = makeRes();
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64 } },
      res,
      { anthropic: makeMockAnthropic(fullValidLlmFields()) }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    assert.equal(res.body.error, 'invalid mimeType');
  });

  // ---- 3. invalid mimeType (image/gif) → 400 AI_BAD_REQUEST ----
  await runCase('invalid mimeType returns 400 AI_BAD_REQUEST', async () => {
    const res = makeRes();
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64, mimeType: 'image/gif' } },
      res,
      { anthropic: makeMockAnthropic(fullValidLlmFields()) }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    assert.equal(res.body.error, 'invalid mimeType');
  });

  // ---- 4. oversize image (>10 MB) → 400 'cdl image too large' ----
  await runCase('oversize image returns 400 cdl image too large', async () => {
    // Build a base64 string whose decoded size exceeds 10 MB. base64 inflates
    // 3 bytes -> 4 chars, so we need >10*1024*1024 decoded bytes ⇒
    // > 13_981_013 chars. Use a generous 14_000_004-char payload (multiple of 4).
    const huge = 'A'.repeat(14_000_004);
    let llmCalled = false;
    const deps = {
      anthropic: {
        messages: {
          create: async () => {
            llmCalled = true;
            return { model: 'x', content: [{ type: 'text', text: '{}' }] };
          }
        }
      }
    };
    const res = makeRes();
    await handleCdlVision(
      { body: { imageBase64: huge, mimeType: 'image/png' } },
      res,
      deps
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    assert.equal(res.body.error, 'cdl image too large');
    assert.equal(llmCalled, false, 'LLM must not be called on oversize input');
  });

  // ---- 5. Hallucination — zip ----
  await runCase('zip "ABCDE" is coerced to {value: null, confidence: 0}', async () => {
    const res = makeRes();
    const llmFields = fullValidLlmFields({
      zipCode: { value: 'ABCDE', confidence: 0.9 }
    });
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeMockAnthropic(llmFields) }
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.fields.zipCode, { value: null, confidence: 0 });
    // Other fields stay valid.
    assert.equal(res.body.fields.firstName.value, 'JOHN');
  });

  // ---- 6. Hallucination — state ----
  await runCase('state "XX" is coerced to {value: null, confidence: 0}', async () => {
    const res = makeRes();
    const llmFields = fullValidLlmFields({
      state: { value: 'XX', confidence: 0.9 }
    });
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeMockAnthropic(llmFields) }
    );
    assert.deepEqual(res.body.fields.state, { value: null, confidence: 0 });
  });

  // ---- 7. Hallucination — class ----
  await runCase('cdlClass "D" is coerced to {value: null, confidence: 0}', async () => {
    const res = makeRes();
    const llmFields = fullValidLlmFields({
      cdlClass: { value: 'D', confidence: 0.9 }
    });
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeMockAnthropic(llmFields) }
    );
    assert.deepEqual(res.body.fields.cdlClass, { value: null, confidence: 0 });
  });

  // ---- 8. Hallucination — date (year < 1900) ----
  await runCase('dateOfBirth "1850-01-01" is coerced to {value: null, confidence: 0}', async () => {
    const res = makeRes();
    const llmFields = fullValidLlmFields({
      dateOfBirth: { value: '1850-01-01', confidence: 0.9 }
    });
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeMockAnthropic(llmFields) }
    );
    assert.deepEqual(res.body.fields.dateOfBirth, { value: null, confidence: 0 });
  });

  // ---- 9. Happy path: full valid LLM output ----
  await runCase('happy path returns success + all 12 fields + meta', async () => {
    const res = makeRes();
    const llmFields = fullValidLlmFields();
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeMockAnthropic(llmFields) }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.fields && typeof res.body.fields === 'object');

    for (const key of FIELD_KEYS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(res.body.fields, key),
        `expected field "${key}" in response`
      );
      assert.ok(typeof res.body.fields[key] === 'object');
      assert.ok('value' in res.body.fields[key]);
      assert.ok('confidence' in res.body.fields[key]);
    }
    // Spot-check a couple of values.
    assert.equal(res.body.fields.firstName.value, 'JOHN');
    assert.equal(res.body.fields.cdlClass.value, 'A');
    assert.equal(res.body.fields.state.value, 'TX');

    // meta
    assert.ok(res.body.meta);
    assert.equal(typeof res.body.meta.model, 'string');
    assert.ok(res.body.meta.model.length > 0);
    assert.equal(typeof res.body.meta.processingMs, 'number');
  });

  // ---- 10. Cache assertion: system block must enable ephemeral caching ----
  await runCase('messages.create system uses cache_control: ephemeral', async () => {
    const res = makeRes();
    const capture = {};
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeMockAnthropic(fullValidLlmFields(), { capture }) }
    );
    const sentReq = capture.lastRequest;
    assert.ok(sentReq, 'expected anthropic.messages.create to be called');
    assert.ok(Array.isArray(sentReq.system), 'system must be an array of blocks for caching');
    const cached = sentReq.system.find(
      (b) => b && b.cache_control && b.cache_control.type === 'ephemeral'
    );
    assert.ok(cached, 'expected at least one system block with cache_control: ephemeral');
    assert.equal(cached.type, 'text');
    assert.ok(typeof cached.text === 'string' && cached.text.length > 0);
  });

  // ---- 11. 502 path: anthropic SDK throws → AI_UPSTREAM_ERROR ----
  await runCase('anthropic SDK throw returns 502 AI_UPSTREAM_ERROR', async () => {
    const res = makeRes();
    const err = new Error('upstream boom');
    err.status = 503;
    const deps = {
      anthropic: makeMockAnthropic(null, { throwErr: err })
    };
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
      res,
      deps
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_UPSTREAM_ERROR');
  });

  // ---- 12. No-PII logging: logAiInteraction must NOT contain field values ----
  await runCase('logAiInteraction calls do not contain any field values', async () => {
    clearLoggerCalls();
    const llmFields = fullValidLlmFields({
      firstName: { value: 'JOHN',     confidence: 0.95 },
      lastName:  { value: 'DOE',      confidence: 0.95 },
      cdlNumber: { value: '12345678', confidence: 0.9  }
    });
    const res = makeRes();
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeMockAnthropic(llmFields) }
    );
    assert.equal(res.statusCode, 200);
    assert.ok(loggerCalls.length > 0, 'expected at least one logAiInteraction call');

    const forbidden = ['JOHN', 'DOE', '12345678', '123 Main St', 'Dallas', '75201', '1985-04-12'];
    for (const call of loggerCalls) {
      const serialized = JSON.stringify(call);
      for (const needle of forbidden) {
        assert.ok(
          !serialized.includes(needle),
          `logger arg leaked field value "${needle}" — call=${serialized}`
        );
      }
    }
  });

  // ---- bonus: failure path also avoids PII leak ----
  await runCase('failure path log also has no PII', async () => {
    clearLoggerCalls();
    const err = new Error('boom');
    err.status = 502;
    const res = makeRes();
    await handleCdlVision(
      { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeMockAnthropic(null, { throwErr: err }) }
    );
    assert.equal(res.statusCode, 502);
    assert.ok(loggerCalls.length > 0);
    // None of the calls should contain anything that looks like a CDL value.
    for (const call of loggerCalls) {
      const serialized = JSON.stringify(call);
      for (const needle of ['JOHN', 'DOE', '12345678']) {
        assert.ok(
          !serialized.includes(needle),
          `failure-path logger arg leaked "${needle}"`
        );
      }
    }
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
