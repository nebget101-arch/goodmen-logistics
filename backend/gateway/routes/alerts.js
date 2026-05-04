'use strict';

/**
 * FN-1161: Smart Alerts router.
 *
 *   GET  /api/alerts/smart                 — returns ranked, non-dismissed alerts
 *   POST /api/alerts/smart/:id/dismiss     — record a dismissal, push WS event
 *
 * Mounted on the gateway before the catch-all proxy. JWT verification is
 * inline (mirrors `routes/ai.js`) so this route stays self-contained.
 */

const express = require('express');
const jwt = require('jsonwebtoken');

function authenticate(req, jwtSecret) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { error: { status: 401, message: 'Unauthorized: missing bearer token' } };
  }
  let decoded;
  try {
    decoded = jwt.verify(authHeader.slice(7), jwtSecret);
  } catch {
    return { error: { status: 401, message: 'Unauthorized: invalid token' } };
  }
  const tenantId = decoded.tenant_id || decoded.tenantId;
  const userId = decoded.sub || decoded.id || decoded.userId;
  if (!tenantId) {
    return { error: { status: 401, message: 'Unauthorized: tenant context missing' } };
  }
  if (!userId) {
    return { error: { status: 401, message: 'Unauthorized: user context missing' } };
  }
  return { tenantId, userId, authHeader };
}

function buildAlertsRouter(deps) {
  const {
    aggregator,
    dismissalsStore,
    broadcaster,
    jwtSecret
  } = deps;

  if (!aggregator) throw new Error('alerts router: aggregator is required');
  if (!dismissalsStore) throw new Error('alerts router: dismissalsStore is required');
  if (!broadcaster) throw new Error('alerts router: broadcaster is required');
  if (!jwtSecret) throw new Error('alerts router: jwtSecret is required');

  const router = express.Router();

  router.get('/smart', async (req, res) => {
    const auth = authenticate(req, jwtSecret);
    if (auth.error) {
      return res.status(auth.error.status).json({ error: auth.error.message });
    }

    try {
      const result = await aggregator.collect({
        tenantId: auth.tenantId,
        userId: auth.userId,
        authHeader: auth.authHeader,
        dismissalsStore
      });
      // Best-effort: push to other connected clients in the same tenant so
      // panels stay in sync without polling. Failure here must not fail the
      // request.
      try {
        broadcaster.broadcastAlerts({
          tenantId: result.tenantId,
          alerts: result.alerts,
          generatedAt: result.generatedAt
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[gateway] alerts broadcast failed:', err.message);
      }
      return res.json(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[gateway] smart alerts aggregation failed:', err.message);
      return res.status(502).json({
        error: 'Smart alerts aggregation failed',
        message: err.message
      });
    }
  });

  router.post(
    '/smart/:id/dismiss',
    express.json({ limit: '8kb' }),
    async (req, res) => {
      const auth = authenticate(req, jwtSecret);
      if (auth.error) {
        return res.status(auth.error.status).json({ error: auth.error.message });
      }

      const alertId = String(req.params.id || '').trim();
      if (!alertId) {
        return res.status(400).json({ error: 'alert id is required' });
      }

      try {
        const record = await dismissalsStore.dismiss({
          tenantId: auth.tenantId,
          userId: auth.userId,
          alertId
        });
        try {
          broadcaster.broadcastDismissed({
            tenantId: auth.tenantId,
            userId: auth.userId,
            alertId
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[gateway] dismiss broadcast failed:', err.message);
        }
        return res.json({ dismissed: true, ...record });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[gateway] dismissal persistence failed:', err.message);
        return res.status(500).json({
          error: 'Dismissal failed',
          message: err.message
        });
      }
    }
  );

  return router;
}

module.exports = { buildAlertsRouter };
