'use strict';

/**
 * FN-1452 — verifies that getRegisteredImporters() exposes the five files the
 * fmcsa-import-queue control plane expects, and that each adapter:
 *   - short-circuits to a zero-row result on dryRun (no network, no DB writes)
 *   - throws an actionable error for inspections/crashes/sms when the source
 *     env var is unset (so the queue records it in fmcsa.import_runs.error_message
 *     instead of crashing the worker).
 *
 * FN-1457 — additionally verifies that each adapter prefers an explicit
 * `source: { type: 'path', value }` descriptor over the FMCSA_*_URL env-var
 * fallback, that census/authority translate the descriptor to the runner's
 * `{ filePath }` shape, and that dryRun still short-circuits when a source is
 * set.
 *
 * The stronger end-to-end coverage (real Bull + real DB) lives in
 * import-jobs.test.js and runs only when a database is reachable.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, beforeEach, afterEach } = require('node:test');

const { getRegisteredImporters, _internals } = require('../register-importers');

// Hard-coded mirror of fmcsa-import-queue.js SUPPORTED_FILES so this test does
// not pull `bull` into its require chain. If the constant there changes, this
// list must change too — the assertion below makes the drift loud.
const SUPPORTED_FILES = ['census', 'authority', 'inspections', 'crashes', 'sms'];

const REGISTER_IMPORTERS_PATH = require.resolve('../register-importers');

const RUNNER_MODULE_PATHS = [
  '../census',
  '../authority',
  '../inspections',
  '../crashes',
  '../sms',
].map((p) => require.resolve(p));

/**
 * Reload register-importers.js with the runner exports patched. Returns the
 * freshly required `_internals` plus a `restore()` that puts the originals
 * back and clears the cache so other tests see the unmodified module.
 */
function loadAdaptersWithRunnerStubs(stubs) {
  // Snapshot + mutate each runner module's exports
  const census = require('../census');
  const authority = require('../authority');
  const inspections = require('../inspections');
  const crashes = require('../crashes');
  const sms = require('../sms');

  const originals = {
    runCensusImport: census.runCensusImport,
    runAuthorityImport: authority.runAuthorityImport,
    runInspectionImport: inspections.runInspectionImport,
    runCrashImport: crashes.runCrashImport,
    runSmsImport: sms.runSmsImport,
  };

  if (stubs.runCensusImport) census.runCensusImport = stubs.runCensusImport;
  if (stubs.runAuthorityImport) authority.runAuthorityImport = stubs.runAuthorityImport;
  if (stubs.runInspectionImport) inspections.runInspectionImport = stubs.runInspectionImport;
  if (stubs.runCrashImport) crashes.runCrashImport = stubs.runCrashImport;
  if (stubs.runSmsImport) sms.runSmsImport = stubs.runSmsImport;

  delete require.cache[REGISTER_IMPORTERS_PATH];
  const reloaded = require('../register-importers');

  function restore() {
    census.runCensusImport = originals.runCensusImport;
    authority.runAuthorityImport = originals.runAuthorityImport;
    inspections.runInspectionImport = originals.runInspectionImport;
    crashes.runCrashImport = originals.runCrashImport;
    sms.runSmsImport = originals.runSmsImport;
    delete require.cache[REGISTER_IMPORTERS_PATH];
  }

  return { reloaded, restore };
}

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

describe('FN-1457 sourceToRunnerInput()', () => {
  it('returns null when no source is supplied (runner uses its default)', () => {
    assert.equal(_internals.sourceToRunnerInput(null), null);
    assert.equal(_internals.sourceToRunnerInput(undefined), null);
  });

  it('translates { type: "path" } to { filePath }', () => {
    assert.deepEqual(
      _internals.sourceToRunnerInput({ type: 'path', value: '/tmp/foo.csv' }),
      { filePath: '/tmp/foo.csv' },
    );
  });

  it('translates { type: "url" } to { url }', () => {
    assert.deepEqual(
      _internals.sourceToRunnerInput({ type: 'url', value: 'https://example.com/x.csv' }),
      { url: 'https://example.com/x.csv' },
    );
  });

  it('throws on unknown source.type so misconfiguration fails loudly', () => {
    assert.throws(() => _internals.sourceToRunnerInput({ type: 'magnet', value: 'x' }));
  });
});

