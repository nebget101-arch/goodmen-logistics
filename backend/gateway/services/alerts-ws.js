'use strict';

/**
 * FN-1161: WebSocket broadcaster for Smart Alerts.
 *
 * Wraps the gateway's Socket.IO server to push real-time updates to
 * connected clients in a tenant's room. Clients (frontend Smart Alerts
 * panel) subscribe to:
 *   - `alerts.smart.update`     payload: { tenantId, alerts, generatedAt }
 *   - `alerts.smart.dismissed`  payload: { tenantId, userId, alertId }
 *
 * The broadcaster takes an `emit({ tenantId, event, payload })` function
 * so it can be mocked in tests; in production this is wired to
 * `io.to('tenant:<id>').emit(event, payload)`.
 */

const EVENT_UPDATE = 'alerts.smart.update';
const EVENT_DISMISSED = 'alerts.smart.dismissed';

function buildAlertsBroadcaster(deps) {
  const { emit } = deps;
  if (typeof emit !== 'function') {
    throw new Error('alerts-ws: emit function is required');
  }

  function broadcastAlerts({ tenantId, alerts, generatedAt }) {
    if (!tenantId) return { delivered: false, reason: 'missing_tenant' };
    return emit({
      tenantId,
      event: EVENT_UPDATE,
      payload: {
        tenantId,
        alerts: Array.isArray(alerts) ? alerts : [],
        generatedAt: generatedAt || new Date().toISOString()
      }
    });
  }

  function broadcastDismissed({ tenantId, userId, alertId }) {
    if (!tenantId || !userId || !alertId) {
      return { delivered: false, reason: 'missing_args' };
    }
    return emit({
      tenantId,
      event: EVENT_DISMISSED,
      payload: {
        tenantId,
        userId,
        alertId,
        dismissedAt: new Date().toISOString()
      }
    });
  }

  return { broadcastAlerts, broadcastDismissed };
}

/**
 * Adapt a Socket.IO server into the broadcaster's emit-function shape.
 * The gateway constructs the broadcaster lazily after `initWebSocket`
 * because `ioInstance` may be null when socket.io isn't installed.
 */
function makeSocketIoEmitter(getIoInstance) {
  return function emit({ tenantId, event, payload }) {
    const io = typeof getIoInstance === 'function' ? getIoInstance() : null;
    if (!io) return { delivered: false, reason: 'no_ws_server' };
    try {
      io.to(`tenant:${tenantId}`).emit(event, payload);
      return { delivered: true };
    } catch (err) {
      return { delivered: false, reason: 'emit_error', error: String(err?.message || err) };
    }
  };
}

module.exports = {
  buildAlertsBroadcaster,
  makeSocketIoEmitter,
  EVENT_UPDATE,
  EVENT_DISMISSED
};
