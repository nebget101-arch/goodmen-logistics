'use strict';

/**
 * End-to-end integration test for the FMCSA Census + Authority importers.
 *
 * Strategy: feed the committed fixtures through the real runner against the
 * dev database. Each test cleans up only the DOTs / MCs from the fixture so
 * it never disturbs other rows. If no database is reachable, the suite skips
 * (matches fmcsa-knex.test.js — local dev without Postgres still passes CI).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');
const { Readable } = require('node:stream');

const mainKnex = require('../../../config/knex');
const { runCensusImport } = require('../census');
const { runAuthorityImport } = require('../authority');

const CENSUS_FIXTURE = path.join(__dirname, '..', '__fixtures__', 'census-sample.csv');
const AUTHORITY_FIXTURE = path.join(__dirname, '..', '__fixtures__', 'authority-sample.csv');

const FIXTURE_DOTS = [123456, 654321, 99887766, 777888];

function fixtureStream(file) {
  return Readable.from(fs.readFileSync(file));
}

async function databaseAvailable() {
  try {
    await mainKnex.raw('SELECT 1');
    // Also verify the fmcsa schema exists (FN-1412 must have run).
    const schemaCheck = await mainKnex.raw(
      "SELECT to_regclass('fmcsa.carriers') AS c, to_regclass('fmcsa.authorities') AS a, to_regclass('fmcsa.import_runs') AS r",
    );
    const row = schemaCheck.rows[0] || {};
    return Boolean(row.c && row.a && row.r);
  } catch (err) {
    if (err && /ECONNREFUSED|ENOTFOUND|password authentication|database .* does not exist/i.test(err.message)) {
      return false;
    }
    throw err;
  }
}

async function cleanFixtureRows() {
  await mainKnex('fmcsa.authorities').whereIn('dot', FIXTURE_DOTS).del();
  await mainKnex('fmcsa.carriers').whereIn('dot', FIXTURE_DOTS).del();
  // Test rows in import_runs are removed by file value + a recent window so we
  // don't trample audit history from other test runs that landed earlier.
  await mainKnex('fmcsa.import_runs')
    .whereIn('file', ['census', 'authority'])
    .andWhere('created_at', '>=', mainKnex.raw("NOW() - INTERVAL '5 minutes'"))
    .del();
}

describe('FMCSA bulk importer — end-to-end', () => {
  let dbReady = false;

  before(async () => {
    dbReady = await databaseAvailable();
    if (dbReady) await cleanFixtureRows();
  });

  after(async () => {
    if (dbReady) await cleanFixtureRows();
    await mainKnex.destroy();
  });

  it('imports the census fixture, populating phone/fax/email', async (t) => {
    if (!dbReady) {
      t.skip('no fmcsa schema / database available');
      return;
    }

    const result = await runCensusImport({
      knex: mainKnex,
      source: { stream: fixtureStream(CENSUS_FIXTURE) },
      triggeredBy: 'manual',
      batchSize: 100,
    });

    assert.equal(result.counts.inserted, 3, 'expected 3 carrier rows inserted');
    assert.equal(result.counts.updated, 0);
    assert.ok(result.runId, 'runId should be set');

    const rows = await mainKnex('fmcsa.carriers').whereIn('dot', FIXTURE_DOTS).select('*');
    assert.equal(rows.length, 3);

    const acme = rows.find((r) => Number(r.dot) === 123456);
    assert.equal(acme.legal_name, 'ACME LOGISTICS INC');
    assert.equal(acme.phone, '(214) 555-1212');
    assert.equal(acme.fax, '(214) 555-2121');
    assert.equal(acme.email, 'ops@acme.example');
    assert.ok(acme.fmcsa_synced_at, 'fmcsa_synced_at must be populated');
  });

  it('is idempotent — re-running the same fixture is a no-op', async (t) => {
    if (!dbReady) {
      t.skip('no database');
      return;
    }
    const before = await mainKnex('fmcsa.carriers')
      .whereIn('dot', FIXTURE_DOTS)
      .select('dot', 'fmcsa_synced_at');

    const result = await runCensusImport({
      knex: mainKnex,
      source: { stream: fixtureStream(CENSUS_FIXTURE) },
      triggeredBy: 'manual',
      batchSize: 100,
    });

    // Same data → ON CONFLICT DO UPDATE WHERE fails the IS DISTINCT FROM
    // predicate, so neither inserted nor updated counters tick.
    assert.equal(result.counts.inserted, 0);
    assert.equal(result.counts.updated, 0);

    const after = await mainKnex('fmcsa.carriers')
      .whereIn('dot', FIXTURE_DOTS)
      .select('dot', 'fmcsa_synced_at');
    // fmcsa_synced_at must NOT advance for unchanged rows.
    for (const a of after) {
      const b = before.find((x) => String(x.dot) === String(a.dot));
      assert.equal(
        new Date(a.fmcsa_synced_at).getTime(),
        new Date(b.fmcsa_synced_at).getTime(),
        `fmcsa_synced_at advanced for unchanged DOT ${a.dot}`,
      );
    }
  });

  it('updates fmcsa_synced_at when a row actually changes', async (t) => {
    if (!dbReady) {
      t.skip('no database');
      return;
    }
    // Mutate one column out of band to simulate "the next snapshot has a new value".
    await mainKnex('fmcsa.carriers').where({ dot: 123456 }).update({ phone: '(000) 000-0000' });

    const result = await runCensusImport({
      knex: mainKnex,
      source: { stream: fixtureStream(CENSUS_FIXTURE) },
      triggeredBy: 'manual',
      batchSize: 100,
    });

    assert.equal(result.counts.updated, 1, 'exactly the mutated row should be updated');

    const acme = await mainKnex('fmcsa.carriers').where({ dot: 123456 }).first();
    assert.equal(acme.phone, '(214) 555-1212', 'phone must be restored from CSV');
  });

  it('imports the authority fixture, covering Carrier + Broker + Freight Forwarder', async (t) => {
    if (!dbReady) {
      t.skip('no database');
      return;
    }

    const result = await runAuthorityImport({
      knex: mainKnex,
      source: { stream: fixtureStream(AUTHORITY_FIXTURE) },
      triggeredBy: 'manual',
      batchSize: 100,
    });

    assert.ok(result.counts.inserted >= 3, `expected >= 3 inserted, got ${result.counts.inserted}`);

    const rows = await mainKnex('fmcsa.authorities').whereIn('dot', FIXTURE_DOTS).select('*');

    const types = new Set(rows.map((r) => r.authority_type));
    assert.ok(types.has('Carrier'), 'Carrier authority_type must be present');
    assert.ok(types.has('Broker'), 'Broker authority_type must be present');
    assert.ok(types.has('Freight Forwarder'), 'Freight Forwarder authority_type must be present');

    const carrier = rows.find((r) => Number(r.dot) === 123456 && r.authority_type === 'Carrier');
    assert.ok(carrier);
    assert.equal(carrier.status, 'A');
    // insurance_carriers is jsonb — knex returns it as JS array
    assert.deepEqual(carrier.insurance_carriers, ['PROGRESSIVE FREIGHT INS']);
  });

  it('records an import_runs row per run with success status + counts', async (t) => {
    if (!dbReady) {
      t.skip('no database');
      return;
    }
    const censusRuns = await mainKnex('fmcsa.import_runs')
      .where({ file: 'census' })
      .andWhere('created_at', '>=', mainKnex.raw("NOW() - INTERVAL '5 minutes'"))
      .select('*');
    assert.ok(censusRuns.length >= 1);
    const last = censusRuns[censusRuns.length - 1];
    assert.equal(last.status, 'success');
    assert.equal(last.triggered_by, 'manual');
    assert.ok(last.finished_at, 'finished_at must be set');
  });
});
