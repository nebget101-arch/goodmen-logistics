'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// Skip the whole suite if csv-parse isn't installed yet (deploy step adds it).
let parserModule;
try {
  parserModule = require('../parsers/inspection.v1');
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && /csv-parse/.test(err.message)) {
    describe('inspection.v1 parser', () => {
      it('skipped — csv-parse not installed', (t) => {
        t.skip('install csv-parse via npm install in goodmen-shared to run');
      });
    });
  } else {
    throw err;
  }
}

if (parserModule) {
  const FIXTURE = path.join(__dirname, '..', '__fixtures__', 'inspection-sample.csv');

  async function collect(stream) {
    const out = [];
    for await (const item of parserModule.parse(stream)) out.push(item);
    return out;
  }

  describe('inspection.v1 parser', () => {
    it('groups violation rows under their inspection report number', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const results = await collect(stream);

      assert.equal(results.length, 5, 'expected 5 distinct inspections in fixture');
      const reportNumbers = results.map((r) => r.inspection.inspection_report_number);
      assert.deepEqual(reportNumbers, ['INSP-1001', 'INSP-1002', 'INSP-1003', 'INSP-1004', 'INSP-1005']);
    });

    it('preserves parent-child integrity (each violation references its inspection)', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const results = await collect(stream);
      for (const { inspection, violations } of results) {
        for (const v of violations) {
          assert.equal(
            v.inspection_report_number,
            inspection.inspection_report_number,
            'violation reportNumber must match its inspection'
          );
        }
      }
    });

    it('aggregates inspection-level counts from violation rows', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const results = await collect(stream);

      const byReport = Object.fromEntries(
        results.map((r) => [r.inspection.inspection_report_number, r.inspection])
      );

      // INSP-1001: 1 vehicle (OOS), 1 driver
      assert.equal(byReport['INSP-1001'].vehicle_count, 1);
      assert.equal(byReport['INSP-1001'].driver_count, 1);
      assert.equal(byReport['INSP-1001'].vehicle_oos_count, 1);
      assert.equal(byReport['INSP-1001'].driver_oos_count, 0);
      assert.equal(byReport['INSP-1001'].severity_weight, 8 + 3);

      // INSP-1002: 1 vehicle, 1 hazmat (OOS)
      assert.equal(byReport['INSP-1002'].vehicle_count, 1);
      assert.equal(byReport['INSP-1002'].hazmat_count, 1);
      assert.equal(byReport['INSP-1002'].hazmat_oos_count, 1);
      assert.equal(byReport['INSP-1002'].vehicle_oos_count, 0);
      assert.equal(byReport['INSP-1002'].severity_weight, 4 + 7);

      // INSP-1003: 1 driver (OOS)
      assert.equal(byReport['INSP-1003'].driver_count, 1);
      assert.equal(byReport['INSP-1003'].driver_oos_count, 1);

      // INSP-1004: 2 vehicle, 1 driver (OOS)
      assert.equal(byReport['INSP-1004'].vehicle_count, 2);
      assert.equal(byReport['INSP-1004'].driver_count, 1);
      assert.equal(byReport['INSP-1004'].driver_oos_count, 1);
      assert.equal(byReport['INSP-1004'].vehicle_oos_count, 0);
      assert.equal(byReport['INSP-1004'].severity_weight, 2 + 1 + 10);

      // INSP-1005: 1 hazmat (OOS)
      assert.equal(byReport['INSP-1005'].hazmat_count, 1);
      assert.equal(byReport['INSP-1005'].hazmat_oos_count, 1);
    });

    it('produces violations with stable composite-PK fields', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const results = await collect(stream);

      const insp1004 = results.find((r) => r.inspection.inspection_report_number === 'INSP-1004');
      assert.ok(insp1004);
      assert.equal(insp1004.violations.length, 3);

      // Sequence numbers should be 1, 2, 3 from the fixture
      const seqs = insp1004.violations.map((v) => v.sequence).sort();
      assert.deepEqual(seqs, [1, 2, 3]);

      // OOS flag carries through
      const oosVio = insp1004.violations.find((v) => v.violation_code === '391.41A');
      assert.ok(oosVio);
      assert.equal(oosVio.oos_flag, true);
      assert.equal(oosVio.severity_weight, 10);
    });

    it('parses dates into ISO YYYY-MM-DD', async () => {
      const stream = fs.createReadStream(FIXTURE);
      const results = await collect(stream);
      assert.equal(results[0].inspection.inspection_date, '2026-01-05');
    });

    it('exposes _internals helpers (date and OOS classification)', () => {
      const { parseDate, isOos, classifyUnit } = parserModule._internals;
      assert.equal(parseDate('1/5/2026'), '2026-01-05');
      assert.equal(parseDate('2026-01-05'), '2026-01-05');
      assert.equal(isOos('Y'), true);
      assert.equal(isOos('N'), false);
      assert.equal(classifyUnit('Vehicle'), 'vehicle');
      assert.equal(classifyUnit('Driver'), 'driver');
      assert.equal(classifyUnit('Hazmat'), 'hazmat');
      assert.equal(classifyUnit(''), null);
    });
  });
}
