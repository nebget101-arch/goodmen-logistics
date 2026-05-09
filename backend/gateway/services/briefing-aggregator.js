'use strict';

const DEFAULT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 8000;

function todayUtcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function fetchWithTimeout(url, options, fetcher, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`upstream ${url} responded ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildBriefingAggregator(deps) {
  const {
    fetcher,
    logisticsUrl,
    driversUrl,
    vehiclesUrl,
    aiUrl,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
    now = () => new Date()
  } = deps;

  if (!fetcher) throw new Error('briefing-aggregator: fetcher is required');
  if (!logisticsUrl) throw new Error('briefing-aggregator: logisticsUrl is required');
  if (!driversUrl) throw new Error('briefing-aggregator: driversUrl is required');
  if (!vehiclesUrl) throw new Error('briefing-aggregator: vehiclesUrl is required');
  if (!aiUrl) throw new Error('briefing-aggregator: aiUrl is required');

  const cache = new Map();

  function cacheKey(tenantId, date) {
    return `${tenantId}:${date}`;
  }

  function readCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now().getTime()) {
      cache.delete(key);
      return null;
    }
    return entry.value;
  }

  function writeCache(key, value) {
    cache.set(key, { value, expiresAt: now().getTime() + cacheTtlMs });
  }

  function invalidate(key) {
    cache.delete(key);
  }

  async function fanOutFleetState({ authHeader, date }) {
    const headers = { Accept: 'application/json' };
    if (authHeader) headers.Authorization = authHeader;
    const opts = { method: 'GET', headers };

    const targets = [
      { key: 'throughput', url: `${logisticsUrl}/api/loads/throughput?date=${date}` },
      { key: 'exceptions', url: `${logisticsUrl}/api/loads/exceptions/count?date=${date}` },
      { key: 'driverRisk', url: `${driversUrl}/api/drivers/risk/top?limit=1` },
      { key: 'vehicleRisk', url: `${vehiclesUrl}/api/vehicles/risk/top?limit=1` }
    ];

    const settled = await Promise.allSettled(
      targets.map((t) => fetchWithTimeout(t.url, opts, fetcher, upstreamTimeoutMs))
    );

    const fleetState = {};
    const upstreamErrors = [];
    settled.forEach((result, idx) => {
      const { key } = targets[idx];
      if (result.status === 'fulfilled') {
        fleetState[key] = result.value;
      } else {
        fleetState[key] = null;
        upstreamErrors.push({ source: key, error: String(result.reason?.message || result.reason) });
      }
    });

    return { fleetState, upstreamErrors };
  }

  async function callAiService({ tenantId, date, fleetState, forceRefresh, authHeader }) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (authHeader) headers.Authorization = authHeader;

    const body = JSON.stringify({ tenantId, date, fleetState, forceRefresh: !!forceRefresh });
    return fetchWithTimeout(
      `${aiUrl}/api/ai/briefing/generate`,
      { method: 'POST', headers, body },
      fetcher,
      upstreamTimeoutMs * 2
    );
  }

  async function generate({ tenantId, authHeader, refresh, localDate }) {
    if (!tenantId) throw new Error('briefing-aggregator: tenantId is required');

    const date = localDate || todayUtcDate(now());
    const key = cacheKey(tenantId, date);

    if (refresh) invalidate(key);
    else {
      const cached = readCache(key);
      if (cached) return { ...cached, cached: true };
    }

    const { fleetState, upstreamErrors } = await fanOutFleetState({ authHeader, date });
    const aiResult = await callAiService({
      tenantId,
      date,
      fleetState,
      forceRefresh: !!refresh,
      authHeader
    });

    const payload = {
      tenantId,
      date,
      briefing: aiResult,
      upstreamErrors,
      cached: false
    };
    writeCache(key, payload);
    return payload;
  }

  return { generate, _cache: cache };
}

module.exports = { buildBriefingAggregator };
