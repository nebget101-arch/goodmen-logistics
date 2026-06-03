'use strict';

/**
 * SMS BASIC scores import driver.
 *
 * Inserts into fmcsa.basic_scores using ON CONFLICT (dot, basic, computed_at)
 * DO NOTHING — historical scores are append-only. Re-importing the same file
 * is a no-op for existing rows; new measurement periods land as new rows.
 *
 * Audited via fmcsa.import_runs.
 */

const { getFmcsaKnex } = require('../fmcsa-knex');
const smsV1 = require('./parsers/sms.v1');

const LOG_PREFIX = '[fmcsa-import][sms]';
const BATCH_SIZE = 500;

/**
 * @param {object} opts
 * @param {NodeJS.ReadableStream} opts.source
 * @param {'manual'|'cron'}        opts.triggeredBy
 * @param {string}                [opts.triggeredByUserId]
 * @param {object}                [opts.parser]
 * @returns {Promise<{importRunId: string, rowsInserted: number, rowsUpdated: number, rowsSkipped: number}>}
 */
async function runSmsImport({ source, triggeredBy, triggeredByUserId, parser } = {}) {
  if (!source) throw new Error(`${LOG_PREFIX} source stream is required`);
  if (triggeredBy !== 'manual' && triggeredBy !== 'cron') {
    throw new Error(`${LOG_PREFIX} triggeredBy must be 'manual' or 'cron'`);
  }
  const useParser = parser || smsV1;
  const knex = getFmcsaKnex();

  const [run] = await knex('fmcsa.import_runs')
    .insert({
      file: 'sms',
      triggered_by: triggeredBy,
      triggered_by_user_id: triggeredByUserId || null,
      status: 'running',
    })
    .returning(['id']);
  const importRunId = run.id;
  console.log(`${LOG_PREFIX} run ${importRunId} started`);

  let rowsInserted = 0;
  let rowsSkipped = 0;
  let rowsProcessed = 0;

  let batch = [];

  async function flush() {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];

    await knex.transaction(async (trx) => {
      // History is preserved — never overwrite. DO NOTHING on conflict.
      const result = await trx('fmcsa.basic_scores')
        .insert(rows)
        .onConflict(['dot', 'basic', 'computed_at'])
        .ignore()
        .returning(['dot']);
      // returning() with .ignore() returns only newly-inserted rows on Postgres.
      const insertedCount = Array.isArray(result) ? result.length : 0;
      rowsInserted += insertedCount;
      rowsSkipped += rows.length - insertedCount;
    });
  }

  try {
    for await (const score of useParser.parse(source)) {
      if (!score || !score.dot || !score.basic || !score.computed_at) {
        rowsSkipped += 1;
        continue;
      }
      batch.push(score);
      rowsProcessed += 1;

      if (batch.length >= BATCH_SIZE) {
        await flush();
      }
      if (rowsProcessed % 10000 === 0) {
        console.log(`${LOG_PREFIX} run ${importRunId} processed ${rowsProcessed} scores`);
      }
    }
    await flush();

    await knex('fmcsa.import_runs')
      .where({ id: importRunId })
      .update({
        status: 'success',
        finished_at: knex.fn.now(),
        rows_inserted: rowsInserted,
        rows_updated: 0,
        rows_skipped: rowsSkipped,
      });
    console.log(
      `${LOG_PREFIX} run ${importRunId} success — inserted=${rowsInserted} skipped=${rowsSkipped}`
    );
    return { importRunId, rowsInserted, rowsUpdated: 0, rowsSkipped };
  } catch (err) {
    console.error(`${LOG_PREFIX} run ${importRunId} failed:`, err.message);
    try {
      await knex('fmcsa.import_runs')
        .where({ id: importRunId })
        .update({
          status: 'error',
          finished_at: knex.fn.now(),
          rows_inserted: rowsInserted,
          rows_updated: 0,
          rows_skipped: rowsSkipped,
          error_message: String(err && err.message ? err.message : err).slice(0, 4000),
        });
    } catch (markErr) {
      console.error(`${LOG_PREFIX} failed to mark run ${importRunId} errored:`, markErr.message);
    }
    throw err;
  }
}

module.exports = { runSmsImport };
