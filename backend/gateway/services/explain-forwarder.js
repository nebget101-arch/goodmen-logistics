'use strict';

/**
 * FN-1177: Forwarder for AI explainability tokens.
 *
 * Receives a token + tenantId from the gateway route and GETs the rationale
 * from ai-service `/api/ai/explain/:token`. The tenantId is appended as a
 * query parameter so ai-service can enforce tenant scoping (404 on mismatch
 * or expiry). Mirrors ask-forwarder's shape — fetcher is the test seam.
 */

const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url, options, fetcher, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { ...options, signal: controller.signal });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

function buildExplainForwarder(deps) {
  const {
    fetcher,
    aiUrl,
    upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS
  } = deps;

  if (!fetcher) throw new Error('explain-forwarder: fetcher is required');
  if (!aiUrl) throw new Error('explain-forwarder: aiUrl is required');

  async function forward({ tenantId, authHeader, token }) {
    if (!tenantId) throw new Error('explain-forwarder: tenantId is required');
    if (!token) throw new Error('explain-forwarder: token is required');

    const headers = { Accept: 'application/json' };
    if (authHeader) headers.Authorization = authHeader;

    const url =
      `${aiUrl}/api/ai/explain/${encodeURIComponent(token)}` +
      `?tenantId=${encodeURIComponent(tenantId)}`;

    return fetchWithTimeout(
      url,
      { method: 'GET', headers },
      fetcher,
      upstreamTimeoutMs
    );
  }

  return { forward };
}

module.exports = { buildExplainForwarder };
