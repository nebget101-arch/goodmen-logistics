const dtLogger = require('@goodmen/shared/utils/logger');

function logAiInteraction({ userId, route, message, conversationId, success, errorCode, processingTimeMs }) {
  try {
    dtLogger.info('ai_interaction', {
      userId: userId || null,
      route: route || null,
      conversationId: conversationId || null,
      messagePreview: (message || '').slice(0, 200),
      success: !!success,
      errorCode: errorCode || null,
      processingTimeMs: processingTimeMs || null
    });
  } catch (_err) {
    // Swallow logging errors
  }
}

module.exports = {
  logAiInteraction
};

