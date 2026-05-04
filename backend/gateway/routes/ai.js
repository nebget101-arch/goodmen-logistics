'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');

function buildAiRouter(deps) {
  const { aggregator, jwtSecret } = deps;
  if (!aggregator) throw new Error('ai router: aggregator is required');
  if (!jwtSecret) throw new Error('ai router: jwtSecret is required');

  const router = express.Router();

  router.get('/briefing', async (req, res) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: missing bearer token' });
    }

    let decoded;
    try {
      decoded = jwt.verify(authHeader.slice(7), jwtSecret);
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }

    const tenantId = decoded.tenant_id || decoded.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: tenant context missing' });
    }

    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';

    try {
      const result = await aggregator.generate({ tenantId, authHeader, refresh });
      return res.json(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[gateway] briefing aggregation failed:', err.message);
      return res.status(502).json({
        error: 'Briefing generation failed',
        message: err.message
      });
    }
  });

  return router;
}

module.exports = { buildAiRouter };
