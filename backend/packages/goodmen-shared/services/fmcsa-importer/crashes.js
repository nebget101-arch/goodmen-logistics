'use strict';

/**
 * Crash import driver.
 *
 * Streams an FMCSA crash file through a versioned parser and upserts
 * fmcsa.crashes (PK: crash_report_number). Audited via fmcsa.import_runs.
 */

const { getFmcsaKnex } = require('../fmcsa-knex');
const crashV1 = require('./parsers/crash.v1');

const LOG_PREFIX = '[fmcsa-import][crashes]';
const BATCH_SIZE = 500;

/**
 * @param {object} opts
 * @param {NodeJS.ReadableStream} opts.source
 * @param {'manual'|'cron'}        opts.triggeredBy
 * @param {string}                [opts.triggeredByUserId]
 * @param {object}                [opts.parser]
 * @returns {Promise<{importRunId: string, rowsInserted: number, rowsUpdated: number, rowsSkipped: number}>}
 */
async function runCrashImport({ source, triggeredBy, triggeredByUserId, parser } = {}) {
  if (!source) throw new Error(`${LOG_PREFIX} source stream is required`);
  if (triggeredBy !== 'manual' && triggeredBy !== 'cron') {
    throw new Error(`${LOG_PREFIX} triggeredBy must be 'manual' or 'cron'`);
  }
  const useParser = parser || crashV1;
  const knex = getFmcsaKnex();

  const [run] = await knex('fmcsa.import_runs')
    .insert({
      file: 'crashes',
      triggered_by: triggeredBy,
      triggered_by_user_id: triggeredByUserId || null,
      status: 'running',
    })
    .returning(['id']);
  const importRunId = run.id;
  console.log(`${LOG_PREFIX} run ${importRunId} started`);

  let rowsInserted = 0;
  let rowsUpdated = 0;
  let rowsSkipped = 0;
  let rowsProcessed = 0;

  let batch = [];

  async function flush() {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];

    await knex.transaction(async (trx) => {
      const result = await trx('fmcsa.crashes')
        .insert(rows)
        .onConflict('crash_report_number')
        .merge(['dot', 'crash_date', 'state', 'fatal_flag', 'injury_flag', 'tow_flag', 'updated_at'])
        .returning(['crash_report_number', 'created_at', 'updated_at']);
      for (const r of result) {
        if (
          r.created_at &&
          r.updated_at &&
          new Date(r.created_at).getTime() === new Date(r.updated_at).getTime()
        ) {
          rowsInserted += 1;
        } else {
          rowsUpdated += 1;
        }
      }
    });
  }

  try {
    for await (const crash of useParser.parse(source)) {
      if (!crash || !crash.crash_report_number || !crash.dot || !crash.crash_date) {
        rowsSkipped += 1;
        continue;
      }
      batch.push(crash);
      rowsProcessed += 1;

      if (batch.length >= BATCH_SIZE) {
        await flush();
      }
      if (rowsProcessed % 10000 === 0) {
        console.log(`${LOG_PREFIX} run ${importRunId} processed ${rowsProcessed} crashes`);
      }
    }
    await flush();

    await knex('fmcsa.import_runs')
      .where({ id: importRunId })
      .update({
        status: 'success',
        finished_at: knex.fn.now(),
        rows_inserted: rowsInserted,
        rows_updated: rowsUpdated,
        rows_skipped: rowsSkipped,
      });
    console.log(
      `${LOG_PREFIX} run ${importRunId} success — inserted=${rowsInserted} updated=${rowsUpdated} skipped=${rowsSkipped}`
    );
    return { importRunId, rowsInserted, rowsUpdated, rowsSkipped };
  } catch (err) {
    console.error(`${LOG_PREFIX} run ${importRunId} failed:`, err.message);
    try {
      await knex('fmcsa.import_runs')
        .where({ id: importRunId })
        .update({
          status: 'error',
          finished_at: knex.fn.now(),
          rows_inserted: rowsInserted,
          rows_updated: rowsUpdated,
          rows_skipped: rowsSkipped,
          error_message: String(err && err.message ? err.message : err).slice(0, 4000),
        });
    } catch (markErr) {
      console.error(`${LOG_PREFIX} failed to mark run ${importRunId} errored:`, markErr.message);
    }
    throw err;
  }
}

module.exports = { runCrashImport };
