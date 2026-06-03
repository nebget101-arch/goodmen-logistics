'use strict';

/**
 * FN-1679 (Story F — Public tracking page) — Public token-resolve read API.
 *
 * The single UNAUTHENTICATED endpoint behind the public tracking page:
 *
 *   GET /api/track/:token
 *
 * A shipper opens `/track/:token` without logging in. The frontend (FN-1678)
 * calls this endpoint with the raw 32-byte base64url token from the URL. We
 * SHA-256 hash the token (never trusting/looking up the raw value), resolve the
 * share link, and return a deliberately-narrow tracking payload assembled from
 * live telematics + load milestone data. Optional fields (driver name, vehicle
 * #, breadcrumb trail, route line) are gated behind the per-link `reveal_options`
 * the broker chose in Story E.
 *
 * The response shape is the contract defined by the frontend in
 * `frontend/src/app/public-track/public-track.models.ts` — an envelope
 * `{ success, data }` whose `data` is a `PublicTrackPayload` (camelCase,
 * `{ lat, lon }` points). Keep the two in lockstep.
 *
 * Security contract (intake + Story F AC):
 *   - Unknown token             → 404, generic body (no "does this load exist?" leak).
 *   - Expired / revoked token    → 410, generic body.
 *   - Valid + active token       → 200, reveal-filtered payload only.
 *   - Error bodies never echo load ids, tenant, addresses, or internals.
 *   - Each successful view writes a `load_share_link_views` audit row
 *     (ip_hash, user_agent_hash) — best-effort; auditing never fails the read.
 *
 * This router is mounted at `/api/track` WITHOUT auth/tenant middleware (see
 * logistics-service/server.js) and is allow-listed at the gateway so the
 * request reaches the service unauthenticated.
 */

const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const shareLinkService = require('../services/share-link-service');

// Raw token is 32 bytes base64url ⇒ 43 chars, but accept a tolerant band so a
// truncated/garbage token resolves to a clean 404 rather than a 500. Anything
// outside this shape can't be a real token, so we 404 before touching the DB.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;

// Cap the breadcrumb trail so the public payload stays small (Story F has a
// 200KB gzipped budget). Most-recent points within the lookback window.
const BREADCRUMB_LIMIT = 100;
const BREADCRUMB_LOOKBACK_HOURS = 24;

// Generic, leak-free error bodies. Identical phrasing regardless of the
// underlying reason within a status code. The frontend maps purely on the HTTP
// status (404 → not_found, 410 → gone), so these bodies are advisory only.
const NOT_FOUND = { success: false, error: 'Tracking link not found' };
const GONE = { success: false, error: 'This tracking link is no longer available' };

// Coarse public lifecycle, in timeline order. The internal load.status
// collapses into one of these (the only three the public page understands).
const ORDER = ['pickup', 'in_transit', 'delivered'];
const STATUS_LABEL = {
  pickup: 'Awaiting pickup',
  in_transit: 'In transit',
  delivered: 'Delivered'
};
const MILESTONE_LABEL = {
  pickup: 'Picked up',
  in_transit: 'In transit',
  delivered: 'Delivered'
};

/** Map internal load.status → coarse public status key (pickup/in_transit/delivered). */
function publicStatus(rawStatus) {
  const s = String(rawStatus || '').toUpperCase();
  if (['DELIVERED', 'COMPLETED'].includes(s)) return 'delivered';
  if (['PICKED_UP', 'EN_ROUTE', 'IN_TRANSIT'].includes(s)) return 'in_transit';
  // DRAFT / NEW / DISPATCHED / CANCELLED / TONU → still "awaiting pickup".
  return 'pickup';
}

/** ISO string or null — normalizes Date | string | null without throwing. */
function iso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "City, ST" from parts, or a text fallback, or null. */
function placeLabel(city, state, fallback) {
  const joined = [city, state].filter(Boolean).join(', ');
  return joined || fallback || null;
}

