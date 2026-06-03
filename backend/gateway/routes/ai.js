'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');

const ASK_PROMPT_MAX = 1000;
const EXPLAIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function buildAiRouter(deps) {
  const { aggregator, askForwarder, explainForwarder, jwtSecret } = deps;
  if (!aggregator) throw new Error('ai router: aggregator is required');
  if (!askForwarder) throw new Error('ai router: askForwarder is required');
  if (!explainForwarder) throw new Error('ai router: explainForwarder is required');
  if (!jwtSecret) throw new Error('ai router: jwtSecret is required');

  const router = express.Router();

  router.get('/briefing', async (req, res) => {
    const auth = authenticate(req, jwtSecret);
    if (auth.error) {
      return res.status(auth.error.status).json({ error: auth.error.message });
    }

    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';

    let localDate = null;
    if (req.query.localDate !== undefined) {
      const raw = req.query.localDate;
      if (typeof raw !== 'string' || !LOCAL_DATE_PATTERN.test(raw)) {
        return res.status(400).json({ error: 'Invalid localDate' });
      }
      localDate = raw;
    }

    try {
      const result = await aggregator.generate({
        tenantId: auth.tenantId,
        authHeader: auth.authHeader,
        refresh,
        localDate
      });
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

  // FN-1148: forwards { prompt, briefingContext } to ai-service /api/ai/ask.
  // Express 5 has built-in JSON parsing via express.json(); apply it just to
  // this route since the rest of the gateway is proxy-only.
  router.post('/ask', express.json({ limit: '64kb' }), async (req, res) => {
    const auth = authenticate(req, jwtSecret);
    if (auth.error) {
      return res.status(auth.error.status).json({ error: auth.error.message });
    }

    const body = req.body || {};
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (prompt.length > ASK_PROMPT_MAX) {
      return res.status(400).json({ error: `prompt must be ${ASK_PROMPT_MAX} characters or less` });
    }
    const briefingContext = body.briefingContext;
    if (briefingContext != null && (typeof briefingContext !== 'object' || Array.isArray(briefingContext))) {
      return res.status(400).json({ error: 'briefingContext must be an object when provided' });
    }

    try {
      const upstream = await askForwarder.forward({
        tenantId: auth.tenantId,
        authHeader: auth.authHeader,
        prompt,
        briefingContext: briefingContext || null
      });
      const status = upstream.status >= 200 && upstream.status < 600 ? upstream.status : 502;
      return res.status(status).json(upstream.body || { error: 'AI service returned no body' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[gateway] ask forwarding failed:', err.message);
      return res.status(502).json({
        error: 'Ask FleetNeuron forwarding failed',
        message: err.message
      });
    }
  });

  // FN-1177: forwards GET /api/ai/explain/:token to ai-service after
  // verifying the caller's JWT and pinning the upstream call to the JWT's
  // tenant. ai-service returns 404 when the token is expired or scoped to a
  // different tenant; the gateway passes that through unchanged so leaks
  // can't be probed via timing or status codes.
  router.get('/explain/:token', async (req, res) => {
    const auth = authenticate(req, jwtSecret);
    if (auth.error) {
      return res.status(auth.error.status).json({ error: auth.error.message });
    }

    const token = req.params.token || '';
    if (!EXPLAIN_TOKEN_PATTERN.test(token)) {
      return res.status(404).json({ error: 'Explanation not found' });
    }

    try {
      const upstream = await explainForwarder.forward({
        tenantId: auth.tenantId,
        authHeader: auth.authHeader,
        token
      });
      const status = upstream.status >= 200 && upstream.status < 600 ? upstream.status : 502;
      return res.status(status).json(upstream.body || { error: 'AI service returned no body' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[gateway] explain forwarding failed:', err.message);
      return res.status(502).json({
        error: 'Explain forwarding failed',
        message: err.message
      });
    }
  });

  return router;
}

module.exports = { buildAiRouter };
