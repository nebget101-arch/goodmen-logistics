'use strict';

const db = require('../internal/db').knex;
const dtLogger = require('../utils/logger');

const CACHE_TTL_MS = 60 * 1000;
const POSITION_FRESHNESS_MS = 5 * 60 * 1000;

const matchCache = new Map();

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreVendor(distKm, capacity, radiusKm) {
  if (distKm > radiusKm) return null;
  const distScore = Math.max(0, 1 - distKm / radiusKm);
  const capScore = Math.min(1, capacity / 10);
  return distScore * 0.7 + capScore * 0.3;
}

async function findMatches({ incidentId, lat, lng, radiusKm = 50, requiredSkills = [], tenantId }) {
  const cached = incidentId ? matchCache.get(incidentId) : null;
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    dtLogger.info('vendor_match_cache_hit', { incident_id: incidentId });
    return cached.result;
  }

  const startMs = Date.now();
  const incLat = Number(lat);
  const incLng = Number(lng);
  const freshnessThreshold = new Date(Date.now() - POSITION_FRESHNESS_MS);

  const rows = await db('roadside_vendors as v')
    .join(
      db.raw(
        `(SELECT DISTINCT ON (vendor_id) vendor_id, lat, lng, recorded_at
           FROM vendor_positions
          WHERE recorded_at >= ?
          ORDER BY vendor_id, recorded_at DESC) p`,
        [freshnessThreshold]
      ),
      'p.vendor_id',
      'v.vendor_id'
    )
    .where('v.status', 'active')
    .where('v.capacity', '>', 0)
    .modify((qb) => {
      if (tenantId) {
        qb.where(function tenantScope() {
          this.where('v.tenant_id', tenantId).orWhereNull('v.tenant_id');
        });
      }
    })
    .select(
      'v.vendor_id',
      'v.name',
      'v.skills',
      'v.capacity',
      'p.lat as pos_lat',
      'p.lng as pos_lng',
      'p.recorded_at as pos_recorded_at'
    );

  const matches = [];
  for (const row of rows) {
    const vendorSkills = Array.isArray(row.skills) ? row.skills : JSON.parse(row.skills || '[]');
    if (requiredSkills.length > 0 && !requiredSkills.every((s) => vendorSkills.includes(s))) {
      continue;
    }

    const distKm = haversineKm(incLat, incLng, Number(row.pos_lat), Number(row.pos_lng));
    const score = scoreVendor(distKm, row.capacity, radiusKm);
    if (score === null) continue;

    matches.push({
      vendor_id: row.vendor_id,
      name: row.name,
      skills: vendorSkills,
      capacity: row.capacity,
      dist_km: Math.round(distKm * 10) / 10,
      score: Math.round(score * 1000) / 1000,
      position_age_s: Math.round((Date.now() - new Date(row.pos_recorded_at).getTime()) / 1000),
    });
  }

  matches.sort((a, b) => b.score - a.score);

  const latencyMs = Date.now() - startMs;
  dtLogger.info('vendor_match_completed', {
    incident_id: incidentId,
    candidate_count: rows.length,
    match_count: matches.length,
    latency_ms: latencyMs,
  });

  if (incidentId) {
    matchCache.set(incidentId, { ts: Date.now(), result: matches });
  }

  return matches;
}

function invalidateCache(incidentId) {
  matchCache.delete(incidentId);
  dtLogger.info('vendor_match_cache_invalidated', { incident_id: incidentId });
}

module.exports = { findMatches, invalidateCache };
