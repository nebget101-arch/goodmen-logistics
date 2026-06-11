'use strict';

/**
 * FN-1222: Voice intake routes for Twilio webhook + Media Streams.
 *
 * Mounted at /api/voice by server.js.
 * WebSocket upgrade for /api/voice/stream is registered separately on the
 * HTTP server using `ws` expressWs so the same Express router can handle it.
 */

const express = require('express');
const { handleIncoming, handleConsentGather } = require('../voice/voice.controller');

function buildVoiceRouter() {
  const router = express.Router();

  // Twilio signature validation is handled by the devops env (FN-1224);
  // the middleware placeholder below is a no-op in dev but is the hook point.
  router.use((req, _res, next) => {
    next();
  });

  router.post('/incoming', (req, res) => handleIncoming(req, res));
  router.post('/consent', (req, res) => handleConsentGather(req, res));

  return router;
}

module.exports = { buildVoiceRouter };
