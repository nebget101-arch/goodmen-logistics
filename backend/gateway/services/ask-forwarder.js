'use strict';

/**
 * FN-1148: Forwarder for Ask FleetNeuron prompts.
 *
 * Receives a validated prompt + briefing context from the gateway route and
 * POSTs them to ai-service `/api/ai/ask`. Kept tiny on purpose so the test
 * seam is the injected `fetcher` — no caching, no fan-out (the ai-service
 * owns that).
 */

const DEFAULT_UPSTREAM_TIMEOUT_MS = 20_000;

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

function buildAskForwarder(deps) {
  const {
    fetcher,
    aiUrl,
    upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS
  } = deps;

  if (!fetcher) throw new Error('ask-forwarder: fetcher is required');
  if (!aiUrl) throw new Error('ask-forwarder: aiUrl is required');

  async function forward({ tenantId, authHeader, prompt, briefingContext }) {
    if (!tenantId) throw new Error('ask-forwarder: tenantId is required');
    if (!prompt) throw new Error('ask-forwarder: prompt is required');

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (authHeader) headers.Authorization = authHeader;

    const body = JSON.stringify({
      tenantId,
      prompt,
      briefingContext: briefingContext || null
    });

    return fetchWithTimeout(
      `${aiUrl}/api/ai/ask`,
      { method: 'POST', headers, body },
      fetcher,
      upstreamTimeoutMs
    );
  }

  return { forward };
}

module.exports = { buildAskForwarder };
