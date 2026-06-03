'use strict';

/**
 * FN-513: hos_records.violations is PostgreSQL text[]; comparing to '[]'::jsonb errors at runtime.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('safety-risk-engine uses text[]-safe filter for hos_records.violations', () => {
  const file = path.join(__dirname, '../routes/safety-risk-engine.js');
  const src = fs.readFileSync(file, 'utf8');
  assert.ok(
    !src.includes("violations != '[]'::jsonb"),
    'must not compare text[] violations to jsonb'
  );
  assert.ok(
    src.includes('cardinality(violations) > 0'),
    'must filter non-empty arrays with cardinality (text[])'
  );
});
