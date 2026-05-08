'use strict';

/**
 * FN-1097: Tests for parts-vision-handler.
 * Runs standalone with `node`. No jest/mocha required.
 * The Anthropic client is mocked via deps.anthropic so no real API calls are made.
 */

const assert = require('node:assert/strict');
const {
  handlePartsVision,
  validateExtractionResult,
  clampConfidence,
  CONFIDENCE_KEYS,
} = require('../parts-vision-handler');

const TINY_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

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

function makeRawAnthropic(rawText) {
  return {
    messages: {
      create: async () => ({
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: rawText }],
      }),
    },
  };
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

async function testHappyMock() {
  const aiOutput = {
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
  const res = makeRes();
  const deps = { anthropic: makeMockAnthropic(aiOutput) };
  await handlePartsVision({ body: { imageBase64: TINY_BASE64, mimeType: 'image/png' } }, res, deps);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.manufacturer, 'Bosch');
  assert.equal(res.body.data.partNumber, 'F002H20064');
  assert.equal(res.body.data.category, 'Filtration');
  assert.equal(res.body.data.descriptionGuess, 'Spin-on engine oil filter');
  assert.equal(res.body.data.dimensionsGuess, 'approx 4in x 3in diameter');
  assert.equal(res.body.data.isUnreadable, false);
  assert.equal(res.body.data.confidence.manufacturer, 0.97);
  assert.equal(res.body.data.confidence.partNumber, 0.95);
  assert.equal(typeof res.body.meta.processingTimeMs, 'number');
  assert.ok(res.body.meta.model);
  // eslint-disable-next-line no-console
  console.log('  ok  happy mock returns parsed structured data');
}

async function testLowConfidenceResponse() {
  const aiOutput = {
    manufacturer: null,
    partNumber: null,
    category: 'Brakes',
    descriptionGuess: 'Disc brake pad set',
    dimensionsGuess: null,
    confidence: {
      manufacturer: 0.05,
      partNumber: 0.05,
      category: 0.55,
      description: 0.5,
      dimensions: 0.05,
    },
    isUnreadable: false,
    warnings: ['Image is blurry; no markings legible.'],
  };
  const res = makeRes();
  const deps = { anthropic: makeMockAnthropic(aiOutput) };
  await handlePartsVision({ body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } }, res, deps);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.manufacturer, null);
  assert.equal(res.body.data.partNumber, null);
  assert.equal(res.body.data.category, 'Brakes');
  assert.equal(res.body.data.confidence.manufacturer, 0.05);
  assert.equal(res.body.data.confidence.category, 0.55);
  assert.deepEqual(res.body.data.warnings, ['Image is blurry; no markings legible.']);
  assert.equal(res.body.data.isUnreadable, false);
  // eslint-disable-next-line no-console
  console.log('  ok  low-confidence response is returned as success with low scores');
}

async function testMalformedAiResponse() {
  const res = makeRes();
  const deps = { anthropic: makeRawAnthropic('not json at all, just prose') };
  await handlePartsVision({ body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } }, res, deps);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'AI_PARSE_ERROR');
  // eslint-disable-next-line no-console
  console.log('  ok  malformed AI response returns AI_PARSE_ERROR (no throw)');
}

async function testMarkdownFencedJsonIsParsed() {
  const aiOutput = {
    manufacturer: 'Donaldson',
    partNumber: 'P181054',
    category: 'Filtration',
    descriptionGuess: 'Air filter element',
    dimensionsGuess: null,
    confidence: { manufacturer: 0.9, partNumber: 0.85, category: 0.9, description: 0.7, dimensions: 0.1 },
    isUnreadable: false,
    warnings: [],
  };
  const res = makeRes();
  const deps = { anthropic: makeRawAnthropic('```json\n' + JSON.stringify(aiOutput) + '\n```') };
  await handlePartsVision({ body: { imageBase64: TINY_BASE64, mimeType: 'image/png' } }, res, deps);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.manufacturer, 'Donaldson');
  // eslint-disable-next-line no-console
  console.log('  ok  markdown-fenced JSON is stripped and parsed');
}

async function testUnreadableImageReturnsStructuredError() {
  const aiOutput = {
    manufacturer: null,
    partNumber: null,
    category: null,
    descriptionGuess: null,
    dimensionsGuess: null,
    confidence: { manufacturer: 0, partNumber: 0, category: 0, description: 0, dimensions: 0 },
    isUnreadable: true,
    warnings: ['No part visible in the image.'],
  };
  const res = makeRes();
  const deps = { anthropic: makeMockAnthropic(aiOutput) };
  await handlePartsVision({ body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } }, res, deps);

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'AI_IMAGE_UNREADABLE');
  assert.deepEqual(res.body.warnings, ['No part visible in the image.']);
  // eslint-disable-next-line no-console
  console.log('  ok  unreadable image returns AI_IMAGE_UNREADABLE (structured error, not throw)');
}

