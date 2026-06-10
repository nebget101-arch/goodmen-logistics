'use strict';

const aiServiceClient = require('../clients/ai-service.client');
const triageService = require('../services/triage.service');
const triageTelemetry = require('../telemetry/triage.telemetry');

async function postTriage(req, res) {
  const { id: incidentId } = req.params;
  const tenantId = req.context?.tenantId;
  const authHeader = req.headers.authorization;

  if (!tenantId) {
    return res.status(400).json({ error: 'Missing tenant context' });
  }

  const start = Date.now();
  let success = false;
  let errorCode = null;

  try {
    const result = await aiServiceClient.requestTriage({
      tenantId,
      incidentId,
      context: req.body,
      authHeader,
    });

    const latencyMs = Date.now() - start;
    const persisted = await triageService.persistTriageResult({
      incidentId,
      tenantId,
      result,
      latencyMs,
    });

    success = true;
    triageTelemetry.recordTriageCall({ incidentId, tenantId, latencyMs, success });
    return res.status(201).json(persisted);
  } catch (err) {
    const latencyMs = Date.now() - start;
    errorCode = err.message;
    triageTelemetry.recordTriageCall({ incidentId, tenantId, latencyMs, success, errorCode });
    return res.status(500).json({ error: err.message });
  }
}

async function getTriage(req, res) {
  const { id: incidentId } = req.params;
  const tenantId = req.context?.tenantId;

  if (!tenantId) {
    return res.status(400).json({ error: 'Missing tenant context' });
  }

  try {
    const record = await triageService.getLatestTriage({ incidentId, tenantId });
    if (!record) {
      return res.status(404).json({ error: 'No triage record found' });
    }
    return res.json(record);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { postTriage, getTriage };
