const express = require('express');

const { handleChat } = require('./handlers/chat-handler');
const { handleWorkOrderTriage } = require('./handlers/work-order-triage-handler');
const { handleInventoryRecommendations } = require('./handlers/inventory-recommendations-handler');
const { handlePartsAnalysis } = require('./handlers/parts-analysis-handler');
const { handleCustomersAnalysis } = require('./handlers/customers-analysis-handler');
const { handleFuelPreprocess } = require('./handlers/fuel-preprocess-handler');
const { handleTollCsvNormalize } = require('./handlers/toll-csv-normalize-handler');
const { handleTollInvoiceVision } = require('./handlers/toll-invoice-vision-handler');
const { handleMvrVision } = require('./handlers/mvr-vision-handler');

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
  router.post('/shop-clients/analysis', (req, res) =>
    handleCustomersAnalysis(req, res, deps)
  );
  router.post('/fuel/preprocess', (req, res) =>
    handleFuelPreprocess(req, res, deps)
  );
  router.post('/tolls/csv-normalize', (req, res) =>
    handleTollCsvNormalize(req, res, deps)
  );
  router.post('/tolls/invoice-vision', (req, res) =>
    handleTollInvoiceVision(req, res, deps)
  );
  router.post('/safety/mvr-vision', (req, res) =>
    handleMvrVision(req, res, deps)
  );

  return router;
}

module.exports = {
  buildAiRouter
};

