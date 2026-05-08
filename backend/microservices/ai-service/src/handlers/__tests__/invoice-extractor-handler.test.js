'use strict';

/**
 * FN-1489: Tests for invoice-extractor-handler.
 * Runs standalone with `node`. No jest required.
 * Anthropic SDK and pg pool are injected via deps so no real network/DB calls happen.
 */

const assert = require('node:assert/strict');
const {
  handleInvoiceExtract,
  buildSystemBlocks,
  validateBody,
  normalizeExtraction,
  parseAiResponse,
  DEFAULT_MODEL
} = require('../invoice-extractor-handler');
const { matchSkus, normalizeSku } = require('../parts-matcher');

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

function makeAnthropic({ scriptedResponses = [], onCreate } = {}) {
  const calls = [];
  let i = 0;
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        if (onCreate) return onCreate(args, calls.length - 1);
        const next = scriptedResponses[i] || scriptedResponses[scriptedResponses.length - 1];
        i += 1;
        if (next instanceof Error) throw next;
        return next;
      }
    }
  };
}

function makePool(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    }
  };
}

function makeAiBody(jsonObj) {
  return {
    model: DEFAULT_MODEL,
    content: [{ type: 'text', text: JSON.stringify(jsonObj) }],
    usage: {
      input_tokens: 1200,
      output_tokens: 200,
      cache_read_input_tokens: 1100,
      cache_creation_input_tokens: 0
    }
  };
}

