'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

let parserModule;
try {
  parserModule = require('../parsers/sms.v1');
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && /csv-parse/.test(err.message)) {
    describe('sms.v1 parser', () => {
      it('skipped — csv-parse not installed', (t) => {
        t.skip('install csv-parse via npm install in goodmen-shared to run');
      });
    });
  } else {
    throw err;
  }
}

if (parserModule) {
  const FIXTURE = path.join(__dirname, '..', '__fixtures__', 'sms-sample.csv');

  async function collect(stream) {
    const out = [];
    for await (const item of parserModule.parse(stream)) out.push(item);
    return out;
  }

  describe('sms.v1 parser', () => {
    it('emits one row per (DOT, BASIC, computed_at) tuple from the fixture', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const rows = await collect(stream);
      assert.equal(rows.length, 10);
    });

    it('derives computed_at from RUNDATE (ISO timestamp)', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const rows = await collect(stream);
      const computedAtSet = new Set(rows.map((r) => r.computed_at));
      // Two distinct measurement periods in the fixture
      assert.equal(computedAtSet.size, 2);
      for (const ts of computedAtSet) {
        assert.match(ts, /^\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('parses numeric measure_value and percentile', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const rows = await collect(stream);
      for (const row of rows) {
        assert.equal(typeof row.measure_value, 'number');
        assert.equal(typeof row.percentile, 'number');
        assert.ok(Number.isFinite(row.measure_value));
        assert.ok(Number.isFinite(row.percentile));
      }
    });

    it('preserves DOT and BASIC name fidelity', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const rows = await collect(stream);

      const dot123 = rows.filter((r) => r.dot === 123456);
      const dot789 = rows.filter((r) => r.dot === 789012);
      assert.equal(dot123.length, 6);
      assert.equal(dot789.length, 4);

      const basicsForDot789 = new Set(dot789.map((r) => r.basic));
      assert.deepEqual([...basicsForDot789].sort(), ['HOS', 'UNSAFE_DRIVING']);
    });

    it('exposes _internals.toComputedAt for date-conversion edge cases', () => {
      const { toComputedAt } = parserModule._internals;
      assert.match(toComputedAt('2026-01-31'), /^2026-01-31T00:00:00/);
      assert.match(toComputedAt('1/31/2026'), /^2026-01-31T00:00:00/);
      assert.equal(toComputedAt(''), null);
      assert.equal(toComputedAt(null), null);
    });
  });
}
