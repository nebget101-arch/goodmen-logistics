const { test } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeStateCode } = require('./state-code');

test('normalizeStateCode: passes through valid 2-letter codes', () => {
  assert.equal(normalizeStateCode('CA'), 'CA');
  assert.equal(normalizeStateCode('TX'), 'TX');
  assert.equal(normalizeStateCode('NY'), 'NY');
  assert.equal(normalizeStateCode('DC'), 'DC');
});

test('normalizeStateCode: uppercases and trims 2-letter codes', () => {
  assert.equal(normalizeStateCode('ca'), 'CA');
  assert.equal(normalizeStateCode(' Ca '), 'CA');
  assert.equal(normalizeStateCode('Ca.'), 'CA');
  assert.equal(normalizeStateCode('Ca,'), 'CA');
  assert.equal(normalizeStateCode('  ca.  '), 'CA');
});

test('normalizeStateCode: maps full state names case-insensitively', () => {
  assert.equal(normalizeStateCode('California'), 'CA');
  assert.equal(normalizeStateCode('california'), 'CA');
  assert.equal(normalizeStateCode('CALIFORNIA'), 'CA');
  assert.equal(normalizeStateCode('  Texas  '), 'TX');
  assert.equal(normalizeStateCode('new york'), 'NY');
  assert.equal(normalizeStateCode('NEW YORK'), 'NY');
  assert.equal(normalizeStateCode('District of Columbia'), 'DC');
});

test('normalizeStateCode: collapses internal whitespace in multi-word names', () => {
  assert.equal(normalizeStateCode('New  York'), 'NY');
  assert.equal(normalizeStateCode(' north   carolina '), 'NC');
  assert.equal(normalizeStateCode('West Virginia'), 'WV');
});

test('normalizeStateCode: covers all 50 states + DC', () => {
  const expectations = [
    ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['Arkansas', 'AR'],
    ['California', 'CA'], ['Colorado', 'CO'], ['Connecticut', 'CT'],
    ['Delaware', 'DE'], ['District of Columbia', 'DC'], ['Florida', 'FL'],
    ['Georgia', 'GA'], ['Hawaii', 'HI'], ['Idaho', 'ID'], ['Illinois', 'IL'],
    ['Indiana', 'IN'], ['Iowa', 'IA'], ['Kansas', 'KS'], ['Kentucky', 'KY'],
    ['Louisiana', 'LA'], ['Maine', 'ME'], ['Maryland', 'MD'],
    ['Massachusetts', 'MA'], ['Michigan', 'MI'], ['Minnesota', 'MN'],
    ['Mississippi', 'MS'], ['Missouri', 'MO'], ['Montana', 'MT'],
    ['Nebraska', 'NE'], ['Nevada', 'NV'], ['New Hampshire', 'NH'],
    ['New Jersey', 'NJ'], ['New Mexico', 'NM'], ['New York', 'NY'],
    ['North Carolina', 'NC'], ['North Dakota', 'ND'], ['Ohio', 'OH'],
    ['Oklahoma', 'OK'], ['Oregon', 'OR'], ['Pennsylvania', 'PA'],
    ['Rhode Island', 'RI'], ['South Carolina', 'SC'], ['South Dakota', 'SD'],
    ['Tennessee', 'TN'], ['Texas', 'TX'], ['Utah', 'UT'], ['Vermont', 'VT'],
    ['Virginia', 'VA'], ['Washington', 'WA'], ['West Virginia', 'WV'],
    ['Wisconsin', 'WI'], ['Wyoming', 'WY'],
  ];
  for (const [name, code] of expectations) {
    assert.equal(normalizeStateCode(name), code, `${name} -> ${code}`);
  }
});

test('normalizeStateCode: returns null for unknown input', () => {
  assert.equal(normalizeStateCode('Atlantis'), null);
  assert.equal(normalizeStateCode('XX'), null);
  assert.equal(normalizeStateCode('Cali'), null);
  assert.equal(normalizeStateCode('123'), null);
  assert.equal(normalizeStateCode('!!'), null);
});

test('normalizeStateCode: returns null for empty / null / non-string', () => {
  assert.equal(normalizeStateCode(null), null);
  assert.equal(normalizeStateCode(undefined), null);
  assert.equal(normalizeStateCode(''), null);
  assert.equal(normalizeStateCode('   '), null);
  assert.equal(normalizeStateCode('.,'), null);
  assert.equal(normalizeStateCode(42), null);
  assert.equal(normalizeStateCode({}), null);
  assert.equal(normalizeStateCode([]), null);
});
