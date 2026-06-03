'use strict';

/**
 * FN-1103: Tests for parts-invoice-intake-handler.
 * Standalone — no jest. Mocks both the Anthropic client (via deps.anthropic
 * which the FN-1102 handler honours) and the R2 storage helper (via
 * deps.r2Storage), so no network calls are made.
 */

const assert = require('node:assert/strict');
const {
  handlePartsInvoiceIntake,
  resolveInvoicePayload,
  buildR2Key,
  MAX_FILE_BYTES,
  R2_PREFIX,
} = require('../parts-invoice-intake-handler');

const TINY_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';
const TINY_BUFFER = Buffer.from(TINY_BASE64, 'base64');

const TINY_PDF_BASE64 = Buffer.from('%PDF-1.4\n%dummy', 'utf8').toString('base64');

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

function makeMockAnthropic(modelOutputObj) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (input) => {
        calls.push(input);
        return {
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: JSON.stringify(modelOutputObj) }],
        };
      },
    },
  };
}

function makeMockR2(opts = {}) {
  const calls = [];
  return {
    calls,
    uploadBuffer: async (input) => {
      calls.push(input);
      if (opts.shouldThrow) {
        throw new Error('R2 unavailable');
      }
      return { key: input.key };
    },
  };
}

const HAPPY_AI_OUTPUT = {
  vendor: 'NAPA Auto Parts',
  invoiceNumber: 'INV-12345',
  confidence: { vendor: 0.97, invoiceNumber: 0.92 },
  lineItems: [
    {
      sku: 'OF-7045',
      description: 'Oil Filter Heavy Duty',
      qty: 2,
      unitCost: 12.5,
      manufacturer: 'Fleetguard',
      confidence: { sku: 0.95, description: 0.92, qty: 0.99, unitCost: 0.95, manufacturer: 0.9 },
    },
    {
      sku: 'BR-9921',
      description: 'Brake Pad Set',
      qty: 1,
      unitCost: 89.99,
      manufacturer: 'Bendix',
      confidence: { sku: 0.95, description: 0.93, qty: 0.99, unitCost: 0.95, manufacturer: 0.9 },
    },
  ],
  warnings: [],
};

function testBuildR2KeyShape() {
  assert.match(buildR2Key('image/jpeg'), /^parts\/invoices\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(buildR2Key('image/png').endsWith('.png'), true);
  assert.equal(buildR2Key('image/webp').endsWith('.webp'), true);
  assert.equal(buildR2Key('application/pdf').endsWith('.pdf'), true);
  // eslint-disable-next-line no-console
  console.log('  ok  buildR2Key uses parts/invoices/<uuid>.<ext>');
}

function testResolveInvoicePayloadFromMultipart() {
  const req = {
    file: { buffer: TINY_BUFFER, size: TINY_BUFFER.length, mimetype: 'image/png' },
    body: {},
  };
  const out = resolveInvoicePayload(req);
  assert.equal(out.ok, true);
  assert.equal(out.mimeType, 'image/png');
  assert.equal(out.base64, TINY_BASE64);
  // eslint-disable-next-line no-console
  console.log('  ok  resolveInvoicePayload reads multipart req.file');
}

function testResolveInvoicePayloadFromJsonImage() {
  const req = { body: { base64: TINY_BASE64, mimeType: 'image/jpeg' } };
  const out = resolveInvoicePayload(req);
  assert.equal(out.ok, true);
  assert.equal(out.mimeType, 'image/jpeg');
  assert.equal(out.base64, TINY_BASE64);
  // eslint-disable-next-line no-console
  console.log('  ok  resolveInvoicePayload reads JSON image base64');
}

function testResolveInvoicePayloadFromJsonPdf() {
  const req = { body: { base64: TINY_PDF_BASE64, mimeType: 'application/pdf' } };
  const out = resolveInvoicePayload(req);
  assert.equal(out.ok, true);
  assert.equal(out.mimeType, 'application/pdf');
  // eslint-disable-next-line no-console
  console.log('  ok  resolveInvoicePayload accepts application/pdf');
}

function testResolveInvoicePayloadMissing() {
  const out = resolveInvoicePayload({ body: {} });
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(out.body.code, 'AI_BAD_REQUEST');
  // eslint-disable-next-line no-console
  console.log('  ok  resolveInvoicePayload rejects empty body with 400');
}

function testResolveInvoicePayloadUnsupported() {
  const out = resolveInvoicePayload({ body: { base64: TINY_BASE64, mimeType: 'application/zip' } });
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(out.body.code, 'AI_BAD_REQUEST');
  // eslint-disable-next-line no-console
  console.log('  ok  resolveInvoicePayload rejects unsupported mimeType (e.g. zip)');
}

function testResolveInvoicePayloadOversizedJson() {
  const targetBytes = MAX_FILE_BYTES + 1024;
  const targetB64Len = Math.ceil((targetBytes / 3) * 4) + 16;
  const oversizedB64 = 'A'.repeat(targetB64Len);
  const out = resolveInvoicePayload({ body: { base64: oversizedB64, mimeType: 'image/jpeg' } });
  assert.equal(out.ok, false);
  assert.equal(out.status, 413);
  assert.equal(out.body.code, 'AI_FILE_TOO_LARGE');
  // eslint-disable-next-line no-console
  console.log('  ok  resolveInvoicePayload rejects >20MB JSON file with 413');
}

function testResolveInvoicePayloadOversizedMultipart() {
  const req = {
    file: { buffer: Buffer.alloc(8), size: MAX_FILE_BYTES + 1, mimetype: 'image/jpeg' },
    body: {},
  };
  const out = resolveInvoicePayload(req);
  assert.equal(out.ok, false);
  assert.equal(out.status, 413);
  assert.equal(out.body.code, 'AI_FILE_TOO_LARGE');
  // eslint-disable-next-line no-console
  console.log('  ok  resolveInvoicePayload rejects >20MB multipart with 413');
}

async function testHappyPathMultipartImage() {
  const res = makeRes();
  const r2 = makeMockR2();
  const anthropic = makeMockAnthropic(HAPPY_AI_OUTPUT);
  const deps = { anthropic, r2Storage: r2 };
  const req = {
    file: { buffer: TINY_BUFFER, size: TINY_BUFFER.length, mimetype: 'image/jpeg' },
    body: {},
  };
  await handlePartsInvoiceIntake(req, res, deps);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);

  // r2Key shape: parts/invoices/<uuid>.<ext>
  assert.match(res.body.r2Key, /^parts\/invoices\/[0-9a-f-]{36}\.jpg$/);
  assert.ok(res.body.r2Key.startsWith(`${R2_PREFIX}/`));

  // The aiResult is the FN-1102 envelope
  assert.equal(res.body.aiResult.success, true);
  assert.equal(res.body.aiResult.data.vendor, 'NAPA Auto Parts');
  assert.equal(res.body.aiResult.data.lineItems.length, 2);

  // R2 was called with the user's bytes and our derived key
  assert.equal(r2.calls.length, 1);
  assert.equal(r2.calls[0].contentType, 'image/jpeg');
  assert.ok(Buffer.isBuffer(r2.calls[0].buffer));
  assert.equal(r2.calls[0].key, res.body.r2Key);
  // eslint-disable-next-line no-console
  console.log('  ok  multipart image happy path uploads to R2 and returns aiResult + r2Key');
}

