'use strict';

/**
 * FN-1330: Compliance alerts client.
 *
 * Thin wrapper that fetches the existing compliance alerts feed
 * (`GET /api/dashboard/alerts`) from reporting-service for a given tenant
 * and returns the parsed array. Failures resolve to `{ alerts: [], error }`
 * so the action-queue endpoint can still return whatever Smart Alerts loaded
 * (matches the lenient pattern in smart-alerts-aggregator).
 */

const DEFAULT_TIMEOUT_MS = 8000;

function buildComplianceAlertsClient(deps) {
  const { fetcher, reportingUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = deps;
  if (!fetcher) throw new Error('compliance-alerts-client: fetcher is required');
  if (!reportingUrl) throw new Error('compliance-alerts-client: reportingUrl is required');

  async function fetchAlerts({ authHeader }) {
    const headers = { Accept: 'application/json' };
    if (authHeader) headers.Authorization = authHeader;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher(`${reportingUrl}/api/dashboard/alerts`, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      if (!res.ok) {
        return { alerts: [], error: `compliance alerts upstream ${res.status}` };
      }
      const body = await res.json();
      const alerts = Array.isArray(body) ? body : (Array.isArray(body?.alerts) ? body.alerts : []);
      return { alerts, error: null };
    } catch (err) {
      return { alerts: [], error: String(err?.message || err) };
    } finally {
      clearTimeout(timer);
    }
  }

  return { fetchAlerts };
}

module.exports = { buildComplianceAlertsClient };
