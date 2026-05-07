'use strict';

const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { createGunzip } = require('node:zlib');
const { Writable, Readable } = require('node:stream');

const axios = require('axios');

const { createCsvStream } = require('./utils/csv-stream');

const DEFAULT_BATCH_SIZE = 500;
const SOCRATA_USER_AGENT = 'FleetNeuron/fmcsa-importer (+contact@fleetneuron.app)';
const SOCRATA_DEFAULT_PAGE_SIZE = 50000;
// Hard ceiling so a misconfigured pageSize / runaway dataset can't loop forever.
// 50k × 400 = 20M rows; FMCSA census is ~2.5M and authority ~5M as of 2026-05.
const SOCRATA_MAX_PAGES = 400;

/**
 * Headers attached to every outbound request to data.transportation.gov.
 * `X-App-Token` is included only when `FMCSA_SOCRATA_APP_TOKEN` is set —
 * Socrata's `/resource/{id}.csv` endpoint rejects high-volume anonymous
 * requests (HTTP 400/403), so production runs require the token.
 */
function buildSocrataHeaders() {
  const headers = { 'User-Agent': SOCRATA_USER_AGENT };
  const token = process.env.FMCSA_SOCRATA_APP_TOKEN;
  if (token) headers['X-App-Token'] = token;
  return headers;
}

/**
 * Async-generator over the bytes of a paged Socrata `/resource/{id}.csv`
 * download. Each page is fetched as `?$limit=<pageSize>&$offset=<n*pageSize>`;
 * the CSV header line that Socrata re-emits on every page is stripped from
 * pages 1..N so the runner's CSV consumer sees a single contiguous stream.
 *
 * Termination: a page that returns fewer than `pageSize` data rows is the
 * last page. `SOCRATA_MAX_PAGES` is a defensive ceiling.
 */
async function* socrataPagedChunks({ baseUrl, datasetId, pageSize }) {
  const headers = buildSocrataHeaders();
  for (let pageIndex = 0; pageIndex < SOCRATA_MAX_PAGES; pageIndex++) {
    const offset = pageIndex * pageSize;
    const url = `${baseUrl}/resource/${datasetId}.csv?$limit=${pageSize}&$offset=${offset}`;
    const res = await axios.get(url, {
      responseType: 'stream',
      timeout: 0,
      decompress: false,
      headers,
    });

    let stripHeader = pageIndex > 0;
    let dataNewlines = 0;
    let lastByte = -1;

    for await (const buf of res.data) {
      let chunk = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      if (stripHeader) {
        const nlIdx = chunk.indexOf(0x0a);
        if (nlIdx === -1) continue; // header still incomplete in this chunk
        chunk = chunk.subarray(nlIdx + 1);
        stripHeader = false;
        if (chunk.length === 0) continue;
      }
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) dataNewlines++;
      }
      lastByte = chunk[chunk.length - 1];
      yield chunk;
    }

    // Page 0 includes the header line in newline count; subtract it.
    let dataRows = pageIndex === 0 ? Math.max(0, dataNewlines - 1) : dataNewlines;
    // Last data row may have no trailing newline.
    if (lastByte !== -1 && lastByte !== 0x0a) dataRows++;
    if (dataRows < pageSize) return;
  }
  throw new Error(
    `fmcsa-importer: Socrata paging exceeded ${SOCRATA_MAX_PAGES} pages (datasetId=${datasetId})`,
  );
}

/**
 * Resolve the input source descriptor into a node Readable stream.
 *
 * Accepts:
 *   - { stream: <Readable> }            — already-open stream (used by tests)
 *   - { filePath: '/abs/path' }         — local file (gunzipped if .gz)
 *   - { url: 'https://...' }            — single HTTP(S) URL (gunzipped if .gz);
 *                                         Socrata token attached when set.
 *   - { socrataDataset: { baseUrl, datasetId, pageSize? } }
 *                                       — paged Socrata `/resource/{id}.csv`
 *                                         download, headers stripped between
 *                                         pages so the consumer sees one CSV.
 */
async function openSource(source) {
  if (source.stream) return source.stream;

  if (source.filePath) {
    const raw = fs.createReadStream(source.filePath);
    return source.filePath.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  }

  if (source.socrataDataset) {
    const { baseUrl, datasetId, pageSize } = source.socrataDataset;
    if (!baseUrl || !datasetId) {
      throw new Error('fmcsa-importer: socrataDataset requires {baseUrl, datasetId}');
    }
    return Readable.from(
      socrataPagedChunks({
        baseUrl,
        datasetId,
        pageSize: pageSize || SOCRATA_DEFAULT_PAGE_SIZE,
      }),
    );
  }

  if (source.url) {
    const res = await axios.get(source.url, {
      responseType: 'stream',
      // Bulk files can be hundreds of MB; the request itself should not time out.
      timeout: 0,
      decompress: false,
      headers: buildSocrataHeaders(),
    });
    return source.url.endsWith('.gz') ? res.data.pipe(createGunzip()) : res.data;
  }

  throw new Error(
    'fmcsa-importer: source must include {stream}, {filePath}, {url}, or {socrataDataset}',
  );
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

module.exports = {
  runImport,
  DEFAULT_BATCH_SIZE,
  SOCRATA_DEFAULT_PAGE_SIZE,
  // Exposed for tests + reuse from census/authority drivers
  _internals: { buildSocrataHeaders, socrataPagedChunks, openSource },
};
