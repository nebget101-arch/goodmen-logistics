'use strict';

const logger = require('../utils/logger');

function recordRollupStart({ day, tenantCount }) {
  logger.info('[rollup] started', { day, tenantCount });
}

function recordRollupComplete({ day, durationMs, results }) {
  const rowsPerTable = { daily_incident_metrics: 0, daily_vendor_sla: 0, daily_payment_metrics: 0 };
  let failureCount = 0;

  for (const r of results) {
    rowsPerTable.daily_incident_metrics += r.rowsWritten >= 1 ? 1 : 0;
    rowsPerTable.daily_vendor_sla       += r.rowsWritten >= 2 ? 1 : 0;
    rowsPerTable.daily_payment_metrics  += r.rowsWritten >= 3 ? 1 : 0;
    failureCount += r.errors.length;
  }

  logger.trackEvent('rollup.complete', {
    day,
    durationMs,
    tenantCount: results.length,
    rowsPerTable,
    failureCount
  });

  logger.sendMetric('rollup.duration_ms', durationMs, { day });
  logger.sendMetric('rollup.rows_written.daily_incident_metrics', rowsPerTable.daily_incident_metrics, { day });
  logger.sendMetric('rollup.rows_written.daily_vendor_sla',       rowsPerTable.daily_vendor_sla, { day });
  logger.sendMetric('rollup.rows_written.daily_payment_metrics',  rowsPerTable.daily_payment_metrics, { day });
  logger.sendMetric('rollup.failure_count', failureCount, { day });
}

function recordRollupFailure({ day, error }) {
  logger.error('[rollup] fatal failure', error, { day });
  logger.sendMetric('rollup.fatal_count', 1, { day });
}

module.exports = { recordRollupStart, recordRollupComplete, recordRollupFailure };