/** Numeric coord or null (zip_codes stores DECIMAL, returned as string by pg). */
function coord(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Best-effort client IP: trust the gateway's X-Forwarded-For (xfwd: true). */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

/** Latest GPS fix for the load's vehicle, as { lat, lon, ts } — or null. */
async function latestPosition(vehicleId) {
  if (!vehicleId) return null;
  const result = await query(
    `SELECT lat, lng, ts
       FROM vehicle_position_pings
      WHERE vehicle_id = $1
      ORDER BY ts DESC
      LIMIT 1`,
    [vehicleId]
  );
  const row = result.rows[0];
  if (!row || row.lat === null || row.lng === null) return null;
  return { lat: Number(row.lat), lon: Number(row.lng), ts: iso(row.ts) };
}

/** Recent breadcrumb trail (reveal-gated): [{ lat, lon, at }], oldest→newest. */
async function breadcrumbTrail(vehicleId) {
  if (!vehicleId) return [];
  const result = await query(
    `SELECT lat, lng, ts
       FROM vehicle_position_pings
      WHERE vehicle_id = $1
        AND ts >= now() - ($2 * interval '1 hour')
        AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY ts DESC
      LIMIT $3`,
    [vehicleId, BREADCRUMB_LOOKBACK_HOURS, BREADCRUMB_LIMIT]
  );
  return result.rows
    .map((r) => ({ lat: Number(r.lat), lon: Number(r.lng), at: iso(r.ts) }))
    .reverse();
}

/**
 * GET /:token — resolve a public tracking token to a reveal-filtered payload.
 */
router.get('/:token', async (req, res) => {
  const rawToken = req.params.token;

  // Shape-gate before hashing/DB: a malformed token can never match a real
  // hash, so respond 404 without a query (and without distinguishing why).
  if (!TOKEN_RE.test(rawToken || '')) {
    return res.status(404).json(NOT_FOUND);
  }

  try {
    const tokenHash = shareLinkService.hashToken(rawToken);

    // Resolve the share link + its load in one round-trip. token_hash is UNIQUE.
    const linkResult = await query(
      `SELECT sl.id            AS share_link_id,
              sl.expires_at,
              sl.revoked_at,
              sl.reveal_options,
              l.id             AS load_id,
              l.load_number,
              l.status,
              l.updated_at,
              l.pickup_date,
              l.delivery_date,
              l.pickup_location,
              l.delivery_location,
              l.completed_date,
              l.driver_position_city,
              l.driver_position_state,
              l.driver_id,
              l.truck_id,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), ''), l.driver_name)
                               AS driver_name,
              v.unit_number    AS vehicle_unit_number
         FROM load_share_links sl
         JOIN loads l   ON l.id = sl.load_id
         LEFT JOIN drivers d  ON d.id = l.driver_id
         LEFT JOIN vehicles v ON v.id = l.truck_id
        WHERE sl.token_hash = $1`,
      [tokenHash]
    );

    const link = linkResult.rows[0];
    if (!link) {
      return res.status(404).json(NOT_FOUND);
    }

    // Revoked or expired → 410 Gone (same body either way: no leak).
    const now = Date.now();
    const isRevoked = !!link.revoked_at;
    const isExpired =
      link.expires_at && new Date(link.expires_at).getTime() <= now;
    if (isRevoked || isExpired) {
      return res.status(410).json(GONE);
    }

    const reveal = shareLinkService.normalizeRevealOptions(link.reveal_options);

    // Stops (+ coords via zip_codes) feed the milestone timeline, the origin /
    // destination waypoints, and (when revealed) the planned route line.
    const stopsResult = await query(
      `SELECT s.stop_type, s.sequence, s.stop_date, s.city, s.state,
              z.latitude AS lat, z.longitude AS lng
         FROM load_stops s
         LEFT JOIN zip_codes z ON z.zip = s.zip
        WHERE s.load_id = $1
        ORDER BY s.sequence ASC, s.stop_type ASC`,
      [link.load_id]
    );
    const stops = stopsResult.rows;
    const pickupStop = stops.find((r) => r.stop_type === 'PICKUP');
    const deliveryStop = stops.find((r) => r.stop_type === 'DELIVERY');

    const position = await latestPosition(link.truck_id);
    const status = publicStatus(link.status);
    const curIdx = ORDER.indexOf(status);

    // last_updated = freshest of the live ping and the load row's own mtime;
    // always non-null (updated_at is NOT NULL on loads).
    const lastUpdatedAt =
      [iso(position?.ts), iso(link.updated_at)].filter(Boolean).sort().slice(-1)[0] ||
      iso(link.updated_at) ||
      new Date(now).toISOString();

    // Coarse "near City, ST" label for the in-transit milestone, from the
    // driver-position columns.
    const transitLabel = placeLabel(
      link.driver_position_city,
      link.driver_position_state,
      null
    );

    const milestoneMeta = {
      pickup: {
        timestamp: iso(pickupStop?.stop_date || link.pickup_date),
        location: placeLabel(pickupStop?.city, pickupStop?.state, link.pickup_location)
      },
      in_transit: { timestamp: null, location: transitLabel },
      delivered: {
        timestamp: iso(link.completed_date || deliveryStop?.stop_date),
        location: placeLabel(
          deliveryStop?.city,
          deliveryStop?.state,
          link.delivery_location
        )
      }
    };

    const milestones = ORDER.map((key, idx) => {
      let state;
      if (idx < curIdx) state = 'complete';
      else if (idx === curIdx) state = status === 'delivered' ? 'complete' : 'current';
      else state = 'upcoming';
      return {
        key,
        label: MILESTONE_LABEL[key],
        state,
        timestamp: milestoneMeta[key].timestamp,
        location: milestoneMeta[key].location
      };
    });

    function waypoint(stop, fallbackText) {
      const wp = { label: placeLabel(stop?.city, stop?.state, fallbackText) || '' };
      const lat = coord(stop?.lat);
      const lon = coord(stop?.lng);
      if (lat !== null && lon !== null) {
        wp.lat = lat;
        wp.lon = lon;
      }
      return wp;
    }

    const payload = {
      loadNumber: link.load_number || '',
      status,
      statusLabel: STATUS_LABEL[status],
      // ETA is not yet modeled (no telematics ETA source on dev). Contract
      // allows null until an ETA pipeline lands.
      eta: null,
      lastUpdatedAt,
      reveal,
      currentPosition: position ? { lat: position.lat, lon: position.lon } : null,
      origin: waypoint(pickupStop, link.pickup_location),
      destination: waypoint(deliveryStop, link.delivery_location),
      milestones
    };

    // ── Reveal-gated optional fields ─────────────────────────────────
    if (reveal.driverName) {
      payload.driverName = link.driver_name || null;
    }
    if (reveal.vehicleNumber) {
      payload.vehicleNumber = link.vehicle_unit_number || null;
    }
    if (reveal.routeLine) {
      // Planned route as [lat, lon] pairs, in stop order, coords only.
      payload.routeLine = stops
        .map((s) => [coord(s.lat), coord(s.lng)])
        .filter(([lat, lon]) => lat !== null && lon !== null);
    }
    if (reveal.breadcrumbs) {
      payload.breadcrumbs = await breadcrumbTrail(link.truck_id);
    }

    // Audit the view — best-effort, never fails the read.
    try {
      await shareLinkService.recordShareLinkView(link.share_link_id, {
        ip: clientIp(req),
        userAgent: req.headers['user-agent']
      });
    } catch (auditErr) {
      // eslint-disable-next-line no-console
      console.warn('[public-track] view audit failed:', auditErr.message);
    }

    // Discourage shared caches from serving one viewer's payload to another.
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: payload });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[public-track] resolve failed:', err.message);
    // Generic 500 — no internals in the body.
    return res
      .status(500)
      .json({ success: false, error: 'Unable to load tracking information' });
  }
});

module.exports = router;
