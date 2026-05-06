'use strict';

/**
 * FN-1452 — verifies that getRegisteredImporters() exposes the five files the
 * fmcsa-import-queue control plane expects, and that each adapter:
 *   - short-circuits to a zero-row result on dryRun (no network, no DB writes)
 *   - throws an actionable error for inspections/crashes/sms when the source
 *     env var is unset (so the queue records it in fmcsa.import_runs.error_message
 *     instead of crashing the worker).
 *
 * The stronger end-to-end coverage (real Bull + real DB) lives in
 * import-jobs.test.js and runs only when a database is reachable.
 */

const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach } = require('node:test');

const { getRegisteredImporters, _internals } = require('../register-importers');

// Hard-coded mirror of fmcsa-import-queue.js SUPPORTED_FILES so this test does
// not pull `bull` into its require chain. If the constant there changes, this
// list must change too — the assertion below makes the drift loud.
const SUPPORTED_FILES = ['census', 'authority', 'inspections', 'crashes', 'sms'];

describe('FN-1452 getRegisteredImporters()', () => {
  it('registers every file in SUPPORTED_FILES exactly once', () => {
    const pairs = getRegisteredImporters();
    const files = pairs.map(([file]) => file);
    assert.deepEqual(
      files.slice().sort(),
      SUPPORTED_FILES.slice().sort(),
      `expected adapters for ${SUPPORTED_FILES.join(', ')}, got ${files.join(', ')}`,
    );
    assert.equal(files.length, new Set(files).size, 'no duplicate file registrations');
    for (const [file, fn] of pairs) {
      assert.equal(typeof fn, 'function', `adapter for '${file}' must be a function`);
    }
  });

  it('verifies the wiring server.js performs (calls registerImporter for every pair)', () => {
    const calls = [];
    const fakeQueue = {
      registerImporter(file, fn) {
        calls.push({ file, fn });
      },
    };
    for (const [file, fn] of getRegisteredImporters()) {
      fakeQueue.registerImporter(file, fn);
    }
    const seen = calls.map((c) => c.file).sort();
    assert.deepEqual(seen, SUPPORTED_FILES.slice().sort());
    for (const { fn } of calls) assert.equal(typeof fn, 'function');
  });
});

describe('FN-1452 importer adapters — dryRun short-circuit', () => {
  for (const file of ['census', 'authority', 'inspections', 'crashes', 'sms']) {
    it(`'${file}' adapter returns zero rows on dryRun without touching network/DB`, async () => {
      const pair = getRegisteredImporters().find(([f]) => f === file);
      assert.ok(pair, `missing adapter for ${file}`);
      const [, adapter] = pair;
      // `knex` is intentionally a sentinel: a dry run must never invoke it.
      const knexSentinel = new Proxy(
        {},
        {
          get() {
            throw new Error(`dryRun must not touch knex (file=${file})`);
          },
        },
      );
      const result = await adapter(knexSentinel, { dryRun: true });
      assert.deepEqual(result, { rowsInserted: 0, rowsUpdated: 0, rowsSkipped: 0 });
    });
  }
});

describe('FN-1452 snapshot adapters — actionable error when source env var unset', () => {
  const unsetVars = ['FMCSA_INSPECTION_URL', 'FMCSA_CRASH_URL', 'FMCSA_SMS_URL'];
  let savedEnv;

  beforeEach(() => {
    savedEnv = {};
    for (const k of unsetVars) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of unsetVars) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  for (const [file, envVar] of [
    ['inspections', 'FMCSA_INSPECTION_URL'],
    ['crashes', 'FMCSA_CRASH_URL'],
    ['sms', 'FMCSA_SMS_URL'],
  ]) {
    it(`'${file}' adapter throws a message naming '${envVar}' when triggered without dryRun`, async () => {
      const pair = getRegisteredImporters().find(([f]) => f === file);
      assert.ok(pair, `missing adapter for ${file}`);
      const [, adapter] = pair;
      await assert.rejects(
        () => adapter({}, { dryRun: false }),
        (err) => err instanceof Error && err.message.includes(envVar) && err.message.includes(file),
      );
    });
  }
});

describe('FN-1452 _internals exposes the adapter functions for direct testing', () => {
  it('exports all five adapter functions', () => {
    for (const name of [
      'censusImporterAdapter',
      'authorityImporterAdapter',
      'inspectionsImporterAdapter',
      'crashesImporterAdapter',
      'smsImporterAdapter',
    ]) {
      assert.equal(typeof _internals[name], 'function', `missing _internals.${name}`);
    }
  });
});
