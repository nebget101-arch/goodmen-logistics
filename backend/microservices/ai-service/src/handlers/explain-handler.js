'use strict';

/**
 * FN-1176: GET /api/ai/explain/:token — returns the rationale stored when
 * an AI-derived value was emitted. Used by the drill-down explanation panel
 * (FN-1132) to render sources, rules, and scores behind any AI claim.
 */

const explainabilityStore = require('../services/explainability-store');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/explain';

async function handleExplain(req, res) {
  const startedAt = Date.now();
  const token = req.params && req.params.token;

  if (!explainabilityStore.isValidTokenFormat(token)) {
    return res.status(400).json({
      success: false,
      error: 'invalid token format',
      code: 'AI_BAD_TOKEN'
    });
  }

  const entry = explainabilityStore.get(token);
  const processingTimeMs = Date.now() - startedAt;

  if (!entry) {
    logAiInteraction({
      userId: req.user && req.user.id ? req.user.id : null,
      route: ROUTE,
      message: `explain miss token=${token}`,
      conversationId: null,
      success: false,
      errorCode: 'AI_TOKEN_NOT_FOUND',
      processingTimeMs
    });
    return res.status(404).json({
      success: false,
      error: 'token not found or expired',
      code: 'AI_TOKEN_NOT_FOUND'
    });
  }

  logAiInteraction({
    userId: req.user && req.user.id ? req.user.id : null,
    route: ROUTE,
    message: `explain hit kind=${entry.rationale && entry.rationale.kind ? entry.rationale.kind : 'unknown'}`,
    conversationId: null,
    success: true,
    errorCode: null,
    processingTimeMs
  });

  return res.json({
    success: true,
    data: entry.rationale,
    meta: {
      token,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      processingTimeMs
    }
  });
}

module.exports = {
  handleExplain
};
