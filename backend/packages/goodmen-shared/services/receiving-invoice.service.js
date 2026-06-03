'use strict';

/**
 * FN-1490: server-to-server client for the ai-service invoice extractor.
 *
 * Forwards the caller's Bearer token (the ai-service handler verifies it
 * locally if the gateway hasn't already attached `req.user`) and returns
 * the normalized extraction payload, or `null` when the upstream call
 * fails. Callers must treat absence as "save the file but skip extraction"
 * — the file URL has already been persisted by the time we call here.
 *
 * The handler at `ai-service/src/handlers/invoice-extractor-handler.js`
 * accepts either { fileUrl } or { base64, contentType }. We always pass
 * a short-lived signed URL because the AI service runs in a separate
 * Render service that doesn't share R2 credentials.
 */

const axios = require('axios');

const DEFAULT_AI_BASE = (process.env.AI_SERVICE_URL || 'http://localhost:4100').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_INVOICE_EXTRACT_TIMEOUT_MS || 45000);

function pickBearer(req) {
  if (!req || !req.headers) return null;
  const raw = req.headers.authorization || req.headers.Authorization;
  if (typeof raw === 'string' && raw.startsWith('Bearer ')) return raw;
  return null;
}

async function extractInvoiceViaAi(req, { fileUrl, contentType }, { timeoutMs, baseUrl } = {}) {
  if (!fileUrl) return { ok: false, error: 'missing_file_url', data: null };

  const url = `${(baseUrl || DEFAULT_AI_BASE).replace(/\/$/, '')}/api/ai/invoice/extract`;
  const headers = { 'Content-Type': 'application/json' };
  const bearer = pickBearer(req);
  if (bearer) headers.Authorization = bearer;

  try {
    const response = await axios.post(
      url,
      { fileUrl, contentType: contentType || null },
      { headers, timeout: timeoutMs || DEFAULT_TIMEOUT_MS, validateStatus: () => true }
    );

    if (response.status !== 200 || !response.data || response.data.success !== true) {
      return {
        ok: false,
        error: response.data?.code || `HTTP_${response.status}`,
        data: null,
        meta: response.data?.meta || null
      };
    }

    return {
      ok: true,
      error: null,
      data: response.data.data || null,
      meta: response.data.meta || null
    };
  } catch (err) {
    return {
      ok: false,
      error: err.code === 'ECONNABORTED' ? 'AI_TIMEOUT' : 'AI_UPSTREAM_ERROR',
      data: null,
      meta: null
    };
  }
}

module.exports = {
  extractInvoiceViaAi,
  _internals: { pickBearer, DEFAULT_AI_BASE, DEFAULT_TIMEOUT_MS }
};
