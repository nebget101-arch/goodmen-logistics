'use strict';

/**
 * FN-1240: Idempotent incident event publisher.
 *
 * Posts `incident.state_changed` events to the gateway's internal WS emit
 * endpoint (`POST /internal/ws/emit`). Deduplicates using an `event_log`
 * Postgres table (created by FN-1241). If the table does not yet exist the
 * publisher falls through and fires the HTTP call without idempotency
 * protection — safe for the initial deployment window before FN-1241 lands.
 *
 * Event key: (incident_id, state, version)
 *
 * Telemetry emitted per publish:
 *   - success (boolean)
 *   - latency_ms (number)
 *   - duplicate (boolean)
 */

const { query } = require('@goodmen/shared/config/database');

const GATEWAY_URL = process.env.INTERNAL_GATEWAY_URL || 'http://localhost:4000';
const INTERNAL_WS_SECRET = process.env.INTERNAL_WS_SECRET || '';

/**
 * Check whether this (incidentId, state, version) triplet was already published.
 * Returns false on any DB error so the publisher always attempts the HTTP call.
 */
async function _isDuplicate(incidentId, state, version) {
  try {
    const result = await query(
      `SELECT 1 FROM event_log
       WHERE aggregate_id = $1 AND event_type = 'incident.state_changed'
         AND payload->>'state' = $2 AND (payload->>'version')::int = $3
       LIMIT 1`,
      [incidentId, state, version]
    );
    return result.rows.length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Record the event in event_log after successful publish.
 * Silently skips if the table doesn't exist yet (FN-1241 pending).
 */
async function _recordEvent(incidentId, tenantId, state, version) {
  try {
    await query(
      `INSERT INTO event_log (aggregate_id, aggregate_type, event_type, tenant_id, payload, published_at)
       VALUES ($1, 'incident', 'incident.state_changed', $2, $3, NOW())
       ON CONFLICT DO NOTHING`,
      [incidentId, tenantId, JSON.stringify({ state, version })]
    );
  } catch (_) {
    // Table may not exist until FN-1241 migration runs; non-fatal
  }
}

/**
 * Publish an incident state change event via the gateway WS emit endpoint.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.incidentId
 * @param {string} params.state
 * @param {number} params.version
 * @param {string} [params.changedAt]
 * @param {object} [params.meta]
 * @returns {Promise<{ published: boolean, duplicate: boolean, latency_ms: number, error?: string }>}
 */
async function publishIncidentStateChanged({ tenantId, incidentId, state, version, changedAt, meta }) {
  const startMs = Date.now();

  if (!tenantId || !incidentId || !state || version === undefined) {
    return { published: false, duplicate: false, latency_ms: 0, error: 'missing_required_fields' };
  }

  const isDuplicate = await _isDuplicate(incidentId, state, version);
  if (isDuplicate) {
    return { published: false, duplicate: true, latency_ms: Date.now() - startMs };
  }

  const body = JSON.stringify({
    tenantId,
    event: 'incident.state_changed',
    incidentId,
    state,
    version,
    changedAt: changedAt || new Date().toISOString(),
    meta: meta || {}
  });

  try {
    if (!INTERNAL_WS_SECRET) {
      return {
        published: false,
        duplicate: false,
        latency_ms: Date.now() - startMs,
        error: 'INTERNAL_WS_SECRET not configured'
      };
    }

    const resp = await fetch(`${GATEWAY_URL}/internal/ws/emit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': INTERNAL_WS_SECRET
      },
      body,
      signal: AbortSignal.timeout(5000)
    });

    const latency_ms = Date.now() - startMs;

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { published: false, duplicate: false, latency_ms, error: `gateway_${resp.status}: ${text}` };
    }

    await _recordEvent(incidentId, tenantId, state, version);
    return { published: true, duplicate: false, latency_ms };
  } catch (err) {
    return {
      published: false,
      duplicate: false,
      latency_ms: Date.now() - startMs,
      error: err?.message || String(err)
    };
  }
}

module.exports = { publishIncidentStateChanged };
