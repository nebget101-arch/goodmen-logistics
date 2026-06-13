'use strict';

/**
 * FN-1761 — Forward-geocode service (Story B — Address-search geofence creation).
 *
 * Server-side proxy to Nominatim / OpenStreetMap for the geofence address-search
 * box. A backend proxy is mandatory: the Nominatim usage policy forbids
 * unattributed direct browser calls and caps traffic at ~1 req/s, so we:
 *   • send a descriptive `User-Agent` (identifies the app + a contact),
 *   • cache results in-process with a short TTL keyed by the normalized query
 *     (so repeated keystrokes / re-searches don't hammer the upstream), and
 *   • read the base URL from `GEOCODER_BASE_URL` (defaults to public Nominatim)
 *     so self-hosted / proxied deployments can swap it without code changes.
 *
 * Returns the wire shape the FN-1762 frontend consumes:
 *   [{ label, lat, lng, type, address_id? }]
 * `address_id` is set when a result resolves to one of the tenant's saved
 * `locations` rows (so the created geofence can link `geofences.address_id`).
 */

const dbModule = require('../internal/db');
const dtLogger = require('../utils/logger');

const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org';
// Descriptive UA per the Nominatim usage policy (app name + version + contact).
const USER_AGENT = 'FleetNeuron/1.0 (ops@fleetneuron.ai)';
const CACHE_TTL_MS = 60 * 1000; // short-TTL: 60s is plenty to absorb ret/keystroke bursts
const MAX_CACHE_ENTRIES = 500; // bound memory; evict oldest on overflow
const DEFAULT_LIMIT = 5;

/** normalizedQuery -> { expiresAt: number, results: object[] } */
const cache = new Map();

function baseUrl() {
  return (process.env.GEOCODER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** Lowercased, whitespace-collapsed query — the cache key and match basis. */
function normalizeQuery(q) {
  return String(q || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Collapse a free-text address to a comparable token (lowercase, alnum + spaces). */
function normalizeAddress(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function now() {
  return Date.now();
}

/** Read a cached, non-expired result set for a normalized query, or null. */
function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }
  // Refresh LRU position so hot queries survive eviction.
  cache.delete(key);
  cache.set(key, entry);
  return entry.results;
}

function writeCache(key, results) {
  cache.set(key, { expiresAt: now() + CACHE_TTL_MS, results });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

/** Test/ops hook: drop all cached geocode results. */
function clearCache() {
  cache.clear();
}

/**
 * Default HTTP getter (Nominatim `/search`). Isolated so tests inject a stub and
 * never touch the network. Returns the raw Nominatim result array.
 */
async function nominatimSearch(q, limit) {
  const axios = require('axios'); // lazy: only the real geocode path needs the HTTP client
  const url = `${baseUrl()}/search`;
  const response = await axios.get(url, {
    params: { q, format: 'jsonv2', addressdetails: 1, limit },
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    timeout: 8000,
  });
  return Array.isArray(response.data) ? response.data : [];
}

/** Raw Nominatim row → wire result (no address_id yet). */
function toWireResult(row) {
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    label: row.display_name || '',
    lat,
    lng,
    type: row.type || row.category || null,
  };
}

/**
 * Best-effort: stamp `address_id` on each result that resolves to one of the
 * tenant's saved `locations`. The `locations` table stores a free-text `address`
 * (no lat/lng), so we match on text: a location matches when its normalized
 * address is a substring of the result's normalized label. Conservative (exact
 * containment, min length) to avoid false links; a miss simply leaves
 * `address_id` unset. Uses the raw `query` bridge so it degrades to "no match"
 * wherever `locations` is absent (and is trivially stubbed in tests).
 */
async function attachAddressIds(results, tenantId) {
  if (!tenantId || !results.length) return results;
  const runQuery = dbModule.query;
  if (typeof runQuery !== 'function') return results;

  let locations;
  try {
    const res = await runQuery(
      `SELECT id, address FROM locations
       WHERE tenant_id = $1 AND address IS NOT NULL AND btrim(address) <> ''`,
      [tenantId]
    );
    locations = (res && res.rows) || [];
  } catch (err) {
    // locations may not exist in every environment — treat as "no match".
    dtLogger.warn('geocode_location_match_skipped', { error: err.message });
    return results;
  }

  const indexed = locations
    .map((loc) => ({ id: loc.id, norm: normalizeAddress(loc.address) }))
    .filter((loc) => loc.norm.length >= 5);
  if (!indexed.length) return results;

  return results.map((result) => {
    const label = normalizeAddress(result.label);
    const match = indexed.find((loc) => label.includes(loc.norm));
    return match ? { ...result, address_id: match.id } : result;
  });
}

/**
 * Forward-geocode `q` to a ranked list of candidate places. Cache-first: a hit
 * within the TTL skips the upstream call entirely. `opts.context.tenantId`
 * enables `address_id` enrichment; `opts.search` overrides the HTTP getter
 * (tests). Returns [] for blank queries; throws only on an upstream HTTP error.
 */
async function geocode(q, opts = {}) {
  const normalized = normalizeQuery(q);
  if (!normalized) return { results: [], cached: false };

  const cached = readCache(normalized);
  if (cached) return { results: cached, cached: true };

  const search = opts.search || nominatimSearch;
  const limit = Number.isFinite(opts.limit) ? opts.limit : DEFAULT_LIMIT;
  const rawRows = await search(normalized, limit);

  const tenantId = opts.context && opts.context.tenantId;
  const mapped = (Array.isArray(rawRows) ? rawRows : [])
    .map(toWireResult)
    .filter(Boolean);
  const results = await attachAddressIds(mapped, tenantId);

  writeCache(normalized, results);
  return { results, cached: false };
}

module.exports = {
  geocode,
  clearCache,
  // exported for unit tests / reuse
  normalizeQuery,
  normalizeAddress,
  toWireResult,
  attachAddressIds,
  CACHE_TTL_MS,
};