async function testHappyPathJsonPdf() {
  const res = makeRes();
  const r2 = makeMockR2();
  const anthropic = makeMockAnthropic(HAPPY_AI_OUTPUT);
  const req = { body: { base64: TINY_PDF_BASE64, mimeType: 'application/pdf' } };
  await handlePartsInvoiceIntake(req, res, { anthropic, r2Storage: r2 });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.match(res.body.r2Key, /^parts\/invoices\/[0-9a-f-]{36}\.pdf$/);
  assert.equal(res.body.aiResult.data.lineItems.length, 2);
  assert.equal(r2.calls.length, 1);
  assert.equal(r2.calls[0].contentType, 'application/pdf');
  // The FN-1102 handler should have been called with pdfBase64
  assert.equal(anthropic.calls.length, 1);
  // eslint-disable-next-line no-console
  console.log('  ok  JSON PDF happy path uploads to R2 and returns aiResult + r2Key');
}

async function testMissingBodyReturns400() {
  const res = makeRes();
  const r2 = makeMockR2();
  const anthropic = makeMockAnthropic(HAPPY_AI_OUTPUT);
  await handlePartsInvoiceIntake({ body: {} }, res, { anthropic, r2Storage: r2 });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'AI_BAD_REQUEST');
  assert.equal(r2.calls.length, 0);
  assert.equal(anthropic.calls.length, 0);
  // eslint-disable-next-line no-console
  console.log('  ok  missing body returns 400 without R2 / AI calls');
}

async function testOversizeReturns413() {
  const res = makeRes();
  const r2 = makeMockR2();
  const anthropic = makeMockAnthropic(HAPPY_AI_OUTPUT);
  // Build oversized JSON payload
  const targetBytes = MAX_FILE_BYTES + 1024;
  const targetB64Len = Math.ceil((targetBytes / 3) * 4) + 16;
  const oversizedB64 = 'A'.repeat(targetB64Len);
  await handlePartsInvoiceIntake(
    { body: { base64: oversizedB64, mimeType: 'image/jpeg' } },
    res,
    { anthropic, r2Storage: r2 }
  );

  assert.equal(res.statusCode, 413);
  assert.equal(res.body.code, 'AI_FILE_TOO_LARGE');
  assert.equal(r2.calls.length, 0);
  assert.equal(anthropic.calls.length, 0);
  // eslint-disable-next-line no-console
  console.log('  ok  oversize file returns 413 without R2 / AI calls');
}

async function testR2UploadFailureReturns502() {
  const res = makeRes();
  const r2 = makeMockR2({ shouldThrow: true });
  const anthropic = makeMockAnthropic(HAPPY_AI_OUTPUT);
  await handlePartsInvoiceIntake(
    { body: { base64: TINY_BASE64, mimeType: 'image/jpeg' } },
    res,
    { anthropic, r2Storage: r2 }
  );
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'R2_UPLOAD_FAILED');
  // AI must not be called when R2 upload fails first
  assert.equal(anthropic.calls.length, 0);
  // eslint-disable-next-line no-console
  console.log('  ok  R2 upload failure returns 502 R2_UPLOAD_FAILED, vision skipped');
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('parts-invoice-intake-handler tests');

  testBuildR2KeyShape();
  testResolveInvoicePayloadFromMultipart();
  testResolveInvoicePayloadFromJsonImage();
  testResolveInvoicePayloadFromJsonPdf();
  testResolveInvoicePayloadMissing();
  testResolveInvoicePayloadUnsupported();
  testResolveInvoicePayloadOversizedJson();
  testResolveInvoicePayloadOversizedMultipart();

  await testHappyPathMultipartImage();
  await testHappyPathJsonPdf();
  await testMissingBodyReturns400();
  await testOversizeReturns413();
  await testR2UploadFailureReturns502();

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
