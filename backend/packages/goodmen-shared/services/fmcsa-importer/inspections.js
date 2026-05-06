'use strict';

/**
 * Inspection import driver.
 *
 * Streams an FMCSA inspection file through a versioned parser and upserts:
 *   - fmcsa.inspections (PK: inspection_report_number)
 *   - fmcsa.violations  (PK: inspection_report_number, violation_code, sequence)
 *
 * Re-runs are idempotent (ON CONFLICT DO UPDATE). The whole run is tracked
 * in fmcsa.import_runs (status running -> success | error).
 */

const { getFmcsaKnex } = require('../fmcsa-knex');
const inspectionV1 = require('./parsers/inspection.v1');

const LOG_PREFIX = '[fmcsa-import][inspections]';
const BATCH_SIZE = 500;

/**
 * @param {object} opts
 * @param {NodeJS.ReadableStream} opts.source       - readable stream of CSV bytes
 * @param {'manual'|'cron'}        opts.triggeredBy
 * @param {string}                [opts.triggeredByUserId]
 * @param {object}                [opts.parser]     - { parse(stream) → AsyncIterable }
 *                                                    Defaults to inspection.v1.
 * @returns {Promise<{importRunId: string, rowsInserted: number, rowsUpdated: number, rowsSkipped: number}>}
 */
async function runInspectionImport({ source, triggeredBy, triggeredByUserId, parser } = {}) {
  if (!source) throw new Error(`${LOG_PREFIX} source stream is required`);
  if (triggeredBy !== 'manual' && triggeredBy !== 'cron') {
    throw new Error(`${LOG_PREFIX} triggeredBy must be 'manual' or 'cron'`);
  }
  const useParser = parser || inspectionV1;
  const knex = getFmcsaKnex();

  // Create the import_runs row up front so the audit trail captures crashes.
  const [run] = await knex('fmcsa.import_runs')
    .insert({
      file: 'inspections',
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

  let inspectionBatch = [];
  let violationBatch = [];

  async function flush() {
    if (inspectionBatch.length === 0 && violationBatch.length === 0) return;
    const insp = inspectionBatch;
    const viol = violationBatch;
    inspectionBatch = [];
    violationBatch = [];

    await knex.transaction(async (trx) => {
      if (insp.length > 0) {
        const result = await trx('fmcsa.inspections')
          .insert(insp)
          .onConflict('inspection_report_number')
          .merge([
            'dot',
            'inspection_date',
            'state',
            'level',
            'vehicle_count',
            'driver_count',
            'hazmat_count',
            'vehicle_oos_count',
            'driver_oos_count',
            'hazmat_oos_count',
            'severity_weight',
            'updated_at',
          ])
          .returning(['inspection_report_number', 'created_at', 'updated_at']);
        // Approximate insert vs update: rows where created_at == updated_at are inserts.
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
      }

      if (viol.length > 0) {
        await trx('fmcsa.violations')
          .insert(viol)
          .onConflict(['inspection_report_number', 'violation_code', 'sequence'])
          .merge(['description', 'oos_flag', 'severity_weight', 'updated_at']);
      }
    });
  }

  try {
    for await (const { inspection, violations } of useParser.parse(source)) {
      if (!inspection || !inspection.inspection_report_number || !inspection.dot || !inspection.inspection_date) {
        rowsSkipped += 1;
        continue;
      }
      inspectionBatch.push(inspection);
      if (Array.isArray(violations) && violations.length > 0) {
        for (const v of violations) violationBatch.push(v);
      }
      rowsProcessed += 1;

      if (inspectionBatch.length >= BATCH_SIZE) {
        await flush();
      }

      if (rowsProcessed % 10000 === 0) {
        console.log(`${LOG_PREFIX} run ${importRunId} processed ${rowsProcessed} inspections`);
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

module.exports = { runInspectionImport };
