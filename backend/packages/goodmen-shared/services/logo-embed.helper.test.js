/**
 * Unit tests for the shared MC-logo embed helper.
 * Run: node --test services/logo-embed.helper.test.js (from goodmen-shared)
 */
const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');

const r2Storage = require('../storage/r2-storage');
const { embedOperatingEntityLogo, scaleToFit, detectImageType } = require('./logo-embed.helper');

// 1x1 transparent PNG
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
);

afterEach(() => mock.restoreAll());

describe('detectImageType', () => {
  it('detects PNG by magic bytes', () => {
    assert.equal(detectImageType(PNG_1x1, null), 'png');
  });

  it('detects JPEG by magic bytes', () => {
    assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), null), 'jpeg');
  });

  it('falls back to the mime hint when bytes are unrecognized', () => {
    assert.equal(detectImageType(Buffer.from('not-an-image'), 'image/png'), 'png');
    assert.equal(detectImageType(Buffer.from('not-an-image'), 'image/jpeg'), 'jpeg');
  });

  it('returns null for unknown bytes and no usable hint', () => {
    assert.equal(detectImageType(Buffer.from('xx'), 'image/webp'), null);
    assert.equal(detectImageType(null, null), null);
  });
});

describe('scaleToFit', () => {
  it('scales down preserving aspect ratio', () => {
    const dims = scaleToFit({ width: 400, height: 200 }, 100, 100);
    assert.deepEqual(dims, { width: 100, height: 50 });
  });

  it('never upscales past the source resolution', () => {
    const dims = scaleToFit({ width: 20, height: 10 }, 100, 100);
    assert.deepEqual(dims, { width: 20, height: 10 });
  });

  it('returns null for a missing/zero-dimension image', () => {
    assert.equal(scaleToFit(null, 100, 100), null);
    assert.equal(scaleToFit({ width: 0, height: 0 }, 100, 100), null);
  });
});

describe('embedOperatingEntityLogo (graceful)', () => {
  it('returns null when source is missing or has no key', async () => {
    const pdfDoc = await PDFDocument.create();
    assert.equal(await embedOperatingEntityLogo(pdfDoc, null), null);
    assert.equal(await embedOperatingEntityLogo(pdfDoc, {}), null);
    assert.equal(await embedOperatingEntityLogo(pdfDoc, { name: 'Acme' }), null);
  });

  it('returns null (non-fatal) when the R2 download fails', async () => {
    mock.method(r2Storage, 'downloadBuffer', async () => {
      throw new Error('R2 unavailable');
    });
    const pdfDoc = await PDFDocument.create();
    assert.equal(await embedOperatingEntityLogo(pdfDoc, { logo_storage_key: 'k' }), null);
  });

  it('returns null when the downloaded bytes are not a supported image', async () => {
    mock.method(r2Storage, 'downloadBuffer', async () => Buffer.from('definitely not an image'));
    const pdfDoc = await PDFDocument.create();
    assert.equal(await embedOperatingEntityLogo(pdfDoc, { logo_storage_key: 'k', logo_mime_type: 'image/png' }), null);
  });

  it('embeds a PNG and returns a pdf-lib image with dimensions', async () => {
    mock.method(r2Storage, 'downloadBuffer', async () => PNG_1x1);
    const pdfDoc = await PDFDocument.create();
    const image = await embedOperatingEntityLogo(pdfDoc, { logo_storage_key: 'k', logo_mime_type: 'image/png' });
    assert.ok(image, 'expected an embedded image');
    assert.equal(image.width, 1);
    assert.equal(image.height, 1);
  });

  it('accepts camelCase logo fields', async () => {
    mock.method(r2Storage, 'downloadBuffer', async () => PNG_1x1);
    const pdfDoc = await PDFDocument.create();
    const image = await embedOperatingEntityLogo(pdfDoc, { logoStorageKey: 'k' });
    assert.ok(image);
  });
});
