'use strict';

const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/api/ai/roadside/triage';

function emitSuccess({ tenantId, latencyMs, cacheReadTokens, cacheCreationTokens, model }) {
  logAiInteraction({
    userId: null,
    route: ROUTE,
    message: `triage ok tenant=${tenantId} model=${model} cache_read=${cacheReadTokens} cache_write=${cacheCreationTokens}`,
    conversationId: null,
    success: true,
    errorCode: null,
    processingTimeMs: latencyMs
  });
}

function emitFailure({ tenantId, latencyMs, errorCode }) {
  logAiInteraction({
    userId: null,
    route: ROUTE,
    message: `triage error tenant=${tenantId}`,
    conversationId: null,
    success: false,
    errorCode: errorCode || 'TRIAGE_ERROR',
    processingTimeMs: latencyMs
  });
}

module.exports = { emitSuccess, emitFailure };
