'use strict';

/**
 * FN-1102: Tests for parts-invoice-vision-handler.
 * Standalone — runs with `node`, no jest/mocha.
 * Anthropic client is mocked via deps.anthropic.
 */

const assert = require('node:assert/strict');
const {
  handlePartsInvoiceVision,
  validateExtractionResult,
  parseAiResponse,
  SUPPORTED_PDF_TYPE,
} = require('../parts-invoice-vision-handler');

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
    },
  };
}

function makeAnthropic(textPayload) {
  const text = typeof textPayload === 'string' ? textPayload : JSON.stringify(textPayload);
  return {
    messages: {
      create: async (args) => ({
        model: args.model,
        content: [{ type: 'text', text }],
      }),
    },
  };
}

function makeAnthropicCapture(textPayload) {
  const captured = { lastCall: null };
  const text = typeof textPayload === 'string' ? textPayload : JSON.stringify(textPayload);
  captured.client = {
    messages: {
      create: async (args) => {
        captured.lastCall = args;
        return {
          model: args.model,
          content: [{ type: 'text', text }],
        };
      },
    },
  };
  return captured;
}

function makeThrowingAnthropic(err) {
  return {
    messages: {
      create: async () => {
        throw err;
      },
    },
  };
}

async function run(name, fn) {
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
  console.log('parts-invoice-vision-handler tests');

  // ---------- pure validators ----------
  await run('validateExtractionResult clamps confidence + coerces qty/unitCost', () => {
    const out = validateExtractionResult({
      vendor: '  NAPA Auto Parts  ',
      invoiceNumber: 'INV-12345',
      confidence: { vendor: 1.4, invoiceNumber: -0.2 },
      lineItems: [
        {
          sku: 'BRK-001',
          description: 'Brake pad set',
          qty: '4',
          unitCost: '$24.50',
          manufacturer: 'Wagner',
          category: 'Brakes',
          confidence: { sku: 0.9, description: 0.95, qty: 0.9, unitCost: 0.85, manufacturer: 0.8, category: 0.95 },
        },
      ],
      warnings: ['watermark obscures 2nd page', 42],
    });
    assert.equal(out.vendor, 'NAPA Auto Parts');
    assert.equal(out.invoiceNumber, 'INV-12345');
    assert.equal(out.confidence.vendor, 1);
    assert.equal(out.confidence.invoiceNumber, 0);
    assert.equal(out.lineItems.length, 1);
    assert.equal(out.lineItems[0].qty, 4);
    assert.equal(out.lineItems[0].unitCost, 24.5);
    assert.equal(out.lineItems[0].category, 'Brakes');
    assert.equal(out.lineItems[0].confidence.category, 0.95);
    assert.deepEqual(out.warnings, ['watermark obscures 2nd page']);
  });

  await run('validateExtractionResult fills defaults for missing fields', () => {
    const out = validateExtractionResult({});
    assert.equal(out.vendor, '');
    assert.equal(out.invoiceNumber, '');
    assert.deepEqual(out.confidence, { vendor: 0, invoiceNumber: 0 });
    assert.deepEqual(out.lineItems, []);
    assert.deepEqual(out.warnings, []);
  });

  await run('validateExtractionResult round-trips category=null and clamps confidence.category', () => {
    const out = validateExtractionResult({
      vendor: 'NAPA',
      invoiceNumber: 'X',
      confidence: { vendor: 1, invoiceNumber: 1 },
      lineItems: [
        {
          sku: 'X-1',
          description: 'Misc shop supply',
          qty: 1,
          unitCost: 1,
          manufacturer: '',
          category: null,
          confidence: { sku: 0.5, description: 0.5, qty: 1, unitCost: 1, manufacturer: 0, category: 0.1 },
        },
        {
          sku: 'X-2',
          description: 'Unclear line',
          qty: 1,
          unitCost: 0,
          manufacturer: '',
          // category omitted entirely — must default to null
          confidence: { sku: 0, description: 0.4, qty: 0.7, unitCost: 0 },
        },
        {
          sku: 'X-3',
          description: 'Overconfident line',
          qty: 1,
          unitCost: 0,
          manufacturer: '',
          category: 'Engine',
          confidence: { category: 1.4 },
        },
      ],
      warnings: [],
    });
    assert.equal(out.lineItems.length, 3);
    assert.equal(out.lineItems[0].category, null);
    assert.equal(out.lineItems[0].confidence.category, 0.1);
    // missing -> null + confidence 0
    assert.equal(out.lineItems[1].category, null);
    assert.equal(out.lineItems[1].confidence.category, 0);
    // out-of-range confidence -> clamped
    assert.equal(out.lineItems[2].category, 'Engine');
    assert.equal(out.lineItems[2].confidence.category, 1);
  });

  await run('parseAiResponse strips markdown fences', () => {
    const obj = parseAiResponse('```json\n{"vendor":"X"}\n```');
    assert.deepEqual(obj, { vendor: 'X' });
  });

  // ---------- handler: bad-request paths ----------
  await run('400 when neither imageBase64 nor pdfBase64 provided', async () => {
    const res = makeRes();
    await handlePartsInvoiceVision({ body: {} }, res, { anthropic: makeAnthropic({}) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
  });

  await run('400 when image mediaType unsupported', async () => {
    const res = makeRes();
    await handlePartsInvoiceVision(
      { body: { imageBase64: 'abc', mediaType: 'image/tiff' } },
      res,
      { anthropic: makeAnthropic({}) }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
  });

  // ---------- handler: happy path (image) ----------
  await run('happy path image — multi-line extraction returns 200 with normalised data', async () => {
    const cap = makeAnthropicCapture({
      vendor: "O'Reilly Auto Parts",
      invoiceNumber: 'OR-9981',
      confidence: { vendor: 0.98, invoiceNumber: 0.92 },
      lineItems: [
        {
          sku: 'OIL-5W30',
          description: 'Mobil 1 5W-30 synthetic 5qt',
          qty: 6,
          unitCost: 28.99,
          manufacturer: 'Mobil',
          category: 'Fluids',
          confidence: { sku: 0.95, description: 0.96, qty: 0.99, unitCost: 0.98, manufacturer: 0.94, category: 0.97 },
        },
        {
          sku: 'FLT-OIL-12',
          description: 'Oil filter',
          qty: 6,
          unitCost: 7.49,
          manufacturer: 'WIX',
          category: 'Filters',
          confidence: { sku: 0.9, description: 0.95, qty: 0.99, unitCost: 0.97, manufacturer: 0.85, category: 0.93 },
        },
        {
          sku: '',
          description: 'Hand-written add-on: brake cleaner',
          qty: 2,
          unitCost: 4.5,
          manufacturer: '',
          category: null,
          confidence: { sku: 0, description: 0.62, qty: 0.7, unitCost: 0.55, manufacturer: 0, category: 0.2 },
        },
      ],
      warnings: [],
    });

    const res = makeRes();
    await handlePartsInvoiceVision(
      { body: { imageBase64: 'fakebase64', mimeType: 'image/png' } },
      res,
      { anthropic: cap.client }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.vendor, "O'Reilly Auto Parts");
    assert.equal(res.body.data.invoiceNumber, 'OR-9981');
    assert.equal(res.body.data.lineItems.length, 3);
    // partial extraction visible: low-confidence hand-written line
    assert.ok(res.body.data.lineItems[2].confidence.unitCost < 0.7);
    assert.ok(res.body.data.lineItems[2].confidence.description < 0.7);
    // all fields present even on the sparse line
    assert.equal(res.body.data.lineItems[2].sku, '');
    assert.equal(res.body.data.lineItems[2].manufacturer, '');
    // category is present on every line; null round-trips for the ambiguous handwritten line
    assert.equal(res.body.data.lineItems[0].category, 'Fluids');
    assert.equal(res.body.data.lineItems[0].confidence.category, 0.97);
    assert.equal(res.body.data.lineItems[1].category, 'Filters');
    assert.equal(res.body.data.lineItems[2].category, null);
    assert.equal(res.body.data.lineItems[2].confidence.category, 0.2);
    assert.equal(typeof res.body.processingTimeMs, 'number');

    // request shape: image content block
    assert.equal(cap.lastCall.messages[0].content[0].type, 'image');
    assert.equal(cap.lastCall.messages[0].content[0].source.media_type, 'image/png');
    assert.equal(cap.lastCall.temperature, 0.1);
  });

  // ---------- handler: happy path (PDF) ----------
  await run('happy path pdf — uses document content block', async () => {
    const cap = makeAnthropicCapture({
      vendor: 'Carquest',
      invoiceNumber: 'CQ-77',
      confidence: { vendor: 0.99, invoiceNumber: 0.99 },
      lineItems: [
        {
          sku: 'BAT-31',
          description: 'Group 31 commercial battery',
          qty: 1,
          unitCost: 189.0,
          manufacturer: 'Interstate',
          category: 'Electrical',
          confidence: { sku: 0.99, description: 0.99, qty: 0.99, unitCost: 0.99, manufacturer: 0.95, category: 0.96 },
        },
      ],
      warnings: [],
    });

    const res = makeRes();
    await handlePartsInvoiceVision(
      { body: { pdfBase64: 'fakebase64' } },
      res,
      { anthropic: cap.client }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.lineItems[0].sku, 'BAT-31');
    assert.equal(res.body.data.lineItems[0].category, 'Electrical');
    assert.equal(cap.lastCall.messages[0].content[0].type, 'document');
    assert.equal(cap.lastCall.messages[0].content[0].source.media_type, SUPPORTED_PDF_TYPE);
  });

  // ---------- handler: malformed JSON ----------
  await run('502 AI_PARSE_ERROR when AI returns non-JSON prose', async () => {
    const res = makeRes();
    await handlePartsInvoiceVision(
      { body: { imageBase64: 'abc', mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeAnthropic('I cannot read this invoice clearly, sorry!') }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_PARSE_ERROR');
  });

  // ---------- handler: unreadable invoice ----------
  await run('422 AI_INVOICE_UNREADABLE when AI returns empty vendor + lineItems', async () => {
    const res = makeRes();
    await handlePartsInvoiceVision(
      { body: { imageBase64: 'abc', mimeType: 'image/jpeg' } },
      res,
      {
        anthropic: makeAnthropic({
          vendor: '',
          invoiceNumber: '',
          confidence: { vendor: 0, invoiceNumber: 0 },
          lineItems: [],
          warnings: ['image too blurry to read'],
        }),
      }
    );
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'AI_INVOICE_UNREADABLE');
    assert.deepEqual(res.body.warnings, ['image too blurry to read']);
  });

  // ---------- handler: API error ----------
  await run('502 AI_VISION_ERROR when Anthropic SDK throws', async () => {
    const res = makeRes();
    const err = new Error('upstream timeout');
    err.status = 504;
    await handlePartsInvoiceVision(
      { body: { imageBase64: 'abc', mimeType: 'image/jpeg' } },
      res,
      { anthropic: makeThrowingAnthropic(err) }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_VISION_ERROR');
    assert.equal(res.body.details, 'upstream timeout');
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
