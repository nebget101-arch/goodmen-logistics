'use strict';

/**
 * FMCSA Carrier Lookup — FN-101
 *
 * Provides a server-side proxy for the FMCSA mobile API so the Angular
 * frontend never exposes the FMCSA API key to the browser.
 *
 * Route: GET /api/fmcsa/lookup/:dotNumber
 *
 * Response shape (found):
 *   { found, dotNumber, legalName, dbaName, mcNumber, status,
 *     authorityType, phone, city, state, zip,
 *     safetyRating, oosPercent, totalDrivers, totalTrucks }
 *
 * Response shape (not found):   { found: false }  — 404
 * Response shape (unavailable): { found: false, error: 'lookup_unavailable' } — 503
 */

const express = require('express');
const axios = require('axios');
const authMiddleware = require('../middleware/auth-middleware');

const router = express.Router();

// ─── Validation ────────────────────────────────────────────────────────────
/** DOT number must be 1–8 digits (no letters, no leading "DOT-", etc.) */
const DOT_RE = /^\d{1,8}$/;

// ─── In-memory cache ────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * @type {Map<string, { result: object, expiresAt: number }>}
 */
const cache = new Map();

function getCached(dotNumber) {
  const entry = cache.get(dotNumber);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(dotNumber);
    return null;
  }
  return entry.result;
}

function setCache(dotNumber, result) {
  cache.set(dotNumber, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Periodically evict expired entries so the Map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) cache.delete(key);
  }
}, CACHE_TTL_MS).unref();

// ─── FMCSA response normalizer ──────────────────────────────────────────────

/**
 * Extract and normalise the carrier object returned by the FMCSA mobile API
 * into a clean, stable shape for the frontend.
 *
 * The FMCSA API response wraps the carrier under `content.carrier` but some
 * endpoints hoist it to the root, so we check both paths.
 *
 * @param {object} carrier  Raw carrier object from FMCSA
 * @returns {object}        Normalised carrier data
 */
function normalizeCarrier(carrier) {
  // MC / docket number — present as `docketNumber` on some endpoints,
  // nested inside `carrierAuthority`, or occasionally as `mcNumber`.
  const mcRaw =
    carrier.docketNumber ||
    carrier.carrierAuthority?.docketNumber ||
    carrier.mcNumber ||
    null;
  const mcNumber = mcRaw
    ? String(mcRaw).replace(/[^\d]/g, '') || null
    : null;

  // Carrier active status is expressed in several ways across FMCSA API versions.
  const isActive =
    carrier.statusCode === 'A' ||
    (typeof carrier.allowedToOperate === 'string' &&
      carrier.allowedToOperate.toUpperCase() === 'Y') ||
    (typeof carrier.operatingStatus === 'string' &&
      carrier.operatingStatus.toUpperCase().includes('AUTHORIZED'));

  const status = isActive ? 'ACTIVE' : 'INACTIVE';

  // OOS rate — field name varies by endpoint version.
  const oosRaw =
    carrier.oosRate ??
    carrier.vehicleOosRate ??
    carrier.driverOosRate ??
    null;
  const oosPercent = typeof oosRaw === 'number' ? oosRaw : null;

  return {
    found: true,
    dotNumber: String(carrier.dotNumber || ''),
    legalName: carrier.legalName || carrier.name || '',
    dbaName: carrier.dbaName || carrier.dbName || '',
    mcNumber,
    status,
    authorityType:
      carrier.carrierOperation?.carrierOperationDesc ||
      carrier.operationType ||
      'CARRIER',
    phone: String(carrier.telephone || carrier.phone || '').replace(/\D/g, ''),
    city: carrier.phyCity || carrier.city || '',
    state: carrier.phyState || carrier.state || '',
    zip: carrier.phyZip || carrier.zipCode || carrier.zip || '',
    safetyRating: carrier.safetyRating || carrier.ratingDesc || 'Unrated',
    oosPercent,
    totalDrivers: carrier.totalDrivers ?? null,
    totalTrucks: carrier.totalPowerUnits ?? carrier.totalTrucks ?? null,
  };
}

// ─── Route ──────────────────────────────────────────────────────────────────

/**
 * Run a middleware inline (returns a promise that resolves when next() is called).
 * If the middleware calls res.end before next(), the promise resolves with false.
 */