describe('FN-1457 census/authority adapters — path source forwarding', () => {
  let restoreFns = [];

  afterEach(() => {
    for (const fn of restoreFns) fn();
    restoreFns = [];
  });

  it('census adapter passes { source: { filePath } } to runCensusImport when given a path source', async () => {
    let captured = null;
    const stub = async (opts) => {
      captured = opts;
      return { counts: { inserted: 7, updated: 3, skipped: 1 } };
    };
    const { reloaded, restore } = loadAdaptersWithRunnerStubs({ runCensusImport: stub });
    restoreFns.push(restore);

    const result = await reloaded._internals.censusImporterAdapter(
      {},
      { dryRun: false, source: { type: 'path', value: '/tmp/upload.csv' } },
    );

    assert.ok(captured, 'runCensusImport was not invoked');
    assert.deepEqual(captured.source, { filePath: '/tmp/upload.csv' });
    assert.equal(captured.triggeredBy, 'manual');
    assert.deepEqual(result, { rowsInserted: 7, rowsUpdated: 3, rowsSkipped: 1 });
  });

  it('census adapter omits source so the runner uses its Socrata default when no source is supplied', async () => {
    let captured = null;
    const stub = async (opts) => {
      captured = opts;
      return { counts: { inserted: 0, updated: 0, skipped: 0 } };
    };
    const { reloaded, restore } = loadAdaptersWithRunnerStubs({ runCensusImport: stub });
    restoreFns.push(restore);

    await reloaded._internals.censusImporterAdapter({}, { dryRun: false });

    assert.ok(captured, 'runCensusImport was not invoked');
    assert.equal(captured.source, undefined, 'source must not be passed when caller omits it');
  });

  it('authority adapter passes { source: { filePath } } to runAuthorityImport when given a path source', async () => {
    let captured = null;
    const stub = async (opts) => {
      captured = opts;
      return { counts: { inserted: 2, updated: 0, skipped: 0 } };
    };
    const { reloaded, restore } = loadAdaptersWithRunnerStubs({ runAuthorityImport: stub });
    restoreFns.push(restore);

    await reloaded._internals.authorityImporterAdapter(
      {},
      { dryRun: false, source: { type: 'path', value: '/tmp/auth-upload.csv.gz' } },
    );

    assert.ok(captured);
    assert.deepEqual(captured.source, { filePath: '/tmp/auth-upload.csv.gz' });
  });
});

describe('FN-1457 snapshot adapters — path source forwarding', () => {
  let restoreFns = [];
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `fn1457-${Date.now()}-${Math.random()}.csv`);
    fs.writeFileSync(tmpFile, 'header\n');
  });

  afterEach(() => {
    for (const fn of restoreFns) fn();
    restoreFns = [];
    if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  for (const [file, runnerKey] of [
    ['inspections', 'runInspectionImport'],
    ['crashes', 'runCrashImport'],
    ['sms', 'runSmsImport'],
  ]) {
    it(`'${file}' adapter opens a Readable from the path source and passes it to ${runnerKey}, ignoring env vars`, async () => {
      // Set the env var to garbage so the test fails loudly if the adapter
      // ever falls back to it instead of using the supplied source.
      const envVar = `FMCSA_${file === 'inspections' ? 'INSPECTION' : file === 'crashes' ? 'CRASH' : 'SMS'}_URL`;
      const savedEnv = process.env[envVar];
      process.env[envVar] = 'https://should-not-be-used.invalid/';

      let captured = null;
      const stub = async (opts) => {
        captured = opts;
        return { rowsInserted: 5, rowsUpdated: 0, rowsSkipped: 0 };
      };
      const { reloaded, restore } = loadAdaptersWithRunnerStubs({ [runnerKey]: stub });
      restoreFns.push(() => {
        if (savedEnv === undefined) delete process.env[envVar];
        else process.env[envVar] = savedEnv;
        restore();
      });

      const adapter = reloaded._internals[`${file === 'sms' ? 'sms' : file === 'inspections' ? 'inspections' : 'crashes'}ImporterAdapter`];
      const result = await adapter({}, {
        dryRun: false,
        source: { type: 'path', value: tmpFile },
      });

      assert.ok(captured, `${runnerKey} was not invoked`);
      assert.ok(captured.source, 'runner must receive a source stream');
      // The stream must be a Readable opened from the local file.
      assert.equal(typeof captured.source.pipe, 'function', 'source must be a Readable stream');
      assert.equal(captured.triggeredBy, 'manual');
      assert.deepEqual(result, { rowsInserted: 5, rowsUpdated: 0, rowsSkipped: 0 });

      // Drain the stream to release the file handle so afterEach can unlink.
      captured.source.resume();
      await new Promise((resolve) => captured.source.on('end', resolve));
    });
  }
});

describe('FN-1457 dryRun short-circuit still applies when source is supplied', () => {
  for (const file of SUPPORTED_FILES) {
    it(`'${file}' adapter returns zero rows on dryRun even when a path source is set`, async () => {
      const pair = getRegisteredImporters().find(([f]) => f === file);
      assert.ok(pair);
      const [, adapter] = pair;
      const knexSentinel = new Proxy(
        {},
        {
          get() {
            throw new Error(`dryRun must not touch knex (file=${file})`);
          },
        },
      );
      const result = await adapter(knexSentinel, {
        dryRun: true,
        source: { type: 'path', value: '/tmp/should-not-be-read.csv' },
      });
      assert.deepEqual(result, { rowsInserted: 0, rowsUpdated: 0, rowsSkipped: 0 });
    });
  }
});
