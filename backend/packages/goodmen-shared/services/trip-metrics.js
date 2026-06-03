'use strict';

/**
 * Trip-metrics calculation service.
 *
 * Centralises total / loaded / empty miles and rate-per-mile computation
 * so every consumer (loads, settlements, reporting) uses the same logic.
 *
 * The public API is intentionally *pure* — no database or network calls.
 * Callers resolve coordinates before invoking these functions so the
 * module stays testable without mocks.
 */

// ─── Haversine distance ────────────────────────────────────────────────────────

const EARTH_RADIUS_MILES = 3958.8;

/**
 * Convert degrees to radians.
 * @param {number} deg
 * @returns {number}
 */
function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine great-circle distance between two {lat, lon} points.
 * Returns distance in miles, or 0 when either point is invalid.
 *
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 * @returns {number} distance in miles (rounded to nearest integer)
 */
function haversineDistance(a, b) {
  if (!a || !b) return 0;
  const lat1 = Number(a.lat);
  const lon1 = Number(a.lon);
  const lat2 = Number(b.lat);
  const lon2 = Number(b.lon);
  if ([lat1, lon1, lat2, lon2].some((v) => !Number.isFinite(v))) return 0;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const h =
    sinHalfLat * sinHalfLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinHalfLon * sinHalfLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(EARTH_RADIUS_MILES * c);
}

// ─── Stop helpers ──────────────────────────────────────────────────────────────

/**
 * Normalise the stop_type / stopType field coming from either DB rows or
 * request bodies so comparisons are consistent.
 * @param {object} stop
 * @returns {string} 'PICKUP' | 'DELIVERY' | ''
 */
function stopType(stop) {
  return (stop?.stop_type || stop?.stopType || '').toString().trim().toUpperCase();
}

/**
 * Extract a usable {lat, lon} from a stop object.
 * Supports both snake_case (DB rows) and camelCase (request bodies).
 * Returns null when neither coordinate is present.
 *
 * @param {object} stop
 * @returns {{ lat: number, lon: number } | null}
 */
function coordsOf(stop) {
  if (!stop) return null;
  const lat = Number(stop.lat ?? stop.latitude);
  const lon = Number(stop.lon ?? stop.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

// ─── Core metric calculation ───────────────────────────────────────────────────

/**
 * Calculate trip metrics from an array of stops.
 *
 * @param {object[]} stops
 *   Each stop should contain at least:
 *     - stop_type | stopType  ('PICKUP' | 'DELIVERY')
 *     - sequence             (number, for ordering)
 *     - lat / latitude       (number, optional)
 *     - lon / longitude      (number, optional)
 *
 * @param {object}  [opts]
 * @param {number}  [opts.rate]             Load rate ($). Used to derive rate_per_mile.
 * @param {object}  [opts.prevDelivery]     Previous delivery location {lat, lon} for
 *                                          deadhead (empty-miles) calculation.  When
 *                                          omitted, empty miles are computed as the
 *                                          distance from the first stop to the first
 *                                          PICKUP only if the first stop is not a
 *                                          PICKUP (i.e. an intermediate deadhead).
 *                                          In practice, callers look up the driver's
 *                                          last delivery before calling this function.
 * @param {string}  [opts.prevDeliveryZip]  ZIP of previous delivery (pass-through for
 *                                          response enrichment; not used in distance calc).
 * @param {string}  [opts.prevDeliveryCity] City of previous delivery (pass-through).
 * @param {string}  [opts.prevDeliveryState] State of previous delivery (pass-through).
 *
 * @returns {{
 *   total_miles: number,
 *   loaded_miles: number,
 *   empty_miles: number,
 *   rate_per_mile: number | null,
 *   pickup_zip: string | null,
 *   delivery_zip: string | null,
 *   prev_zip: string | null,
 *   prev_delivery_city: string | null,
 *   prev_delivery_state: string | null
 * }}
 */
function calculateTripMetrics(stops, opts) {
  const result = {
    total_miles: 0,
    loaded_miles: 0,
    empty_miles: 0,
    rate_per_mile: null,
    pickup_zip: null,
    delivery_zip: null,
    prev_zip: opts?.prevDeliveryZip || null,
    prev_delivery_city: opts?.prevDeliveryCity || null,
    prev_delivery_state: opts?.prevDeliveryState || null
  };

  if (!Array.isArray(stops) || stops.length === 0) return result;

  // Sort by sequence (ascending) to guarantee order
  const sorted = [...stops].sort(
    (a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0)
  );

  // ── Identify key stops ─────────────────────────────────────────────────────
  const pickups = sorted.filter((s) => stopType(s) === 'PICKUP');
  const deliveries = sorted.filter((s) => stopType(s) === 'DELIVERY');
  const firstPickup = pickups[0] || null;
  const lastDelivery = deliveries.length ? deliveries[deliveries.length - 1] : null;

  result.pickup_zip = (firstPickup?.zip || '').toString().trim() || null;
  result.delivery_zip = (lastDelivery?.zip || '').toString().trim() || null;

  // ── Loaded miles (first PICKUP → last DELIVERY) ────────────────────────────
  if (firstPickup && lastDelivery) {
    const from = coordsOf(firstPickup);
    const to = coordsOf(lastDelivery);
    result.loaded_miles = haversineDistance(from, to);
  }

  // ── Empty miles (previous delivery → first PICKUP, i.e. deadhead) ──────────
  if (opts?.prevDelivery && firstPickup) {
    const prevCoords =
      typeof opts.prevDelivery === 'object' ? opts.prevDelivery : null;
    const pickupCoords = coordsOf(firstPickup);
    if (prevCoords && pickupCoords) {
      result.empty_miles = haversineDistance(prevCoords, pickupCoords);
    }
  }

  // ── Total miles ────────────────────────────────────────────────────────────
  result.total_miles = (result.empty_miles || 0) + (result.loaded_miles || 0);

  // ── Rate per mile ──────────────────────────────────────────────────────────
  const rateValue = opts?.rate != null ? Number(opts.rate) : null;
  if (rateValue != null && Number.isFinite(rateValue) && result.total_miles > 0) {
    result.rate_per_mile = Number((rateValue / result.total_miles).toFixed(2));
  }

  return result;
}

// ─── Convenience: sum consecutive-stop distances ────────────────────────────

/**
 * Sum driving distance across consecutive stops (regardless of type).
 * Useful when a full waypoint-by-waypoint total is desired instead of
 * the simple first-pickup → last-delivery shortcut.
 *
 * @param {object[]} stops  Ordered stop objects with lat/lon.
 * @returns {number}  Total miles.
 */
function sumConsecutiveDistances(stops) {
  if (!Array.isArray(stops) || stops.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    total += haversineDistance(coordsOf(stops[i - 1]), coordsOf(stops[i]));
  }
  return total;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  calculateTripMetrics,
  haversineDistance,
  sumConsecutiveDistances,
  // Internal helpers exported for unit-testing
  coordsOf,
  stopType,
  toRad
};
