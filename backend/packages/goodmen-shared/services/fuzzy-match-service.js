'use strict';

/**
 * Fuzzy-match service — deterministic name/identifier matching used by the
 * spreadsheet → loads import (FN-1590) and any future entity-resolution paths.
 *
 * Matching is layered (cheapest first):
 *   1. Exact identifier (MC#, DOT#, VIN, unit_number, email) — score 1.0
 *   2. Case-insensitive exact name match — score 0.99
 *   3. Token-set Levenshtein-based similarity over candidate rows — score [0..1]
 *
 * Callers apply their own threshold (e.g. `LOADS_IMPORT_AUTO_THRESHOLD`,
 * default 0.85). The service always returns the best candidate (or null) so
 * the caller can also surface "low confidence" matches for manual review.
 *
 * Pure SQL — no AI dependency.
 */

const { query } = require('../internal/db');

function normalizeName(value) {
  return (value == null ? '' : String(value))
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|llc|llp|corp|corporation|company|co|ltd|limited|trucking|transport|transportation|logistics|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIdentifier(value) {
  return (value == null ? '' : String(value)).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function similarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 0.99;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 0;
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * From a candidate list, return `{ candidate, score }` for the best match
 * by `similarity(query, candidate[key])`, or null if no candidate scores > 0.
 */
function findBestMatch(queryValue, candidates, key) {
  if (!queryValue || !Array.isArray(candidates) || candidates.length === 0) return null;
  let best = null;
  for (const candidate of candidates) {
    const score = similarity(queryValue, candidate[key]);
    if (best == null || score > best.score) best = { candidate, score };
  }
  return best && best.score > 0 ? best : null;
}

/**
 * Match a broker by (mc_number | dot_number | name).
 *
 * Brokers are global in this codebase (FN-205 made `brokers` tenant-agnostic),
 * so we don't filter by tenant. Returns `{ id, name, score, matchedOn }` or null.
 */
async function matchBroker({ name, mcNumber, dotNumber } = {}) {
  const mc = normalizeIdentifier(mcNumber);
  const dot = normalizeIdentifier(dotNumber);

  if (mc) {
    const result = await query(
      `SELECT id, COALESCE(legal_name, name) AS name
         FROM brokers
        WHERE regexp_replace(COALESCE(mc_number,''), '[^0-9]', '', 'g') = $1
        LIMIT 1`,
      [mc]
    );
    if (result.rows.length) {
      return { id: result.rows[0].id, name: result.rows[0].name, score: 1.0, matchedOn: 'mc_number' };
    }
  }

  if (dot) {
    const result = await query(
      `SELECT id, COALESCE(legal_name, name) AS name
         FROM brokers
        WHERE regexp_replace(COALESCE(dot_number,''), '[^0-9]', '', 'g') = $1
        LIMIT 1`,
      [dot]
    );
    if (result.rows.length) {
      return { id: result.rows[0].id, name: result.rows[0].name, score: 1.0, matchedOn: 'dot_number' };
    }
  }

  const trimmed = (name || '').toString().trim();
  if (!trimmed) return null;

  const exact = await query(
    `SELECT id, COALESCE(legal_name, name) AS name
       FROM brokers
      WHERE LOWER(COALESCE(legal_name, name)) = LOWER($1)
         OR LOWER(COALESCE(dba_name,'')) = LOWER($1)
      LIMIT 1`,
    [trimmed]
  );
  if (exact.rows.length) {
    return { id: exact.rows[0].id, name: exact.rows[0].name, score: 0.99, matchedOn: 'name_exact' };
  }

  const candidates = await query(
    `SELECT id, COALESCE(legal_name, name) AS name, COALESCE(dba_name,'') AS dba
       FROM brokers
      WHERE COALESCE(legal_name, name) ILIKE $1
         OR COALESCE(dba_name,'') ILIKE $1
      LIMIT 25`,
    [`%${trimmed.split(/\s+/)[0]}%`]
  );
  const best = findBestMatch(trimmed, candidates.rows, 'name');
  if (best) return { id: best.candidate.id, name: best.candidate.name, score: best.score, matchedOn: 'name_fuzzy' };
  return null;
}

/**
 * Match a driver by (email | name) within a tenant.
 * Returns `{ id, name, score, matchedOn }` or null.
 */
async function matchDriver({ tenantId, operatingEntityId, name, email } = {}) {
  if (!tenantId) return null;

  const cleanEmail = (email || '').toString().trim().toLowerCase();
  if (cleanEmail) {
    const result = await query(
      `SELECT id, (first_name || ' ' || last_name) AS name
         FROM drivers
        WHERE tenant_id = $1
          AND LOWER(email) = $2
          AND ($3::uuid IS NULL OR operating_entity_id = $3 OR operating_entity_id IS NULL)
        LIMIT 1`,
      [tenantId, cleanEmail, operatingEntityId || null]
    );
    if (result.rows.length) {
      return { id: result.rows[0].id, name: result.rows[0].name, score: 1.0, matchedOn: 'email' };
    }
  }

  const trimmed = (name || '').toString().trim();
  if (!trimmed) return null;

  const candidates = await query(
    `SELECT id, (first_name || ' ' || last_name) AS name
       FROM drivers
      WHERE tenant_id = $1
        AND ($2::uuid IS NULL OR operating_entity_id = $2 OR operating_entity_id IS NULL)
        AND (
          (first_name || ' ' || last_name) ILIKE $3
          OR (last_name || ' ' || first_name) ILIKE $3
        )
      LIMIT 25`,
    [tenantId, operatingEntityId || null, `%${trimmed.split(/\s+/)[0]}%`]
  );
  const best = findBestMatch(trimmed, candidates.rows, 'name');
  if (best) return { id: best.candidate.id, name: best.candidate.name, score: best.score, matchedOn: 'name_fuzzy' };
  return null;
}

/**
 * Match a vehicle by (unit_number | vin | license_plate) within a tenant.
 * `kind` filters by vehicle_type ('truck'|'trailer'); pass null/undefined to
 * search across both.
 * Returns `{ id, unit, score, matchedOn }` or null.
 */
async function matchVehicle({ tenantId, operatingEntityId, unit, vin, plate, kind } = {}) {
  if (!tenantId) return null;

  const cleanVin = normalizeIdentifier(vin);
  const cleanUnit = (unit || '').toString().trim();
  const cleanPlate = normalizeIdentifier(plate);

  if (cleanVin) {
    const result = await query(
      `SELECT id, unit_number AS unit
         FROM vehicles
        WHERE tenant_id = $1
          AND regexp_replace(COALESCE(vin,''), '[^A-Z0-9]', '', 'g') = UPPER($2)
          AND ($3::text IS NULL OR vehicle_type = $3)
          AND ($4::uuid IS NULL OR operating_entity_id = $4 OR operating_entity_id IS NULL)
        LIMIT 1`,
      [tenantId, cleanVin, kind || null, operatingEntityId || null]
    );
    if (result.rows.length) {
      return { id: result.rows[0].id, unit: result.rows[0].unit, score: 1.0, matchedOn: 'vin' };
    }
  }

  if (cleanUnit) {
    const result = await query(
      `SELECT id, unit_number AS unit
         FROM vehicles
        WHERE tenant_id = $1
          AND LOWER(unit_number) = LOWER($2)
          AND ($3::text IS NULL OR vehicle_type = $3)
          AND ($4::uuid IS NULL OR operating_entity_id = $4 OR operating_entity_id IS NULL)
        LIMIT 1`,
      [tenantId, cleanUnit, kind || null, operatingEntityId || null]
    );
    if (result.rows.length) {
      return { id: result.rows[0].id, unit: result.rows[0].unit, score: 1.0, matchedOn: 'unit_number' };
    }
  }

  if (cleanPlate) {
    const result = await query(
      `SELECT id, unit_number AS unit
         FROM vehicles
        WHERE tenant_id = $1
          AND regexp_replace(COALESCE(license_plate,''), '[^A-Z0-9]', '', 'g') = UPPER($2)
          AND ($3::text IS NULL OR vehicle_type = $3)
          AND ($4::uuid IS NULL OR operating_entity_id = $4 OR operating_entity_id IS NULL)
        LIMIT 1`,
      [tenantId, cleanPlate, kind || null, operatingEntityId || null]
    );
    if (result.rows.length) {
      return { id: result.rows[0].id, unit: result.rows[0].unit, score: 0.95, matchedOn: 'license_plate' };
    }
  }

  if (cleanUnit) {
    const candidates = await query(
      `SELECT id, unit_number AS unit
         FROM vehicles
        WHERE tenant_id = $1
          AND ($2::text IS NULL OR vehicle_type = $2)
          AND ($3::uuid IS NULL OR operating_entity_id = $3 OR operating_entity_id IS NULL)
          AND unit_number ILIKE $4
        LIMIT 25`,
      [tenantId, kind || null, operatingEntityId || null, `%${cleanUnit.split(/\s+/)[0]}%`]
    );
    const best = findBestMatch(cleanUnit, candidates.rows, 'unit');
    if (best) return { id: best.candidate.id, unit: best.candidate.unit, score: best.score, matchedOn: 'unit_fuzzy' };
  }

  return null;
}

module.exports = {
  normalizeName,
  normalizeIdentifier,
  levenshtein,
  similarity,
  findBestMatch,
  matchBroker,
  matchDriver,
  matchVehicle
};