const FAKE_PNG_BASE64 = Buffer.from('fake-png-bytes').toString('base64');

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
  console.log('invoice-extractor-handler tests');

  // --- prompt-caching shape -------------------------------------------------
  await runCase('system blocks include cache_control on system + schema', async () => {
    const blocks = buildSystemBlocks();
    assert.equal(blocks.length, 2, 'two cached blocks expected');
    for (const b of blocks) {
      assert.equal(b.type, 'text');
      assert.deepEqual(b.cache_control, { type: 'ephemeral' });
      assert.ok(b.text && b.text.length > 0);
    }
  });

  // --- validateBody ---------------------------------------------------------
  await runCase('validateBody rejects empty body', () => {
    const v = validateBody(null);
    assert.equal(v.code, 'AI_BAD_REQUEST');
  });

  await runCase('validateBody rejects unsupported contentType', () => {
    const v = validateBody({ base64: 'aaaa', contentType: 'application/zip' });
    assert.equal(v.code, 'AI_BAD_REQUEST');
  });

  await runCase('validateBody rejects too-large file', () => {
    const v = validateBody({ base64: 'a'.repeat(20 * 1024 * 1024), contentType: 'image/png' });
    assert.equal(v.code, 'AI_FILE_TOO_LARGE');
  });

  await runCase('validateBody accepts image base64', () => {
    const v = validateBody({ base64: FAKE_PNG_BASE64, contentType: 'image/png' });
    assert.ok(v.ok);
    assert.equal(v.contentType, 'image/png');
  });

  await runCase('validateBody accepts pdf base64', () => {
    const v = validateBody({ base64: FAKE_PNG_BASE64, contentType: 'application/pdf' });
    assert.ok(v.ok);
    assert.equal(v.contentType, 'application/pdf');
  });

  await runCase('validateBody accepts http url', () => {
    const v = validateBody({ fileUrl: 'https://example.com/i.pdf', contentType: 'application/pdf' });
    assert.ok(v.ok);
    assert.equal(v.fileUrl, 'https://example.com/i.pdf');
  });

  await runCase('validateBody rejects non-http url', () => {
    const v = validateBody({ fileUrl: 'ftp://example.com/i.pdf' });
    assert.equal(v.code, 'AI_BAD_REQUEST');
  });

  // --- normalizeExtraction --------------------------------------------------
  await runCase('normalizeExtraction coerces strings + numbers, drops bad lines', () => {
    const out = normalizeExtraction({
      vendorName: '  Acme Parts  ',
      referenceNumber: 'INV-42',
      invoiceDate: '2026-04-01',
      lines: [
        { sku: 'A1', description: 'Filter', qty: '3', unitCost: '$12.50' },
        null,
        { sku: '', description: '', qty: 'x', unitCost: 'y' }
      ]
    });
    assert.equal(out.vendor, 'Acme Parts');
    assert.equal(out.reference, 'INV-42');
    assert.equal(out.invoiceDate, '2026-04-01');
    assert.equal(out.lines.length, 2);
    assert.deepEqual(out.lines[0], { sku: 'A1', description: 'Filter', qty: 3, unitCost: 12.5 });
    assert.deepEqual(out.lines[1], { sku: null, description: '', qty: 1, unitCost: 0 });
  });

  await runCase('normalizeExtraction tolerates missing fields', () => {
    const out = normalizeExtraction({});
    assert.equal(out.vendor, null);
    assert.equal(out.reference, null);
    assert.equal(out.invoiceDate, null);
    assert.deepEqual(out.lines, []);
  });

  // --- parts matcher --------------------------------------------------------
  await runCase('normalizeSku trims + uppercases', () => {
    assert.equal(normalizeSku('  abc-1 '), 'ABC-1');
    assert.equal(normalizeSku(''), null);
    assert.equal(normalizeSku(null), null);
  });

  await runCase('matchSkus correlates input casing back to DB rows', async () => {
    const pool = makePool([
      { id: 'p-1', sku: 'ABC-1', name: 'Filter' },
      { id: 'p-2', sku: 'XYZ-9', name: 'Belt' }
    ]);
    const out = await matchSkus({ pool, skus: ['abc-1', 'XYZ-9', 'missing'] });
    assert.equal(out.size, 2);
    assert.deepEqual(out.get('abc-1'), { partId: 'p-1', sku: 'ABC-1', name: 'Filter' });
    assert.deepEqual(out.get('XYZ-9'), { partId: 'p-2', sku: 'XYZ-9', name: 'Belt' });
    assert.equal(out.has('missing'), false);
    assert.equal(pool.calls.length, 1);
    assert.match(pool.calls[0].sql, /UPPER\(sku\) IN/);
    // dedup: 'abc-1' and 'XYZ-9' and 'MISSING' → 3 keys
    assert.equal(pool.calls[0].params.length, 3);
  });

  await runCase('matchSkus returns empty on empty input', async () => {
    const out = await matchSkus({ pool: makePool([]), skus: [] });
    assert.equal(out.size, 0);
  });

  // --- handler — happy path -------------------------------------------------
  await runCase('handler returns extracted lines with matches and usage', async () => {
    const anthropic = makeAnthropic({
      scriptedResponses: [
        makeAiBody({
          vendorName: 'Acme Parts',
          referenceNumber: 'INV-42',
          invoiceDate: '2026-04-01',
          lines: [
            { sku: 'OF-100', description: 'Oil filter', qty: 4, unitCost: 7.5 },
            { sku: 'BR-22', description: 'Brake pad', qty: 2, unitCost: 35 },
            { sku: null, description: 'Misc shop supplies', qty: 1, unitCost: 12 }
          ]
        })
      ]
    });
    const pool = makePool([{ id: 'p-100', sku: 'OF-100', name: 'Oil Filter' }]);

    const res = makeRes();
    await handleInvoiceExtract(
      { body: { base64: FAKE_PNG_BASE64, contentType: 'image/png' } },
      res,
      { anthropic, pool }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.vendor, 'Acme Parts');
    assert.equal(res.body.data.reference, 'INV-42');
    assert.equal(res.body.data.invoiceDate, '2026-04-01');
    assert.equal(res.body.data.lines.length, 3);

    assert.deepEqual(res.body.data.lines[0].match, { partId: 'p-100', sku: 'OF-100', name: 'Oil Filter' });
    assert.equal(res.body.data.lines[1].match, null);
    assert.equal(res.body.data.lines[2].match, null);

    assert.equal(res.body.meta.model, DEFAULT_MODEL);
    assert.equal(res.body.meta.usage.cacheReadTokens, 1100);

    // Anthropic was called exactly once (no retry)
    assert.equal(anthropic.calls.length, 1);
    const callArgs = anthropic.calls[0];
    // System prompt is split into cached blocks
    assert.ok(Array.isArray(callArgs.system));
    assert.equal(callArgs.system.length, 2);
    assert.deepEqual(callArgs.system[0].cache_control, { type: 'ephemeral' });
    // user content includes an image block + text
    const userContent = callArgs.messages[0].content;
    assert.equal(userContent[0].type, 'image');
    assert.equal(userContent[0].source.media_type, 'image/png');
  });

  // --- handler — PDF document path -----------------------------------------
  await runCase('handler routes pdf to document block', async () => {
    const anthropic = makeAnthropic({
      scriptedResponses: [
        makeAiBody({ vendorName: 'V', referenceNumber: null, invoiceDate: null, lines: [] })
      ]
    });
    const res = makeRes();
    await handleInvoiceExtract(
      { body: { base64: FAKE_PNG_BASE64, contentType: 'application/pdf' } },
      res,
      { anthropic, pool: null }
    );
    assert.equal(res.statusCode, 200);
    const userContent = anthropic.calls[0].messages[0].content;
    assert.equal(userContent[0].type, 'document');
    assert.equal(userContent[0].source.media_type, 'application/pdf');
  });

  // --- handler — fileUrl path -----------------------------------------------
  await runCase('handler accepts fileUrl + treats unknown content as image', async () => {
    const anthropic = makeAnthropic({
      scriptedResponses: [
        makeAiBody({ vendorName: 'V', referenceNumber: null, invoiceDate: null, lines: [] })
      ]
    });
    const res = makeRes();
    await handleInvoiceExtract(
      { body: { fileUrl: 'https://files.example/x.png' } },
      res,
      { anthropic, pool: null }
    );
    assert.equal(res.statusCode, 200);
    const block = anthropic.calls[0].messages[0].content[0];
    assert.equal(block.type, 'image');
    assert.equal(block.source.type, 'url');
    assert.equal(block.source.url, 'https://files.example/x.png');
  });

  // --- handler — retry on parse failure ------------------------------------
  await runCase('handler retries once when AI returns unparseable JSON', async () => {
    let i = 0;
    const anthropic = makeAnthropic({
      onCreate: async () => {
        i += 1;
        if (i === 1) {
          return {
            model: DEFAULT_MODEL,
            content: [{ type: 'text', text: 'sorry, here is the data: not json' }],
            usage: {}
          };
        }
        return makeAiBody({
          vendorName: 'V',
          referenceNumber: 'R',
          invoiceDate: '2026-01-01',
          lines: [{ sku: 'A', description: 'd', qty: 1, unitCost: 2 }]
        });
      }
    });
    const res = makeRes();
    await handleInvoiceExtract(
      { body: { base64: FAKE_PNG_BASE64, contentType: 'image/png' } },
      res,
      { anthropic, pool: null }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.lines.length, 1);
    assert.equal(anthropic.calls.length, 2);
    // The retry user message reinforces "ONLY JSON"
    const retryUserText = anthropic.calls[1].messages[0].content[1].text;
    assert.match(retryUserText, /ONLY/);
  });

  // --- handler — 422 after second parse failure ----------------------------
  await runCase('handler returns 422 after two parse failures', async () => {
    const anthropic = makeAnthropic({
      onCreate: async () => ({
        model: DEFAULT_MODEL,
        content: [{ type: 'text', text: 'still not json' }],
        usage: {}
      })
    });
    const res = makeRes();
    await handleInvoiceExtract(
      { body: { base64: FAKE_PNG_BASE64, contentType: 'image/png' } },
      res,
      { anthropic, pool: null }
    );
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_PARSE_ERROR');
    assert.equal(anthropic.calls.length, 2);
  });

  // --- handler — 502 on upstream failure ------------------------------------
  await runCase('handler returns 502 when Anthropic throws', async () => {
    const err = new Error('boom');
    err.status = 503;
    const anthropic = makeAnthropic({
      onCreate: async () => { throw err; }
    });
    const res = makeRes();
    await handleInvoiceExtract(
      { body: { base64: FAKE_PNG_BASE64, contentType: 'image/png' } },
      res,
      { anthropic, pool: null }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_UPSTREAM_ERROR');
  });

  // --- handler — 400 on validation failure ----------------------------------
  await runCase('handler returns 400 when body is invalid', async () => {
    const res = makeRes();
    await handleInvoiceExtract({ body: {} }, res, { anthropic: makeAnthropic(), pool: null });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
  });

  // --- handler — DB error does not break extraction -------------------------
  await runCase('handler returns lines with null match when parts query throws', async () => {
    const anthropic = makeAnthropic({
      scriptedResponses: [
        makeAiBody({
          vendorName: 'V',
          referenceNumber: null,
          invoiceDate: null,
          lines: [{ sku: 'A1', description: 'd', qty: 1, unitCost: 2 }]
        })
      ]
    });
    const failingPool = {
      query: async () => { throw new Error('db down'); }
    };
    const res = makeRes();
    await handleInvoiceExtract(
      { body: { base64: FAKE_PNG_BASE64, contentType: 'image/png' } },
      res,
      { anthropic, pool: failingPool }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.lines[0].match, null);
  });

  // --- parser sanity --------------------------------------------------------
  await runCase('parseAiResponse strips ``` fences', () => {
    const obj = parseAiResponse('```json\n{"a":1}\n```');
    assert.deepEqual(obj, { a: 1 });
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
