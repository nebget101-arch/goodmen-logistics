'use strict';

const logger = require('../../utils/logger');

function recordTriageCall({ incidentId, tenantId, latencyMs, success, errorCode = null }) {
  logger.trackEvent('triage.call', {
    incidentId,
    tenantId,
    latencyMs,
    success,
    errorCode,
  });
  logger.sendMetric('triage.call.count', 1, { success: String(success) });
  logger.sendMetric('triage.call.latency_ms', latencyMs, { success: String(success) });
}

module.exports = { recordTriageCall };
