'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

let parserModule;
try {
  parserModule = require('../parsers/crash.v1');
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && /csv-parse/.test(err.message)) {
    describe('crash.v1 parser', () => {
      it('skipped — csv-parse not installed', (t) => {
        t.skip('install csv-parse via npm install in goodmen-shared to run');
      });
    });
  } else {
    throw err;
  }
}

if (parserModule) {
  const FIXTURE = path.join(__dirname, '..', '__fixtures__', 'crash-sample.csv');

  async function collect(stream) {
    const out = [];
    for await (const item of parserModule.parse(stream)) out.push(item);
    return out;
  }

  describe('crash.v1 parser', () => {
    it('emits one row per crash report in the fixture', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const rows = await collect(stream);
      assert.equal(rows.length, 5);
      const reports = rows.map((r) => r.crash_report_number);
      assert.deepEqual(reports, [
        'CRASH-2001',
        'CRASH-2002',
        'CRASH-2003',
        'CRASH-2004',
        'CRASH-2005',
      ]);
    });

    it('derives fatal/injury/tow flags correctly', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const rows = await collect(stream);
      const byId = Object.fromEntries(rows.map((r) => [r.crash_report_number, r]));

      // CRASH-2001: 0 fatalities, 1 injury, tow=Y
      assert.equal(byId['CRASH-2001'].fatal_flag, false);
      assert.equal(byId['CRASH-2001'].injury_flag, true);
      assert.equal(byId['CRASH-2001'].tow_flag, true);

      // CRASH-2002: 1 fatality, 0 injuries, tow=Y
      assert.equal(byId['CRASH-2002'].fatal_flag, true);
      assert.equal(byId['CRASH-2002'].injury_flag, false);
      assert.equal(byId['CRASH-2002'].tow_flag, true);

      // CRASH-2003: zero everything, tow=N
      assert.equal(byId['CRASH-2003'].fatal_flag, false);
      assert.equal(byId['CRASH-2003'].injury_flag, false);
      assert.equal(byId['CRASH-2003'].tow_flag, false);

      // CRASH-2005: 2 fatalities, 3 injuries, tow=Y
      assert.equal(byId['CRASH-2005'].fatal_flag, true);
      assert.equal(byId['CRASH-2005'].injury_flag, true);
      assert.equal(byId['CRASH-2005'].tow_flag, true);
    });

    it('parses dates and DOT numbers', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const rows = await collect(stream);
      assert.equal(rows[0].crash_date, '2026-01-15');
      assert.equal(rows[0].dot, 123456);
      assert.equal(rows[0].state, 'CA');
    });
  });
}
