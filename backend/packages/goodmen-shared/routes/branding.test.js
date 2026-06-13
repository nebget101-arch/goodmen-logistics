'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

/**
 * FN-1742: Tests for the branding logo route.
 *
 * Two layers:
 *  1. readImageDimensions — the bespoke header-only parser (PNG/JPEG/WebP). This
 *     is the riskiest custom logic, so it gets exhaustive synthetic-buffer cover.
 *  2. Route behavior reachable without R2 or multipart bodies: unknown resource,
 *     tenant scoping (403/404), and the no-logo GET/DELETE paths. Success/upload
 *     paths hit R2 and are exercised by QA (FN-1743) against the deployed service.
 */

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const ENTITY_ID = '33333333-3333-3333-3333-333333333333';

// branding.js destructures `query` from internal/db at import time (the prod
// pattern: services call setDatabase() before requiring routers), so the fake DB
// must be installed BEFORE the router is required.
const db = require('../internal/db');
const fakeRows = [
  { id: ENTITY_ID, tenant_id: TENANT_A, logo_storage_key: null, logo_mime_type: null, logo_uploaded_at: null }
];
db.setDatabase({
  query: async (sql, params) => {
    if (/^SELECT/i.test(sql)) {
      const match = fakeRows.find((r) => r.id === params[0]);
      return { rows: match ? [match] : [] };
    }
    return { rows: [] };
  }
});

const brandingRouter = require('./branding');
const { readImageDimensions } = brandingRouter;

// ─── Synthetic image headers ─────────────────────────────────────────────────

function makePng(width, height) {
  const buf = Buffer.alloc(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function makeJpeg(width, height) {
  // FFD8 (SOI) + APP0-ish filler segment + SOF0 frame segment.
  const buf = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 with length 4 (2 payload bytes)
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, length 17, precision 8
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff
  ]);
  return buf;
}

function makeWebpVp8x(width, height) {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  const w = width - 1;
  const h = height - 1;
  buf[24] = w & 0xff; buf[25] = (w >> 8) & 0xff; buf[26] = (w >> 16) & 0xff;
  buf[27] = h & 0xff; buf[28] = (h >> 8) & 0xff; buf[29] = (h >> 16) & 0xff;
  return buf;
}

describe('readImageDimensions', () => {
  it('parses PNG dimensions', () => {
    assert.deepStrictEqual(readImageDimensions(makePng(800, 600)), { width: 800, height: 600 });
  });

  it('parses JPEG dimensions, skipping non-SOF segments', () => {
    assert.deepStrictEqual(readImageDimensions(makeJpeg(1024, 512)), { width: 1024, height: 512 });
  });

  it('parses WebP (VP8X) dimensions', () => {
    assert.deepStrictEqual(readImageDimensions(makeWebpVp8x(1024, 1024)), { width: 1024, height: 1024 });
  });

  it('returns null for non-image / corrupt buffers', () => {
    assert.strictEqual(readImageDimensions(Buffer.from('not an image at all!!')), null);
    assert.strictEqual(readImageDimensions(Buffer.alloc(4)), null);
    assert.strictEqual(readImageDimensions(null), null);
  });
});

// ─── Route behavior (no R2, no multipart) ─────────────────────────────────────

describe('branding routes (no-R2 paths)', () => {
  let server;
  let baseUrl;
  let contextTenant = TENANT_A;

  before(async () => {
    const app = express();
    // Inject a tenant context the way tenant-context-middleware would.
    app.use((req, _res, next) => { req.context = { tenantId: contextTenant }; next(); });
    app.use('/api/branding', brandingRouter);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  function setTenant(t) { contextTenant = t; }

  it('404s an unknown resource type', async () => {
    const res = await fetch(`${baseUrl}/api/branding/widgets/${ENTITY_ID}/logo`);
    assert.strictEqual(res.status, 404);
  });

  it('GET returns { logoUrl: null } when no logo is set', async () => {
    setTenant(TENANT_A);
    const res = await fetch(`${baseUrl}/api/branding/operating-entities/${ENTITY_ID}/logo`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { logoUrl: null });
  });

  it('404s a cross-tenant id', async () => {
    setTenant(TENANT_B);
    const res = await fetch(`${baseUrl}/api/branding/operating-entities/${ENTITY_ID}/logo`);
    assert.strictEqual(res.status, 404);
  });

  it('DELETE is idempotent when no logo is set', async () => {
    setTenant(TENANT_A);
    const res = await fetch(`${baseUrl}/api/branding/operating-entities/${ENTITY_ID}/logo`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });
  });
});
