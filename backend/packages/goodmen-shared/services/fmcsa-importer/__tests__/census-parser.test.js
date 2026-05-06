'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { Readable } = require('node:stream');

const { createCsvStream } = require('../utils/csv-stream');
const { buildHeaderMap, parseCensusRow } = require('../parsers/census.v1');

const FIXTURE = path.join(__dirname, '..', '__fixtures__', 'census-sample.csv');

async function parseFixture() {
  const csvBytes = fs.readFileSync(FIXTURE);
  const stream = Readable.from(csvBytes).pipe(createCsvStream());
  const rows = [];
  let headerMap;
  for await (const row of stream) {
    if (!headerMap) headerMap = buildHeaderMap(Object.keys(row));
    rows.push(parseCensusRow(row, headerMap));
  }
  return { rows, headerMap };
}

describe('census.v1 parser', () => {
  it('builds a header map for known FMCSA columns', () => {
    const headers = ['DOT_NUMBER', 'LEGAL_NAME', 'TELEPHONE', 'FAX', 'EMAIL_ADDRESS'];
    const map = buildHeaderMap(headers);
    assert.equal(map.dot, 'DOT_NUMBER');
    assert.equal(map.legal_name, 'LEGAL_NAME');
    assert.equal(map.phone, 'TELEPHONE');
    assert.equal(map.fax, 'FAX');
    assert.equal(map.email, 'EMAIL_ADDRESS');
  });

  it('accepts case-insensitive header matches', () => {
    const map = buildHeaderMap(['dot_number', 'Legal_Name', 'phy_state']);
    assert.equal(map.dot, 'dot_number');
    assert.equal(map.legal_name, 'Legal_Name');
    assert.equal(map.state, 'phy_state');
  });

  it('returns null for rows missing or zero DOT', () => {
    const headers = ['DOT_NUMBER', 'LEGAL_NAME'];
    const map = buildHeaderMap(headers);
    assert.equal(parseCensusRow({ DOT_NUMBER: '', LEGAL_NAME: 'X' }, map), null);
    assert.equal(parseCensusRow({ DOT_NUMBER: '0', LEGAL_NAME: 'X' }, map), null);
    assert.equal(parseCensusRow({ DOT_NUMBER: 'abc', LEGAL_NAME: 'X' }, map), null);
  });

  it('parses the fixture into normalized carrier records', async () => {
    const { rows } = await parseFixture();
    // 5 raw rows in fixture; 2 are unusable (DOT 0 and the empty trailing line)
    const valid = rows.filter((r) => r != null);
    assert.equal(valid.length, 3);

    const acme = valid.find((r) => r.dot === 123456);
    assert.ok(acme, 'expected to find DOT 123456 in fixture output');
    assert.equal(acme.legal_name, 'ACME LOGISTICS INC');
    assert.equal(acme.dba_name, 'ACME');
    assert.equal(acme.mc_number, 'MC-100200');
    assert.equal(acme.ff_number, 'FF-500');
    assert.equal(acme.address_line1, '100 MAIN ST, SUITE A'); // embedded comma preserved
    assert.equal(acme.phone, '(214) 555-1212');
    assert.equal(acme.fax, '(214) 555-2121');
    assert.equal(acme.email, 'ops@acme.example');
    assert.equal(acme.power_units, 25);
    assert.equal(acme.drivers, 30);
    assert.equal(acme.mileage, 1250000);
    assert.equal(acme.hazmat_flag, false);
    assert.equal(acme.passenger_flag, false);

    const blue = valid.find((r) => r.dot === 654321);
    assert.equal(blue.legal_name, 'BLUE RIVER FREIGHT, LLC');
    assert.equal(blue.hazmat_flag, true);
    assert.equal(blue.fax, null);
  });

  it('coerces FMCSA flag values robustly', async () => {
    const { rows } = await parseFixture();
    const valid = rows.filter((r) => r != null);
    const flags = valid.map((r) => [r.hazmat_flag, r.passenger_flag]);
    // Every parsed row should have boolean (not null/undefined) flags
    for (const [hm, pc] of flags) {
      assert.equal(typeof hm, 'boolean');
      assert.equal(typeof pc, 'boolean');
    }
  });
});
