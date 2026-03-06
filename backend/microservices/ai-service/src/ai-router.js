const express = require('express');

const { handleChat } = require('./handlers/chat-handler');

function buildAiRouter(deps) {
  const router = express.Router();

  router.post('/chat', (req, res) => handleChat(req, res, deps));

  return router;
}

module.exports = {
  buildAiRouter
};

