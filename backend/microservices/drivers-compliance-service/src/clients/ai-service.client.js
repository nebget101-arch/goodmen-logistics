'use strict';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:4100';
const TRIAGE_TIMEOUT_MS = parseInt(process.env.AI_TRIAGE_TIMEOUT_MS || '20000', 10);

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call ai-service triage endpoint.
 *
 * Contract (Story 1.1 / FN-1184):
 *   POST /api/ai/triage
 *   Body: { tenantId, incidentId, context }
 *   Response: { severity, category, urgency, vendor_skills, rationale,
 *               prompt_version, model_name, cache_read_tokens, cache_creation_tokens }
 */
async function requestTriage({ tenantId, incidentId, context, authHeader }) {
  const url = `${AI_SERVICE_URL}/api/ai/triage`;
  const body = JSON.stringify({ tenantId, incidentId, context });
  const headers = {
    'Content-Type': 'application/json',
    Authorization: authHeader,
  };

  const res = await fetchWithTimeout(url, { method: 'POST', headers, body }, TRIAGE_TIMEOUT_MS);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI service triage failed [${res.status}]: ${text}`);
  }
  return res.json();
}

module.exports = { requestTriage };