function runMiddleware(req, res, fn) {
  return new Promise((resolve) => {
    fn(req, res, () => resolve(true));
  });
}

/**
 * @openapi
 * /api/fmcsa/lookup/{dotNumber}:
 *   get:
 *     summary: Look up an FMCSA carrier by USDOT number
 *     description: |
 *       Server-side proxy for the FMCSA mobile API. Results are cached for
 *       one hour. No authentication required for normal lookups.
 *       Pass ?force=true (requires admin JWT) to bypass the cache.
 *     tags:
 *       - FMCSA
 *     parameters:
 *       - in: path
 *         name: dotNumber
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^\d{1,8}$'
 *         description: USDOT number (1–8 digits)
 *       - in: query
 *         name: force
 *         schema: { type: string, enum: [true] }
 *         description: Bypass cache and fetch live data (requires admin JWT)
 *     responses:
 *       200:
 *         description: Carrier found
 *       400:
 *         description: Invalid DOT number format
 *       401:
 *         description: force=true requires authentication
 *       404:
 *         description: DOT number not found in FMCSA database
 *       503:
 *         description: FMCSA API unavailable
 */
router.get('/lookup/:dotNumber', async (req, res) => {
  const { dotNumber } = req.params;
  const forceRefresh = String(req.query.force || '').toLowerCase() === 'true';

  // ── 1. Validate format ──────────────────────────────────────────────────
  if (!DOT_RE.test(dotNumber)) {
    return res.status(400).json({
      error: 'invalid_dot',
      message: 'DOT number must be 1–8 digits (digits only).',
    });
  }

  // ── 2. Force-refresh requires admin authentication ──────────────────────
  if (forceRefresh) {
    const authed = await runMiddleware(req, res, authMiddleware);
    if (!authed || !req.user) {
      // authMiddleware already sent a 401 response if it rejected.
      if (!res.headersSent) {
        return res.status(401).json({ error: 'Authentication required for force-refresh' });
      }
      return;
    }
    // Evict cached entry so the API call below fetches fresh data.
    cache.delete(dotNumber);
    // eslint-disable-next-line no-console
    console.log(`[fmcsa] force-refresh for DOT ${dotNumber} by user ${req.user.id || req.user.username}`);
  }

  // ── 3. Cache hit (skipped when force=true because we deleted the entry) ─
  const cached = getCached(dotNumber);
  if (cached) {
    // eslint-disable-next-line no-console
    console.log(`[fmcsa] cache hit for DOT ${dotNumber}`);
    return res.json(cached);
  }

  // ── 4. Ensure API key is configured ────────────────────────────────────
  const apiKey = process.env.FMCSA_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.error('[fmcsa] FMCSA_API_KEY is not configured — cannot proxy lookup');
    return res.status(503).json({ found: false, error: 'lookup_unavailable' });
  }

  // ── 5. Call FMCSA mobile API ────────────────────────────────────────────
  try {
    // eslint-disable-next-line no-console
    console.log(`[fmcsa] fetching DOT ${dotNumber} from FMCSA upstream`);

    const upstreamUrl = `https://mobile.fmcsa.dot.gov/qc/services/carriers/${encodeURIComponent(dotNumber)}`;
    const response = await axios.get(upstreamUrl, {
      params: { webKey: apiKey },
      timeout: 8000,
    });

    // The FMCSA mobile API wraps the carrier under `content.carrier`.
    const carrier =
      response.data?.content?.carrier ||
      response.data?.carrier ||
      response.data;

    if (!carrier || !carrier.dotNumber) {
      // API returned 200 but no carrier data — treat as not found.
      const notFound = { found: false };
      setCache(dotNumber, notFound);
      return res.status(404).json(notFound);
    }

    const result = normalizeCarrier(carrier);
    setCache(dotNumber, result);
    return res.json(result);

  } catch (err) {
    const upstreamStatus = err.response?.status;

    if (upstreamStatus === 404) {
      const notFound = { found: false };
      setCache(dotNumber, notFound);
      return res.status(404).json(notFound);
    }

    // Do NOT leak the API key or raw upstream error to the client.
    // eslint-disable-next-line no-console
    console.error('[fmcsa] upstream error for DOT', dotNumber, '—', err.message);
    return res.status(503).json({ found: false, error: 'lookup_unavailable' });
  }
});

module.exports = router;
