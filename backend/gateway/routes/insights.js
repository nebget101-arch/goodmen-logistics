'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');

const SUPPORTED_RANGES = new Set(['7d']);

function authenticate(req, jwtSecret) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { error: { status: 401, message: 'Unauthorized: missing bearer token' } };
  }
  let decoded;
  try {
    decoded = jwt.verify(authHeader.slice(7), jwtSecret);
  } catch (err) {
    return { error: { status: 401, message: 'Unauthorized: invalid token' } };
  }
  const tenantId = decoded.tenant_id || decoded.tenantId;
  if (!tenantId) {
    return { error: { status: 401, message: 'Unauthorized: tenant context missing' } };
  }
  return { tenantId, authHeader };
}

function buildInsightsRouter(deps) {
  const { aggregator, jwtSecret } = deps;
  if (!aggregator) throw new Error('insights router: aggregator is required');
  if (!jwtSecret) throw new Error('insights router: jwtSecret is required');

  const router = express.Router();

  router.get('/trends', async (req, res) => {
    const auth = authenticate(req, jwtSecret);
    if (auth.error) {
      return res.status(auth.error.status).json({ error: auth.error.message });
    }

    const range = String(req.query.range || '7d');
    if (!SUPPORTED_RANGES.has(range)) {
      return res.status(400).json({
        error: `Unsupported range '${range}'; supported: ${[...SUPPORTED_RANGES].join(', ')}`
      });
    }

    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';

    try {
      const result = await aggregator.getTrends({
        tenantId: auth.tenantId,
        range,
        refresh
      });
      return res.json(result);
    } catch (err) {
      const status = err.statusCode || 502;
      // eslint-disable-next-line no-console
      console.error('[gateway] trends aggregation failed:', err.message);
      return res.status(status).json({
        error: 'Trends aggregation failed',
        message: err.message
      });
    }
  });

  return router;
}

module.exports = { buildInsightsRouter };
