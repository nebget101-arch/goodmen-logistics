'use strict';

/**
 * FN-1627 (story FN-1625): tests for POST /api/dqf/cdl-extract.
 *
 *   node --test backend/packages/goodmen-shared/routes/dqf-cdl-extract.test.js
 *
 * Strategy: stub the heavy dqf.js dependencies via `require.cache`
 * injection (same pattern as loads-ai-insights.test.js), then exercise
 * the loaded router via supertest-style fetch against an ephemeral
 * Express app. Service-layer cases (AI 5xx, PII logging) call
 * cdl-extraction-service directly with an injected fetcher so we don't
 * need a live ai-service.
 */

const path = require('path');
const http = require('node:http');
const express = require('express');
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const sharedRoot = path.resolve(__dirname, '..');
function resolveShared(rel) { return path.resolve(sharedRoot, rel); }

function makeSpyLogger() {
  const calls = [];
  function record(level) {
    return (...args) => calls.push({ level, args });
  }
  return {
    error: record('error'),
    warn: record('warn'),
    info: record('info'),
    trackDatabase: record('trackDatabase'),
    trackRequest: record('trackRequest'),
    sendMetric: record('sendMetric'),
    trackEvent: record('trackEvent'),
    _calls: calls
  };
}

function authMiddlewareForRoles(allowedRoles) {
  return (_arg) => (req, res, next) => {
    const role = (req.headers['x-role'] || '').toString().toLowerCase();
    if (!role) return res.status(401).json({ error: 'Missing token' });
    const allowed = allowedRoles.map((r) => r.toLowerCase());
    if (!allowed.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    req.user = { id: 'test-user', role };
    next();
  };
}

/**
 * Inject mocks into require.cache, evaluate the target module fresh,
 * and return a teardown that restores the prior cache state.
 */
function withMockedRequires(targetRelative, mocks) {
  const targetPath = resolveShared(targetRelative);
  const backups = [];
  delete require.cache[targetPath];
  for (const [rel, exportsValue] of Object.entries(mocks)) {
    const p = resolveShared(rel);
    backups.push({ path: p, prior: require.cache[p] });
    require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsValue };
  }
  const mod = require(targetPath);
  return {
    module: mod,
    restore() {
      delete require.cache[targetPath];
      for (const b of backups) {
        if (b.prior) require.cache[b.path] = b.prior;
        else delete require.cache[b.path];
      }
    }
  };
}

function startApp(router, basePath = '/api/dqf') {
  const app = express();
  app.use(basePath, router);
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

function multipartBody({ filename, mimeType, bytes }) {
  const boundary = '----testboundary' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, bytes, tail]);
  return { boundary, body };
}

function postFile(baseUrl, urlPath, headers = {}, file) {
  if (file) {
    const { boundary, body } = multipartBody(file);
    return fetch(`${baseUrl}${urlPath}`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    });
  }
  return fetch(`${baseUrl}${urlPath}`, { method: 'POST', headers });
}

function loadDqfRouterWithStubs({ extractCdlImpl, allowedRoles, logger }) {
  return withMockedRequires('routes/dqf.js', {
    'routes/auth-middleware.js': authMiddlewareForRoles(allowedRoles || ['admin', 'safety']),
    'utils/logger.js': logger || makeSpyLogger(),
    // dqf.js loads these at the top — we don't exercise them, so stub
    // each as a no-op surface that satisfies destructuring.
    'internal/db.js': { query: async () => ({ rows: [] }) },
    'services/dqf-service.js': {
      upsertRequirementStatus: async () => {},
      computeAndUpdateDqfCompleteness: async () => {},
      logStatusChange: async () => {},
      computeWarningItems: () => [],
      computeDueDateAndUrgency: () => ({})
    },
    'utils/case-converter.js': { transformRow: (r) => r },
    'services/driver-storage-service.js': { createDriverDocument: async () => ({ id: 'doc-1' }) },
    'services/pdf.service.js': { generateEmploymentApplicationPdf: async () => Buffer.alloc(0) },
    'services/mvr-extraction-service.js': { extractMvrData: async () => ({}) },
    'services/cdl-extraction-service.js': { extractCdl: extractCdlImpl }
  });
}

const ADMIN_HEADERS = { 'x-role': 'admin' };