async function testMissingImageBase64Returns400() {
  const res = makeRes();
  await handlePartsVision({ body: {} }, res, { anthropic: makeMockAnthropic({}) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'AI_BAD_REQUEST');
  // eslint-disable-next-line no-console
  console.log('  ok  missing imageBase64 returns 400 AI_BAD_REQUEST');
}

async function testUnsupportedMediaTypeReturns400() {
  const res = makeRes();
  await handlePartsVision(
    { body: { imageBase64: TINY_BASE64, mimeType: 'application/pdf' } },
    res,
    { anthropic: makeMockAnthropic({}) }
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'AI_BAD_REQUEST');
  // eslint-disable-next-line no-console
  console.log('  ok  unsupported mimeType returns 400 AI_BAD_REQUEST');
}

async function testUpstreamErrorReturns502() {
  const res = makeRes();
  const err = new Error('connect ETIMEDOUT');
  await handlePartsVision(
    { body: { imageBase64: TINY_BASE64, mimeType: 'image/jpeg' } },
    res,
    { anthropic: makeThrowingAnthropic(err) }
  );
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'AI_VISION_ERROR');
  // eslint-disable-next-line no-console
  console.log('  ok  upstream Anthropic error returns 502 AI_VISION_ERROR (no throw)');
}

function testConfidenceClamp() {
  assert.equal(clampConfidence(0.5), 0.5);
  assert.equal(clampConfidence(1.5), 1);
  assert.equal(clampConfidence(-0.2), 0);
  assert.equal(clampConfidence('0.7'), 0.7);
  assert.equal(clampConfidence('not a number'), 0);
  assert.equal(clampConfidence(null), 0);
  assert.equal(clampConfidence(undefined), 0);
  // eslint-disable-next-line no-console
  console.log('  ok  clampConfidence coerces and clamps to [0,1]');
}

function testValidateExtractionDefaultsAndShape() {
  // Missing confidence keys default to 0; missing string fields default to null.
  const out = validateExtractionResult({
    manufacturer: '  ACDelco  ',
    confidence: { manufacturer: 0.8, partNumber: 'bad' },
  });
  assert.equal(out.manufacturer, 'ACDelco'); // trimmed
  assert.equal(out.partNumber, null);
  assert.equal(out.category, null);
  assert.equal(out.descriptionGuess, null);
  assert.equal(out.dimensionsGuess, null);
  for (const key of CONFIDENCE_KEYS) {
    assert.equal(typeof out.confidence[key], 'number');
  }
  assert.equal(out.confidence.manufacturer, 0.8);
  assert.equal(out.confidence.partNumber, 0); // bad value coerced
  assert.equal(out.confidence.category, 0);
  assert.equal(out.isUnreadable, false);
  assert.deepEqual(out.warnings, []);
  // eslint-disable-next-line no-console
  console.log('  ok  validateExtractionResult fills missing fields and trims strings');
}

function testValidateExtractionRejectsNonObject() {
  assert.throws(() => validateExtractionResult(null));
  assert.throws(() => validateExtractionResult([]));
  assert.throws(() => validateExtractionResult('a string'));
  // eslint-disable-next-line no-console
  console.log('  ok  validateExtractionResult throws on non-object input');
}

function testValidateExtractionCategoryNullRoundTrip() {
  // null category + low confidence round-trips intact (FN-1473)
  const out = validateExtractionResult({
    manufacturer: null,
    partNumber: null,
    category: null,
    descriptionGuess: 'Indistinct part',
    dimensionsGuess: null,
    confidence: { manufacturer: 0, partNumber: 0, category: 0.05, description: 0.4, dimensions: 0 },
    isUnreadable: false,
    warnings: [],
  });
  assert.equal(out.category, null);
  assert.equal(out.confidence.category, 0.05);

  // string category from documented vocabulary is preserved
  const out2 = validateExtractionResult({
    manufacturer: 'Bosch',
    partNumber: 'XYZ',
    category: 'Filters',
    descriptionGuess: 'Spin-on oil filter',
    dimensionsGuess: null,
    confidence: { manufacturer: 0.9, partNumber: 0.9, category: 0.95, description: 0.85, dimensions: 0 },
    isUnreadable: false,
    warnings: [],
  });
  assert.equal(out2.category, 'Filters');
  assert.equal(out2.confidence.category, 0.95);

  // empty string and whitespace coerce to null
  const out3 = validateExtractionResult({
    manufacturer: null,
    partNumber: null,
    category: '   ',
    confidence: { category: 0.1 },
  });
  assert.equal(out3.category, null);
  // eslint-disable-next-line no-console
  console.log('  ok  validateExtractionResult round-trips category null/string and clamps confidence.category');
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('parts-vision-handler tests');

  testConfidenceClamp();
  testValidateExtractionDefaultsAndShape();
  testValidateExtractionRejectsNonObject();
  testValidateExtractionCategoryNullRoundTrip();

  await testHappyMock();
  await testLowConfidenceResponse();
  await testMalformedAiResponse();
  await testMarkdownFencedJsonIsParsed();
  await testUnreadableImageReturnsStructuredError();
  await testMissingImageBase64Returns400();
  await testUnsupportedMediaTypeReturns400();
  await testUpstreamErrorReturns502();

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
