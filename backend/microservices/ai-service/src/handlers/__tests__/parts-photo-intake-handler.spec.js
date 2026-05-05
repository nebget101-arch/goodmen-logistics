'use strict';

/**
 * FN-1098: Tests for parts-photo-intake-handler.
 * Standalone — no jest. Mocks both the Anthropic client (via deps.anthropic)
 * and the R2 storage helper (via deps.r2Storage), so no network calls are made.
 */

const assert = require('node:assert/strict');
const {
  handlePartsPhotoIntake,
  resolveImagePayload,
  buildR2Key,
  MAX_IMAGE_BYTES,
  R2_PREFIX,
} = require('../parts-photo-intake-handler');

const TINY_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';
const TINY_BUFFER = Buffer.from(TINY_BASE64, 'base64');

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
  return {
    messages: {
      create: async () => ({
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: JSON.stringify(modelOutputObj) }],
      }),
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
  manufacturer: 'Bosch',
  partNumber: 'F002H20064',
  category: 'Filtration',
  descriptionGuess: 'Spin-on engine oil filter',
  dimensionsGuess: 'approx 4in x 3in diameter',
  confidence: {
    manufacturer: 0.97,
    partNumber: 0.95,
    category: 0.95,
    description: 0.9,
    dimensions: 0.55,
  },
  isUnreadable: false,
  warnings: [],
};

function testBuildR2KeyShape() {
  const key = buildR2Key('image/jpeg');
  assert.match(key, /^parts\/photos\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(buildR2Key('image/png').endsWith('.png'), true);
  assert.equal(buildR2Key('image/webp').endsWith('.webp'), true);
  assert.equal(buildR2Key('image/gif').endsWith('.gif'), true);
  // Unknown mime falls back to .bin (defence in depth — should be rejected upstream)
  assert.equal(buildR2Key('application/x-weird').endsWith('.bin'), true);
  // eslint-disable-next-line no-console
  console.log('  ok  buildR2Key uses parts/photos/<uuid>.<ext>');
}

function testResolveImagePayloadFromMultipart() {
  const req = { file: { buffer: TINY_BUFFER, size: TINY_BUFFER.length, mimetype: 'image/png' }, body: {} };
  const out = resolveImagePayload(req);
  assert.equal(out.ok, true);
  assert.equal(out.mimeType, 'image/png');
  assert.equal(out.base64, TINY_BASE64);
  // eslint-disable-next-line no-console
  console.log('  ok  resolveImagePayload reads multipart req.file');
}

function testResolveImagePayloadFromJson() {
  const req = { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } };
  const out = resolveImagePayload(req);
  assert.equal(out.ok, true);
  assert.equal(out.mimeType, 'image/jpeg');
  assert.equal(out.base64, TINY_BASE64);
  assert.ok(Buffer.isBuffer(out.buffer));
  // eslint-disable-next-line no-console
  console.log('  ok  resolveImagePayload reads JSON imageBase64');
}

function testResolveImagePayloadMissingImage() {
  const out = resolveImagePayload({ body: {} });
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(out.body.code, 'AI_BAD_REQUEST');
  // eslint-disable-next-line no-console
  console.log('  ok  resolveImagePayload rejects empty body with 400');
}

function testResolveImagePayloadUnsupportedMime() {
  const out = resolveImagePayload({ body: { imageBase64: TINY_BASE64, mimeType: 'application/pdf' } });
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(out.body.code, 'AI_BAD_REQUEST');
  // eslint-disable-next-line no-console
  console.log('  ok  resolveImagePayload rejects unsupported mimeType');
}

function testResolveImagePayloadOversizedJson() {
  // Build a base64 string whose decoded size > MAX_IMAGE_BYTES.
  const targetBytes = MAX_IMAGE_BYTES + 1024;
  const targetB64Len = Math.ceil((targetBytes / 3) * 4) + 16;
  const oversizedB64 = 'A'.repeat(targetB64Len);
  const out = resolveImagePayload({ body: { imageBase64: oversizedB64, mimeType: 'image/jpeg' } });
  assert.equal(out.ok, false);
  assert.equal(out.status, 413);
  assert.equal(out.body.code, 'AI_IMAGE_TOO_LARGE');
  // eslint-disable-next-line no-console
  console.log('  ok  resolveImagePayload rejects >10MB JSON image with 413');
}

function testResolveImagePayloadOversizedMultipart() {
  const req = {
    file: { buffer: Buffer.alloc(8), size: MAX_IMAGE_BYTES + 1, mimetype: 'image/jpeg' },
    body: {},
  };
  const out = resolveImagePayload(req);
  assert.equal(out.ok, false);
  assert.equal(out.status, 413);
  assert.equal(out.body.code, 'AI_IMAGE_TOO_LARGE');
  // eslint-disable-next-line no-console
  console.log('  ok  resolveImagePayload rejects >10MB multipart with 413');
}

