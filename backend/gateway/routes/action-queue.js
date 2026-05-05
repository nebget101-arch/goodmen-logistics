'use strict';

/**
 * FN-1330: Action Queue router.
 *
 *   GET  /api/dashboard/action-queue?window=today|7d|30d&severity=critical|high|medium|low|all
 *        → unified, severity-ranked, grouped feed
 *   POST /api/dashboard/action-queue/dismiss { group_id, target_ids?: string[] }
 *        → records dismissal of the group (and optionally each target alert id)
 *
 * Mounted on the gateway BEFORE the `/api/dashboard` proxy so it intercepts
 * before requests are forwarded to reporting-service. Reuses the existing
 * smart-alerts aggregator + dismissals store from FN-1161/FN-1165.
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

function buildActionQueueRouter(deps) {
  const {
    smartAlertsAggregator,
    complianceAlertsClient,
    alertGrouper,
    dismissalsStore,
    jwtSecret
  } = deps;

  if (!smartAlertsAggregator) throw new Error('action-queue router: smartAlertsAggregator is required');
  if (!complianceAlertsClient) throw new Error('action-queue router: complianceAlertsClient is required');
  if (!alertGrouper) throw new Error('action-queue router: alertGrouper is required');
  if (!dismissalsStore) throw new Error('action-queue router: dismissalsStore is required');
  if (!jwtSecret) throw new Error('action-queue router: jwtSecret is required');

  const router = express.Router();

  router.get('/', async (req, res) => {
    const auth = authenticate(req, jwtSecret);
    if (auth.error) {
      return res.status(auth.error.status).json({ error: auth.error.message });
    }

    const window = String(req.query.window || '').trim();
    const severity = String(req.query.severity || '').trim();

    try {
      const [smartResult, complianceResult] = await Promise.all([
        smartAlertsAggregator.collect({
          tenantId: auth.tenantId,
          userId: auth.userId,
          authHeader: auth.authHeader,
          dismissalsStore
        }).catch((err) => ({ alerts: [], upstreamErrors: [{ source: 'smart_alerts', error: String(err?.message || err) }], generatedAt: new Date().toISOString() })),
        complianceAlertsClient.fetchAlerts({ authHeader: auth.authHeader })
      ]);

      const upstreamErrors = [...(smartResult.upstreamErrors || [])];
      if (complianceResult.error) {
        upstreamErrors.push({ source: 'compliance_alerts', error: complianceResult.error });
      }

      // Pull dismissed group/target ids for this user. The dismissals store
      // exposes only `isDismissed`, so probe per group_id encountered. For
      // efficiency we do this AFTER grouping by passing predicate sets the
      // grouper consults; for now we batch a quick probe of all candidate ids.
      const candidateGroupIds = new Set();
      const candidateRawIds = new Set();
      for (const a of smartResult.alerts || []) {
        candidateGroupIds.add(`smart:${a.type || 'unknown'}`);
        if (a.id) candidateRawIds.add(a.id);
      }
      for (const a of complianceResult.alerts || []) {
        const cat = a.category || 'compliance';
        const tmpl = require('../services/alert-grouper').templatizeCompliance(a).template;
        const gid = `compliance:${cat}:${tmpl}`;
        candidateGroupIds.add(gid);
        const targetId = String(a.driverId || a.vehicleId || '');
        candidateRawIds.add(`compliance:${cat}:${tmpl}:${targetId}`);
      }

      const dismissedGroupIds = new Set();
      const dismissedTargetIds = new Set();
      await Promise.all([
        ...Array.from(candidateGroupIds).map(async (gid) => {
          if (await dismissalsStore.isDismissed({ tenantId: auth.tenantId, userId: auth.userId, alertId: gid })) {
            dismissedGroupIds.add(gid);
          }
        }),
        ...Array.from(candidateRawIds).map(async (rid) => {
          if (await dismissalsStore.isDismissed({ tenantId: auth.tenantId, userId: auth.userId, alertId: rid })) {
            dismissedTargetIds.add(rid);
          }
        })
      ]);

      const result = alertGrouper.group({
        smartAlerts: smartResult.alerts || [],
        complianceAlerts: complianceResult.alerts || [],
        window,
        severity,
        generatedAt: smartResult.generatedAt,
        dismissedGroupIds,
        dismissedTargetIds
      });

      return res.json({
        groups: result.groups,
        total: result.total,
        window: result.window,
        severity: result.severity,
        generatedAt: result.generatedAt,
        upstreamErrors
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[gateway] action-queue aggregation failed:', err.message);
      return res.status(502).json({
        error: 'Action queue aggregation failed',
        message: err.message
      });
    }
  });

  router.post(
    '/dismiss',
    express.json({ limit: '8kb' }),
    async (req, res) => {
      const auth = authenticate(req, jwtSecret);
      if (auth.error) {
        return res.status(auth.error.status).json({ error: auth.error.message });
      }

      const body = req.body || {};
      const groupId = typeof body.group_id === 'string' ? body.group_id.trim() : '';
      const targetIds = Array.isArray(body.target_ids)
        ? body.target_ids.map((t) => String(t).trim()).filter(Boolean)
        : [];

      if (!groupId && targetIds.length === 0) {
        return res.status(400).json({ error: 'group_id or target_ids[] is required' });
      }

      try {
        let dismissed = 0;
        if (groupId) {
          await dismissalsStore.dismiss({ tenantId: auth.tenantId, userId: auth.userId, alertId: groupId });
          dismissed += 1;
        }
        for (const tid of targetIds) {
          // eslint-disable-next-line no-await-in-loop
          await dismissalsStore.dismiss({ tenantId: auth.tenantId, userId: auth.userId, alertId: tid });
          dismissed += 1;
        }
        return res.json({ dismissed_count: dismissed, group_id: groupId || null });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[gateway] action-queue dismiss failed:', err.message);
        return res.status(500).json({
          error: 'Dismissal failed',
          message: err.message
        });
      }
    }
  );

  return router;
}

module.exports = { buildActionQueueRouter };
