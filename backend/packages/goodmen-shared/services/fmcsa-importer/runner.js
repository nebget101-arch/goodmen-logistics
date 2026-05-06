'use strict';

const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { createGunzip } = require('node:zlib');
const { Writable } = require('node:stream');

const axios = require('axios');

const { createCsvStream } = require('./utils/csv-stream');

const DEFAULT_BATCH_SIZE = 500;

/**
 * Resolve the input source descriptor into a node Readable stream.
 *
 * Accepts:
 *   - { stream: <Readable> }      — already-open stream (used by tests)
 *   - { filePath: '/abs/path' }   — local file (gunzipped if .gz)
 *   - { url: 'https://...' }      — HTTP(S) URL (gunzipped if .gz)
 */
async function openSource(source) {
  if (source.stream) return source.stream;

  if (source.filePath) {
    const raw = fs.createReadStream(source.filePath);
    return source.filePath.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  }

  if (source.url) {
    const res = await axios.get(source.url, {
      responseType: 'stream',
      // Bulk files can be hundreds of MB; the request itself should not time out.
      timeout: 0,
      decompress: false,
      headers: { 'User-Agent': 'FleetNeuron/fmcsa-importer (+contact@fleetneuron.app)' },
    });
    return source.url.endsWith('.gz') ? res.data.pipe(createGunzip()) : res.data;
  }

  throw new Error('fmcsa-importer: source must include {stream}, {filePath}, or {url}');
}

/**
 * Begin/end an `fmcsa.import_runs` row around the import. The `file` value
 * must satisfy the table's CHECK constraint (census | authority | inspections | crashes | sms).
 */
async function startImportRun(knex, { file, triggeredBy, triggeredByUserId }) {
  const [row] = await knex('fmcsa.import_runs')
    .insert({
      file,
      triggered_by: triggeredBy,
      triggered_by_user_id: triggeredByUserId || null,
      started_at: knex.fn.now(),
      status: 'running',
    })
    .returning(['id']);
  return row.id;
}

async function finishImportRun(knex, runId, { status, counts, errorMessage }) {
  await knex('fmcsa.import_runs')
    .where({ id: runId })
    .update({
      status,
      finished_at: knex.fn.now(),
      rows_inserted: counts.inserted,
      rows_updated: counts.updated,
      rows_skipped: counts.skipped,
      error_message: errorMessage || null,
      updated_at: knex.fn.now(),
    });
}

/**
 * Drive a CSV import end-to-end.
 *
 * Contract:
 *   importerSpec.file           — value for fmcsa.import_runs.file (CHECK list)
 *   importerSpec.parser.buildHeaderMap(headers) → headerMap
 *   importerSpec.parser.parseRow(row, headerMap) → recordOrNull
 *   importerSpec.upsertBatch(knex, records) → { inserted, updated }
 *
 * Returns { runId, counts, durationMs }.
 */
async function runImport({
  knex,
  source,
  importerSpec,
  triggeredBy,
  triggeredByUserId = null,
  batchSize = DEFAULT_BATCH_SIZE,
  delimiter = ',',
}) {
  if (!knex) throw new Error('fmcsa-importer: knex is required');
  if (!importerSpec || !importerSpec.parser || !importerSpec.upsertBatch) {
    throw new Error('fmcsa-importer: importerSpec must include {parser, upsertBatch}');
  }

  const runId = await startImportRun(knex, {
    file: importerSpec.file,
    triggeredBy,
    triggeredByUserId,
  });

  const counts = { inserted: 0, updated: 0, skipped: 0 };
  const startedAt = Date.now();

  try {
    const inputStream = await openSource(source);
    const csvStream = createCsvStream({ delimiter });

    let headerMap = null;
    let buffer = [];

    async function flushBuffer() {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      const result = await importerSpec.upsertBatch(knex, batch);
      counts.inserted += result.inserted;
      counts.updated += result.updated;
      counts.skipped += batch.length - result.inserted - result.updated;
    }

    const consumer = new Writable({
      objectMode: true,
      async write(row, _enc, cb) {
        try {
          if (!headerMap) {
            // First row delivered after header — use the headers seen on the
            // CSV stream (which it stripped) by inspecting row keys.
            headerMap = importerSpec.parser.buildHeaderMap(Object.keys(row));
          }
          const record = importerSpec.parser.parseRow(row, headerMap);
          if (record == null) {
            counts.skipped++;
          } else {
            buffer.push(record);
            if (buffer.length >= batchSize) {
              await flushBuffer();
            }
          }
          cb();
        } catch (err) {
          cb(err);
        }
      },
      async final(cb) {
        try {
          await flushBuffer();
          cb();
        } catch (err) {
          cb(err);
        }
      },
    });

    await pipeline(inputStream, csvStream, consumer);

    await finishImportRun(knex, runId, { status: 'success', counts });
    return { runId, counts, durationMs: Date.now() - startedAt };
  } catch (err) {
    await finishImportRun(knex, runId, {
      status: 'failed',
      counts,
      errorMessage: err && err.message ? err.message.slice(0, 1000) : 'unknown error',
    });
    throw err;
  }
}

module.exports = { runImport, DEFAULT_BATCH_SIZE };
