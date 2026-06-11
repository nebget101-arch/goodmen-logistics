'use strict';

/**
 * FN-1231: Tests for incident-images service.
 *
 * Hermetic — all external I/O (DB via knex, R2 upload, R2 signed-URL) is
 * mocked in-process. The `incident_images` table is provided by FN-1232.
 *
 * Run with:
 *   cd backend/packages/goodmen-shared
 *   node --test services/incident-images.service.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── mock r2-storage ───────────────────────────────────────────────────────────

let uploadBufferSpy = null;
let signedUrlSpy = null;

require.cache[require.resolve('../storage/r2-storage')] = {
  id: require.resolve('../storage/r2-storage'),
  filename: require.resolve('../storage/r2-storage'),
  loaded: true,
  exports: {
    uploadBuffer: async (...args) => {
      if (uploadBufferSpy) uploadBufferSpy(...args);
      return { key: args[0].key || 'mocked-key' };
    },
    getSignedDownloadUrl: async (key) => {
      if (signedUrlSpy) signedUrlSpy(key);
      return `https://r2.example.com/${key}?sig=mock`;
    }
  }
};

// ── mock internal/db ──────────────────────────────────────────────────────────

const dbBridge = require('../internal/db');

function makeKnex({ callRow = null, imageRow = null, imageRows = [] } = {}) {
  return function knex(table) {
    const state = { whereCriteria: {}, data: null };

    const builder = {
      where(criteria) {
        Object.assign(state.whereCriteria, criteria);
        return this;
      },
      modify(fn) {
        fn(this);
        return this;
      },
      andWhere() { return this; },
      orWhereNull() { return this; },
      async first() {
        if (table === 'roadside_calls') return callRow;
        if (table === 'incident_images') {
          const { id, incident_id } = state.whereCriteria;
          if (id && incident_id) return imageRow;
          return imageRows[0] || null;
        }
        return null;
      },
      orderBy() { return this; },
      async then(resolve) {
        if (table === 'incident_images') {
          return resolve(imageRows);
        }
        return resolve([]);
      },
      [Symbol.asyncIterator]: undefined,
      insert(data) {
        state.data = data;
        return {
          async returning() {
            return [{ id: 'img-1', ...data, uploaded_at: new Date().toISOString() }];
          }
        };
      }
    };

    // Make builder thenable for await
    builder.then = async function (resolve) {
      if (table === 'incident_images' && !state.whereCriteria.id) {
        return resolve(imageRows);
      }
      return resolve([]);
    };

    return builder;
  };
}

const { uploadImage, listImages, getImage } = require('./incident-images.service');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFile({ size = 1024, mimetype = 'image/jpeg', originalname = 'photo.jpg' } = {}) {
  return { buffer: Buffer.alloc(size), size, mimetype, originalname };
}

const CONTEXT = { tenantId: 'tenant-1', isGlobalAdmin: false };
const CALL_ROW = { id: 'call-1', tenant_id: 'tenant-1' };

// ── tests ─────────────────────────────────────────────────────────────────────

test('uploadImage — rejects oversized file', async () => {
  dbBridge.setDatabase({ knex: makeKnex({ callRow: CALL_ROW }) });
  const file = makeFile({ size: 11 * 1024 * 1024, mimetype: 'image/jpeg' });

  await assert.rejects(
    () => uploadImage('call-1', file, null, CONTEXT),
    (err) => {
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('file_too_large'));
      return true;
    }
  );
});

test('uploadImage — rejects unsupported MIME type', async () => {
  dbBridge.setDatabase({ knex: makeKnex({ callRow: CALL_ROW }) });
  const file = makeFile({ mimetype: 'image/gif' });

  await assert.rejects(
    () => uploadImage('call-1', file, null, CONTEXT),
    (err) => {
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('unsupported_format'));
      return true;
    }
  );
});

test('uploadImage — rejects when incident not found', async () => {
  dbBridge.setDatabase({ knex: makeKnex({ callRow: null }) });
  const file = makeFile();

  await assert.rejects(
    () => uploadImage('nonexistent', file, null, CONTEXT),
    (err) => {
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test('uploadImage — accepts jpg and returns metadata with signed_url', async () => {
  let uploadCalled = false;
  uploadBufferSpy = () => { uploadCalled = true; };

  dbBridge.setDatabase({ knex: makeKnex({ callRow: CALL_ROW }) });
  const file = makeFile({ mimetype: 'image/jpeg', originalname: 'damage.jpg' });

  const result = await uploadImage('call-1', file, 'user-1', CONTEXT);

  assert.ok(uploadCalled, 'R2 upload should be called');
  assert.ok(result.id, 'should return image row with id');
  assert.equal(result.mime_type, 'image/jpeg');
  assert.ok(result.s3_key.includes('tenants/tenant-1/incidents/call-1'));
});

test('uploadImage — accepts png', async () => {
  dbBridge.setDatabase({ knex: makeKnex({ callRow: CALL_ROW }) });
  const file = makeFile({ mimetype: 'image/png', originalname: 'photo.png' });
  const result = await uploadImage('call-1', file, null, CONTEXT);
  assert.equal(result.mime_type, 'image/png');
});

test('uploadImage — accepts heic', async () => {
  dbBridge.setDatabase({ knex: makeKnex({ callRow: CALL_ROW }) });
  const file = makeFile({ mimetype: 'image/heic', originalname: 'photo.heic' });
  const result = await uploadImage('call-1', file, null, CONTEXT);
  assert.equal(result.mime_type, 'image/heic');
});

test('listImages — returns images with signed URLs', async () => {
  const rows = [
    { id: 'img-1', incident_id: 'call-1', tenant_id: 'tenant-1', s3_key: 'tenants/tenant-1/incidents/call-1/a.jpg', mime_type: 'image/jpeg', size_bytes: 500, uploaded_at: new Date().toISOString() }
  ];
  dbBridge.setDatabase({ knex: makeKnex({ callRow: CALL_ROW, imageRows: rows }) });

  const images = await listImages('call-1', CONTEXT);

  assert.equal(images.length, 1);
  assert.ok(images[0].signed_url, 'signed_url should be present');
  assert.ok(images[0].signed_url_expires_in > 0);
});

test('listImages — returns 404 when incident not found', async () => {
  dbBridge.setDatabase({ knex: makeKnex({ callRow: null }) });

  await assert.rejects(
    () => listImages('nonexistent', CONTEXT),
    (err) => {
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test('getImage — returns image with signed URL', async () => {
  const row = { id: 'img-1', incident_id: 'call-1', tenant_id: 'tenant-1', s3_key: 'tenants/tenant-1/incidents/call-1/a.jpg', mime_type: 'image/jpeg', size_bytes: 500, uploaded_at: new Date().toISOString() };
  dbBridge.setDatabase({ knex: makeKnex({ callRow: CALL_ROW, imageRow: row }) });

  const result = await getImage('call-1', 'img-1', CONTEXT);

  assert.equal(result.id, 'img-1');
  assert.ok(result.signed_url);
});

test('getImage — returns 404 when image not found', async () => {
  dbBridge.setDatabase({ knex: makeKnex({ callRow: CALL_ROW, imageRow: null }) });

  await assert.rejects(
    () => getImage('call-1', 'missing', CONTEXT),
    (err) => {
      assert.equal(err.status, 404);
      return true;
    }
  );
});