const HAPPY_AI_RESULT = {
  success: true,
  extracted: {
    firstName: 'John',
    middleName: null,
    lastName: 'Doe',
    dateOfBirth: '1985-04-12',
    streetAddress: '123 Main St',
    city: 'Dallas',
    state: 'TX',
    zipCode: '75201',
    cdlNumber: '12345678',
    cdlState: 'TX',
    cdlClass: 'A',
    cdlExpiry: '2028-04-12'
  },
  extractedFields: [
    'firstName', 'lastName', 'dateOfBirth',
    'streetAddress', 'city', 'state', 'zipCode',
    'cdlNumber', 'cdlState', 'cdlClass', 'cdlExpiry'
  ],
  meta: { lowConfidenceFields: [], processingMs: 12 }
};

describe('POST /api/dqf/cdl-extract', () => {
  let serverHandle;
  let loaded;

  afterEach(async () => {
    if (serverHandle) await serverHandle.close();
    serverHandle = null;
    if (loaded) loaded.restore();
    loaded = null;
  });

  it('returns 400 when file is missing', async () => {
    loaded = loadDqfRouterWithStubs({ extractCdlImpl: async () => HAPPY_AI_RESULT });
    serverHandle = await startApp(loaded.module);

    const res = await postFile(serverHandle.baseUrl, '/api/dqf/cdl-extract', ADMIN_HEADERS);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /file is required/i);
  });

  it('returns 400 when mimetype is unsupported', async () => {
    loaded = loadDqfRouterWithStubs({ extractCdlImpl: async () => HAPPY_AI_RESULT });
    serverHandle = await startApp(loaded.module);

    // image/tiff is excluded from the CDL allowlist even though the
    // shared `upload` filter in dqf.js permits it for other routes.
    const res = await postFile(serverHandle.baseUrl, '/api/dqf/cdl-extract', ADMIN_HEADERS, {
      filename: 'cdl.tif',
      mimeType: 'image/tiff',
      bytes: Buffer.from('fake')
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /JPEG, PNG, or PDF/);
  });

  it('returns 413 when the upload exceeds 10 MB', async () => {
    loaded = loadDqfRouterWithStubs({ extractCdlImpl: async () => HAPPY_AI_RESULT });
    serverHandle = await startApp(loaded.module);

    const oversize = Buffer.alloc(10 * 1024 * 1024 + 1024); // 10 MB + 1 KB
    const res = await postFile(serverHandle.baseUrl, '/api/dqf/cdl-extract', ADMIN_HEADERS, {
      filename: 'cdl.jpg',
      mimeType: 'image/jpeg',
      bytes: oversize
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.match(body.message, /10 MB/);
  });

  it('returns the camelCase extracted payload on the happy path', async () => {
    let received = null;
    loaded = loadDqfRouterWithStubs({
      extractCdlImpl: async (input) => {
        received = input;
        return HAPPY_AI_RESULT;
      }
    });
    serverHandle = await startApp(loaded.module);

    const res = await postFile(serverHandle.baseUrl, '/api/dqf/cdl-extract', ADMIN_HEADERS, {
      filename: 'cdl.jpg',
      mimeType: 'image/jpeg',
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3])
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.extracted.firstName, 'John');
    assert.equal(body.extracted.cdlNumber, '12345678');
    assert.ok(body.extractedFields.includes('cdlExpiry'));
    assert.ok(Buffer.isBuffer(received.fileBuffer), 'route hands the buffer to the service');
    assert.equal(received.mimeType, 'image/jpeg');
  });

  it('returns 200 success:false reason:ai_unavailable when AI is down (does NOT collapse to a generic error)', async () => {
    // Lesson from FN-1605: the FE needs a structured failure reason so
    // it can show its empty-modal-with-toast fallback.
    loaded = loadDqfRouterWithStubs({
      extractCdlImpl: async () => ({ success: false, extracted: null, reason: 'ai_unavailable' })
    });
    serverHandle = await startApp(loaded.module);

    const res = await postFile(serverHandle.baseUrl, '/api/dqf/cdl-extract', ADMIN_HEADERS, {
      filename: 'cdl.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from([0x25, 0x50, 0x44, 0x46])
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.reason, 'ai_unavailable');
    assert.equal(body.extracted, null);
  });

  it('returns 200 success:false reason:low_confidence when all fields are below the floor', async () => {
    loaded = loadDqfRouterWithStubs({
      extractCdlImpl: async () => ({ success: false, extracted: null, reason: 'low_confidence' })
    });
    serverHandle = await startApp(loaded.module);

    const res = await postFile(serverHandle.baseUrl, '/api/dqf/cdl-extract', ADMIN_HEADERS, {
      filename: 'cdl.png',
      mimeType: 'image/png',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47])
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.reason, 'low_confidence');
  });

  it('returns 403 to non-admin/non-safety roles', async () => {
    loaded = loadDqfRouterWithStubs({ extractCdlImpl: async () => HAPPY_AI_RESULT });
    serverHandle = await startApp(loaded.module);

    const res = await postFile(serverHandle.baseUrl, '/api/dqf/cdl-extract', { 'x-role': 'driver' }, {
      filename: 'cdl.jpg',
      mimeType: 'image/jpeg',
      bytes: Buffer.from([0xff, 0xd8, 0xff])
    });
    assert.equal(res.status, 403);
  });
});

describe('cdl-extraction-service: confidence floor + PII-safe logging', () => {
  it('drops fields below the confidence floor to null and lists them in extractedFields appropriately', () => {
    const { applyConfidenceFloor } = require('../services/cdl-extraction-service');
    const aiPayload = {
      fields: {
        firstName: { value: 'John', confidence: 0.95 },
        lastName: { value: 'Doe', confidence: 0.92 },
        // dateOfBirth below floor — must be dropped to null
        dateOfBirth: { value: '1985-04-12', confidence: 0.4 },
        cdlNumber: { value: '12345678', confidence: 0.85 }
      }
    };
    const { extracted, extractedFields, lowConfidenceFields } = applyConfidenceFloor(aiPayload, 0.6);
    assert.equal(extracted.firstName, 'John');
    assert.equal(extracted.lastName, 'Doe');
    assert.equal(extracted.dateOfBirth, null, 'low-confidence value must be dropped to null');
    assert.equal(extracted.cdlNumber, '12345678');
    assert.ok(!extractedFields.includes('dateOfBirth'));
    assert.ok(lowConfidenceFields.includes('dateOfBirth'));
  });

  it('never logs field values — only metadata (counts, mimeType, processingMs)', async () => {
    const spy = makeSpyLogger();
    const cdlServicePath = resolveShared('services/cdl-extraction-service.js');
    const loggerPath = resolveShared('utils/logger.js');
    const priorService = require.cache[cdlServicePath];
    const priorLogger = require.cache[loggerPath];
    delete require.cache[cdlServicePath];
    require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: spy };
    try {
      const { extractCdl } = require(cdlServicePath);
      const fakeFetcher = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          fields: {
            firstName: { value: 'John', confidence: 0.95 },
            lastName: { value: 'Doe', confidence: 0.92 },
            cdlNumber: { value: '12345678', confidence: 0.9 }
          }
        })
      });
      const result = await extractCdl({
        fileBuffer: Buffer.from([0xff, 0xd8, 0xff]),
        mimeType: 'image/jpeg',
        fetcher: fakeFetcher
      });
      assert.equal(result.success, true);

      const allLoggedJson = JSON.stringify(spy._calls);
      // Field values must NOT appear in any log call's arguments.
      assert.ok(!allLoggedJson.includes('John'), 'firstName value must not be logged');
      assert.ok(!allLoggedJson.includes('Doe'), 'lastName value must not be logged');
      assert.ok(!allLoggedJson.includes('12345678'), 'cdlNumber value must not be logged');
      // But metadata SHOULD be present.
      assert.ok(allLoggedJson.includes('extractedFieldCount'), 'extractedFieldCount must be logged');
      assert.ok(allLoggedJson.includes('image/jpeg'), 'mimeType must be logged');
    } finally {
      delete require.cache[cdlServicePath];
      if (priorService) require.cache[cdlServicePath] = priorService;
      if (priorLogger) require.cache[loggerPath] = priorLogger;
      else delete require.cache[loggerPath];
    }
  });

  it('returns ai_unavailable on AI 5xx without throwing', async () => {
    const spy = makeSpyLogger();
    const cdlServicePath = resolveShared('services/cdl-extraction-service.js');
    const loggerPath = resolveShared('utils/logger.js');
    const priorService = require.cache[cdlServicePath];
    const priorLogger = require.cache[loggerPath];
    delete require.cache[cdlServicePath];
    require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: spy };
    try {
      const { extractCdl } = require(cdlServicePath);
      const fakeFetcher = async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'upstream' })
      });
      const result = await extractCdl({
        fileBuffer: Buffer.from([0xff, 0xd8, 0xff]),
        mimeType: 'image/jpeg',
        fetcher: fakeFetcher
      });
      assert.equal(result.success, false);
      assert.equal(result.reason, 'ai_unavailable');
      assert.equal(result.extracted, null);
    } finally {
      delete require.cache[cdlServicePath];
      if (priorService) require.cache[cdlServicePath] = priorService;
      if (priorLogger) require.cache[loggerPath] = priorLogger;
      else delete require.cache[loggerPath];
    }
  });
});
