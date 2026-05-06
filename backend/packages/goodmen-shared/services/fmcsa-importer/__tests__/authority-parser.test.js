'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { Readable } = require('node:stream');

const { createCsvStream } = require('../utils/csv-stream');
const {
  buildHeaderMap,
  parseAuthorityRow,
  normalizeAuthorityType,
} = require('../parsers/authority.v1');

const FIXTURE = path.join(__dirname, '..', '__fixtures__', 'authority-sample.csv');

async function parseFixture() {
  const csvBytes = fs.readFileSync(FIXTURE);
  const stream = Readable.from(csvBytes).pipe(createCsvStream());
  const rows = [];
  let headerMap;
  for await (const row of stream) {
    if (!headerMap) headerMap = buildHeaderMap(Object.keys(row));
    rows.push(parseAuthorityRow(row, headerMap));
  }
  return rows;
}

describe('authority.v1 parser', () => {
  it('normalizes authority_type into the canonical buckets', () => {
    assert.equal(normalizeAuthorityType('Common'), 'Carrier');
    assert.equal(normalizeAuthorityType('Contract'), 'Carrier');
    assert.equal(normalizeAuthorityType('Common Carrier'), 'Carrier');
    assert.equal(normalizeAuthorityType('Broker'), 'Broker');
    assert.equal(normalizeAuthorityType('Property Broker'), 'Broker');
    assert.equal(normalizeAuthorityType('Freight Forwarder'), 'Freight Forwarder');
    assert.equal(normalizeAuthorityType('FORWARDER'), 'Freight Forwarder');
    assert.equal(normalizeAuthorityType(''), null);
    assert.equal(normalizeAuthorityType(null), null);
    // Unknown types pass through verbatim — we don't silently drop them.
    assert.equal(normalizeAuthorityType('Strange New Type'), 'Strange New Type');
  });

  it('parses fixture rows and yields each canonical authority_type', async () => {
    const rows = await parseFixture();
    const valid = rows.filter((r) => r != null);

    // The fixture has 5 valid rows (ignoring the no-DOT and DOT=0 trailing rows).
    assert.equal(valid.length, 5);

    const types = new Set(valid.map((r) => r.authority_type));
    assert.ok(types.has('Carrier'), 'expected at least one Carrier row');
    assert.ok(types.has('Broker'), 'expected at least one Broker row');
    assert.ok(types.has('Freight Forwarder'), 'expected at least one Freight Forwarder row');
  });

  it('captures insurance carrier name and amounts as JSON-friendly shapes', async () => {
    const rows = (await parseFixture()).filter((r) => r != null);
    const acme = rows.find(
      (r) => r.dot === 123456 && r.authority_type === 'Carrier' && r.status === 'A',
    );
    assert.ok(acme, 'expected an active Common-authority row for DOT 123456');
    assert.deepEqual(acme.insurance_carriers, ['PROGRESSIVE FREIGHT INS']);
    assert.equal(acme.insurance_amounts.required, 750000);
    assert.equal(acme.insurance_amounts.on_file, 1000000);
  });

  it('parses MM/DD/YYYY authority_status_changed_at into ISO', async () => {
    const rows = (await parseFixture()).filter((r) => r != null);
    const ff = rows.find((r) => r.authority_type === 'Freight Forwarder');
    assert.ok(ff, 'expected a Freight Forwarder row in fixture');
    assert.match(ff.authority_status_changed_at, /^2026-01-10T/);
  });

  it('drops rows that lack DOT, MC, or authority_type', () => {
    const map = buildHeaderMap([
      'DOT_NUMBER',
      'MC_MX_FF_NUMBER',
      'AUTHORITY_TYPE',
      'AUTHORITY_STATUS',
    ]);
    assert.equal(
      parseAuthorityRow({ DOT_NUMBER: '', MC_MX_FF_NUMBER: 'MC-1', AUTHORITY_TYPE: 'Broker' }, map),
      null,
    );
    assert.equal(
      parseAuthorityRow({ DOT_NUMBER: '1', MC_MX_FF_NUMBER: '', AUTHORITY_TYPE: 'Broker' }, map),
      null,
    );
    assert.equal(
      parseAuthorityRow({ DOT_NUMBER: '1', MC_MX_FF_NUMBER: 'MC-1', AUTHORITY_TYPE: '' }, map),
      null,
    );
  });
});