async function testHappyPathMultipart() {
  const res = makeRes();
  const r2 = makeMockR2();
  const deps = { anthropic: makeMockAnthropic(HAPPY_AI_OUTPUT), r2Storage: r2 };
  const req = {
    file: { buffer: TINY_BUFFER, size: TINY_BUFFER.length, mimetype: 'image/jpeg' },
    body: {},
  };
  await handlePartsPhotoIntake(req, res, deps);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.r2Key.startsWith(`${R2_PREFIX}/`));
  assert.ok(res.body.r2Key.endsWith('.jpg'));
  assert.equal(res.body.aiResult.success, true);
  assert.equal(res.body.aiResult.data.manufacturer, 'Bosch');
  assert.equal(res.body.aiResult.data.partNumber, 'F002H20064');
  assert.equal(typeof res.body.meta.processingTimeMs, 'number');
  assert.ok(res.body.meta.model);

  // R2 was called with the same buffer the user uploaded.
  assert.equal(r2.calls.length, 1);
  assert.equal(r2.calls[0].contentType, 'image/jpeg');
  assert.ok(Buffer.isBuffer(r2.calls[0].buffer));
  assert.equal(r2.calls[0].key, res.body.r2Key);
  // eslint-disable-next-line no-console
  console.log('  ok  multipart happy path uploads to R2 and returns aiResult + r2Key');
}

async function testHappyPathJson() {
  const res = makeRes();
  const r2 = makeMockR2();
  const deps = { anthropic: makeMockAnthropic(HAPPY_AI_OUTPUT), r2Storage: r2 };
  const req = { body: { imageBase64: TINY_BASE64, mimeType: 'image/png' } };
  await handlePartsPhotoIntake(req, res, deps);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.r2Key.endsWith('.png'));
  assert.equal(res.body.aiResult.data.manufacturer, 'Bosch');
  assert.equal(r2.calls.length, 1);
  assert.equal(r2.calls[0].contentType, 'image/png');
  // eslint-disable-next-line no-console
  console.log('  ok  JSON happy path uploads to R2 and returns aiResult + r2Key');
}

async function testUnreadableImageStillReturnsR2Key() {
  const unreadable = {
    manufacturer: null,
    partNumber: null,
    category: null,
    descriptionGuess: null,
    dimensionsGuess: null,
    confidence: { manufacturer: 0, partNumber: 0, category: 0, description: 0, dimensions: 0 },
    isUnreadable: true,
    warnings: ['No part visible.'],
  };
  const res = makeRes();
  const r2 = makeMockR2();
  const deps = { anthropic: makeMockAnthropic(unreadable), r2Storage: r2 };
  await handlePartsPhotoIntake(
    { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
    res,
    deps
  );

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.success, false);
  assert.equal(res.body.aiResult.code, 'AI_IMAGE_UNREADABLE');
  // r2Key still present so the FE can decide to retry vs discard.
  assert.ok(res.body.r2Key.startsWith(`${R2_PREFIX}/`));
  assert.equal(r2.calls.length, 1);
  // eslint-disable-next-line no-console
  console.log('  ok  unreadable image returns 422 with r2Key still set');
}

async function testR2UploadFailureReturns502() {
  const res = makeRes();
  const r2 = makeMockR2({ shouldThrow: true });
  // anthropic should never be called when R2 upload fails first
  let anthropicCalled = false;
  const deps = {
    anthropic: {
      messages: {
        create: async () => {
          anthropicCalled = true;
          return { content: [{ type: 'text', text: '{}' }] };
        },
      },
    },
    r2Storage: r2,
  };
  await handlePartsPhotoIntake(
    { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
    res,
    deps
  );

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'R2_UPLOAD_FAILED');
  assert.equal(anthropicCalled, false);
  // eslint-disable-next-line no-console
  console.log('  ok  R2 upload failure returns 502 R2_UPLOAD_FAILED, vision skipped');
}

async function testMissingImageReturns400() {
  const res = makeRes();
  const r2 = makeMockR2();
  await handlePartsPhotoIntake(
    { body: {} },
    res,
    { anthropic: makeMockAnthropic({}), r2Storage: r2 }
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'AI_BAD_REQUEST');
  assert.equal(r2.calls.length, 0);
  // eslint-disable-next-line no-console
  console.log('  ok  missing image returns 400 without R2 call');
}

async function testUnsupportedMimeReturns400() {
  const res = makeRes();
  const r2 = makeMockR2();
  await handlePartsPhotoIntake(
    { body: { imageBase64: TINY_BASE64, mimeType: 'application/pdf' } },
    res,
    { anthropic: makeMockAnthropic({}), r2Storage: r2 }
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'AI_BAD_REQUEST');
  assert.equal(r2.calls.length, 0);
  // eslint-disable-next-line no-console
  console.log('  ok  unsupported mimeType returns 400 without R2 call');
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('parts-photo-intake-handler tests');

  testBuildR2KeyShape();
  testResolveImagePayloadFromMultipart();
  testResolveImagePayloadFromJson();
  testResolveImagePayloadMissingImage();
  testResolveImagePayloadUnsupportedMime();
  testResolveImagePayloadOversizedJson();
  testResolveImagePayloadOversizedMultipart();

  await testHappyPathMultipart();
  await testHappyPathJson();
  await testUnreadableImageStillReturnsR2Key();
  await testR2UploadFailureReturns502();
  await testMissingImageReturns400();
  await testUnsupportedMimeReturns400();

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
