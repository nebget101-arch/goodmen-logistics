'use strict';

/**
 * FN-1167: server-to-server client for the ai-service narrative + anomalies
 * endpoints. Used by the branded PDF export to embed AI-generated content
 * without forcing the browser to make a second round-trip.
 *
 * Both helpers forward the caller's Bearer token (the ai-service handlers
 * verify locally if the gateway has not already attached `req.user`) and
 * return `null` on any failure — the PDF renderer treats absence as
 * "section omitted".
 */

const axios = require('axios');

const DEFAULT_AI_BASE = process.env.AI_SERVICE_URL || 'http://localhost:4100';
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_NARRATIVE_TIMEOUT_MS || 8000);

function pickBearer(req) {
  if (!req || !req.headers) return null;
  const raw = req.headers.authorization || req.headers.Authorization;
  if (typeof raw === 'string' && raw.startsWith('Bearer ')) return raw;
  return null;
}

async function postAi(req, path, body, { timeoutMs } = {}) {
  const baseUrl = DEFAULT_AI_BASE.replace(/\/$/, '');
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  const bearer = pickBearer(req);
  if (bearer) headers.Authorization = bearer;

  const res = await axios.post(url, body, {
    headers,
    timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
    validateStatus: () => true
  });
  return res;
}

async function fetchNarrative(req, reportKey, payload) {
  try {
    // FN-1173 added the `variant=long` query param to expand the narrative to
    // 5–8 sentences for the PDF; the on-screen panel keeps the short variant.
    const res = await postAi(req, `/api/ai/reports/${encodeURIComponent(reportKey)}/narrative?variant=long`, {
      cards: payload?.cards || [],
      data: payload?.data || [],
      filters: payload?.meta?.filters || payload?.filters || {},
      priorPeriod: payload?.priorPeriod || payload?.summary?.priorPeriod || {}
    });
    if (res.status !== 200 || !res.data || typeof res.data !== 'object') return null;
    const text = typeof res.data.narrative === 'string' ? res.data.narrative.trim() : '';
    return text || null;
  } catch (_err) {
    return null;
  }
}

async function fetchAnomalies(req, reportKey, payload) {
  try {
    const res = await postAi(req, `/api/ai/reports/${encodeURIComponent(reportKey)}/anomalies`, {
      data: payload?.data || [],
      filters: payload?.meta?.filters || payload?.filters || {},
      priorPeriod: payload?.priorPeriod || payload?.summary?.priorPeriod || {}
    });
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.anomalies)) return [];
    return res.data.anomalies;
  } catch (_err) {
    return [];
  }
}

module.exports = {
  fetchNarrative,
  fetchAnomalies,
  _internals: { pickBearer, DEFAULT_AI_BASE, DEFAULT_TIMEOUT_MS }
};
