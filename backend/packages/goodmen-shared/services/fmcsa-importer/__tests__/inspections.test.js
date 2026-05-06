'use strict';

const assert = require('node:assert/strict');
const { describe, it, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const SKIPPABLE = /ECONNREFUSED|ENOTFOUND|password authentication|database .* does not exist|relation .* does not exist|schema .* does not exist|getaddrinfo|self.signed/i;

let importerMod;
let mainKnex;
try {
  importerMod = require('../inspections');
  mainKnex = require('../../../config/knex');
} catch (err) {
  // Skip cleanly if any dependency module can't load locally — e2e tests
  // rely on real Postgres + node_modules; in dev the suite should not block.
  if (err && err.code === 'MODULE_NOT_FOUND') {
    describe('runInspectionImport (e2e)', () => {
      it('skipped — module not installed locally', (t) => {
        t.skip(`run npm install in goodmen-shared to enable (${err.message})`);
      });
    });
  } else {
    throw err;
  }
}

if (importerMod) {
  const { runInspectionImport } = importerMod;
  const FIXTURE = path.join(__dirname, '..', '__fixtures__', 'inspection-sample.csv');

  describe('runInspectionImport (e2e)', () => {
    it('imports the fixture into fmcsa.inspections + fmcsa.violations', async (t) => {
      // Pre-flight: confirm DB reachable AND fmcsa schema present.
      try {
        await mainKnex.raw('SELECT 1 FROM fmcsa.inspections LIMIT 1');
      } catch (err) {
        if (err && SKIPPABLE.test(err.message || '')) {
          t.skip(`no FMCSA-schema database available (${err.code || err.message})`);
          return;
        }
        throw err;
      }

      const stream = fs.createReadStream(FIXTURE);
      const result = await runInspectionImport({
        source: stream,
        triggeredBy: 'manual',
      });

      assert.ok(result.importRunId, 'expected importRunId');
      // 5 inspections in fixture; some may already exist from a prior run, but
      // inserted+updated should equal 5.
      assert.equal(
        result.rowsInserted + result.rowsUpdated,
        5,
        'expected to handle 5 inspections'
      );

      const inspectionRow = await mainKnex('fmcsa.inspections')
        .where({ inspection_report_number: 'INSP-1004' })
        .first();
      assert.ok(inspectionRow, 'INSP-1004 should be present');
      assert.equal(inspectionRow.vehicle_count, 2);
      assert.equal(inspectionRow.driver_count, 1);
      assert.equal(inspectionRow.driver_oos_count, 1);

      const violations = await mainKnex('fmcsa.violations')
        .where({ inspection_report_number: 'INSP-1004' })
        .select('*');
      assert.equal(violations.length, 3, 'INSP-1004 should have 3 violations');
    });

    after(async () => {
      if (mainKnex) await mainKnex.destroy();
    });
  });
}
