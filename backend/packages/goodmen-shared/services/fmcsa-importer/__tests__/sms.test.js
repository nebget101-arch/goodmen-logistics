'use strict';

const assert = require('node:assert/strict');
const { describe, it, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const SKIPPABLE = /ECONNREFUSED|ENOTFOUND|password authentication|database .* does not exist|relation .* does not exist|schema .* does not exist|getaddrinfo|self.signed/i;

let importerMod;
let mainKnex;
try {
  importerMod = require('../sms');
  mainKnex = require('../../../config/knex');
} catch (err) {
  // Skip cleanly if any dependency module can't load locally — e2e tests
  // rely on real Postgres + node_modules; in dev the suite should not block.
  if (err && err.code === 'MODULE_NOT_FOUND') {
    describe('runSmsImport (e2e — history preserved)', () => {
      it('skipped — module not installed locally', (t) => {
        t.skip(`run npm install in goodmen-shared to enable (${err.message})`);
      });
    });
  } else {
    throw err;
  }
}

if (importerMod) {
  const { runSmsImport } = importerMod;
  const FIXTURE = path.join(__dirname, '..', '__fixtures__', 'sms-sample.csv');

  describe('runSmsImport (e2e — history preserved)', () => {
    it('re-importing the same fixture preserves all prior rows (no overwrite)', async (t) => {
      try {
        await mainKnex.raw('SELECT 1 FROM fmcsa.basic_scores LIMIT 1');
      } catch (err) {
        if (err && SKIPPABLE.test(err.message || '')) {
          t.skip(`no FMCSA-schema database available (${err.code || err.message})`);
          return;
        }
        throw err;
      }

      const dotsInFixture = [123456, 789012];

      // First import
      const stream1 = fs.createReadStream(FIXTURE);
      const result1 = await runSmsImport({
        source: stream1,
        triggeredBy: 'manual',
      });
      assert.ok(result1.importRunId);

      const countAfterFirst = await mainKnex('fmcsa.basic_scores')
        .whereIn('dot', dotsInFixture)
        .count('* as c')
        .first();

      // Re-import the SAME fixture
      const stream2 = fs.createReadStream(FIXTURE);
      const result2 = await runSmsImport({
        source: stream2,
        triggeredBy: 'manual',
      });
      assert.ok(result2.importRunId);

      const countAfterSecond = await mainKnex('fmcsa.basic_scores')
        .whereIn('dot', dotsInFixture)
        .count('* as c')
        .first();

      // Re-import must not lose any rows. Count must be >= prior count.
      assert.ok(
        Number(countAfterSecond.c) >= Number(countAfterFirst.c),
        `expected count to never decrease (was ${countAfterFirst.c}, now ${countAfterSecond.c})`
      );
      // And the second run should have inserted nothing new (DO NOTHING).
      assert.equal(
        result2.rowsInserted,
        0,
        'second run should insert 0 rows (history preserved by DO NOTHING)'
      );
    });

    after(async () => {
      if (mainKnex) await mainKnex.destroy();
    });
  });
}
