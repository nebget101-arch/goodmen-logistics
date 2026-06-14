const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isUuid } = require('./uuid');

test('isUuid: accepts canonical v1–5 UUIDs (case-insensitive)', () => {
  assert.equal(isUuid('550e8400-e29b-41d4-a716-446655440000'), true); // v4
  assert.equal(isUuid('550E8400-E29B-41D4-A716-446655440000'), true); // uppercase
  assert.equal(isUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), true); // v1
  assert.equal(isUuid('a3bb189e-8bf9-3888-9912-ace4e6543002'), true); // v3
});

test('isUuid: rejects free-text identifiers (the FN-1842 bug input)', () => {
  assert.equal(isUuid('SN-3918'), false);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid('123'), false);
});

test('isUuid: rejects malformed UUID-like strings', () => {
  assert.equal(isUuid('550e8400-e29b-41d4-a716-44665544000'), false); // too short
  assert.equal(isUuid('550e8400-e29b-41d4-a716-4466554400000'), false); // too long
  assert.equal(isUuid('550e8400e29b41d4a716446655440000'), false); // no hyphens
  assert.equal(isUuid('550e8400-e29b-61d4-a716-446655440000'), false); // bad version (6)
  assert.equal(isUuid('550e8400-e29b-41d4-c716-446655440000'), false); // bad variant (c)
  assert.equal(isUuid(' 550e8400-e29b-41d4-a716-446655440000 '), false); // surrounding space
});

test('isUuid: rejects non-string input', () => {
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid(123), false);
  assert.equal(isUuid({}), false);
  assert.equal(isUuid(['550e8400-e29b-41d4-a716-446655440000']), false);
});
