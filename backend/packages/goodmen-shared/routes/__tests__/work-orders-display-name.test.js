'use strict';

/**
 * FN-1551 — formatUserDisplayName helper used by getWorkOrderById to populate
 * workOrder.requestedBy / workOrder.assignedTo. Pure function; no DB needed.
 */

const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert');

const SERVICE_PATH = path.resolve(__dirname, '../../services/work-orders.service.js');
const DB_PATH = require.resolve('../../internal/db');

require.cache[DB_PATH] = {
  id: DB_PATH,
  filename: DB_PATH,
  loaded: true,
  exports: { knex: () => ({}) }
};

const { formatUserDisplayName } = require(SERVICE_PATH);

describe('formatUserDisplayName', () => {
  it('joins first_name + last_name when both present', () => {
    assert.strictEqual(
      formatUserDisplayName({ first_name: 'Allstate', last_name: 'Hairu', username: 'admin' }),
      'Allstate Hairu'
    );
  });

  it('falls back to username when first and last are missing', () => {
    assert.strictEqual(
      formatUserDisplayName({ first_name: null, last_name: null, username: 'admin' }),
      'admin'
    );
  });

  it('falls back to username when both names are blank strings', () => {
    assert.strictEqual(
      formatUserDisplayName({ first_name: '   ', last_name: '', username: 'biz.work' }),
      'biz.work'
    );
  });

  it('uses only the present name and trims whitespace', () => {
    assert.strictEqual(
      formatUserDisplayName({ first_name: 'Biz', last_name: null, username: 'biz.work' }),
      'Biz'
    );
    assert.strictEqual(
      formatUserDisplayName({ first_name: null, last_name: 'Worker', username: 'biz.work' }),
      'Worker'
    );
  });

  it('returns null when given null or undefined', () => {
    assert.strictEqual(formatUserDisplayName(null), null);
    assert.strictEqual(formatUserDisplayName(undefined), null);
  });

  it('returns null when no names and no username (defensive)', () => {
    assert.strictEqual(
      formatUserDisplayName({ first_name: null, last_name: null, username: null }),
      null
    );
  });
});
