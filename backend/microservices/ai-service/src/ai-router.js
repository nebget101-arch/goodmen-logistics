const express = require('express');

const { handleChat } = require('./handlers/chat-handler');
const { handleWorkOrderTriage } = require('./handlers/work-order-triage-handler');
const { handleInventoryRecommendations } = require('./handlers/inventory-recommendations-handler');
const { handlePartsAnalysis } = require('./handlers/parts-analysis-handler');
const { handleCustomersAnalysis } = require('./handlers/customers-analysis-handler');

function buildAiRouter(deps) {
  const router = express.Router();

  router.post('/chat', (req, res) => handleChat(req, res, deps));
  router.post('/work-order/triage', (req, res) =>
    handleWorkOrderTriage(req, res, deps)
  );
  router.post('/inventory/recommendations', (req, res) =>
    handleInventoryRecommendations(req, res, deps)
  );
  router.post('/parts/analysis', (req, res) =>
    handlePartsAnalysis(req, res, deps)
  );
  router.post('/customers/analysis', (req, res) =>
    handleCustomersAnalysis(req, res, deps)
  );

  return router;
}

module.exports = {
  buildAiRouter
};

