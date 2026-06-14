'use strict';

/**
 * FN-1783 (story FN-1782): vehicle DOT-readiness rule engine.
 *
 * Single server-side source of truth for "which documents must a unit have,
 * uploaded and unexpired, before it may be made ACTIVE (in-service)". Keyed by
 * `vehicle_type`:
 *
 *   truck   → registration, insurance, inspection, ifta
 *   trailer → registration, inspection
 *
 * A requirement is SATISFIED when EITHER a `vehicle_documents` row of that type
 * has a today-or-future `expiry_date`, OR the matching vehicle column
 * (`registration_expiry` / `insurance_expiry` / `inspection_expiry`) is
 * today-or-future. `ifta` has no column today, so it is satisfied only by a
 * `vehicle_documents` row of type `ifta`.
 *
 * The pure functions here (rules + evaluator + guard) take plain data so they
 * are unit-testable without a database. The async helpers load the vehicle and
 * its documents through the shared DB bridge and delegate to the evaluator.
 */

const db = require('../internal/db');

const DOCUMENT_LABELS = {
  registration: 'Registration',
  insurance: 'Insurance',
  inspection: 'Annual DOT Inspection',
  ifta: 'IFTA License',
};

// Maps a requirement type to the `vehicles` column that can also satisfy it.
// `ifta` has no column today (FN-1782) — satisfied only by a document row.
const REQUIREMENT_COLUMNS = {
  registration: 'registration_expiry',
  insurance: 'insurance_expiry',
  inspection: 'inspection_expiry',
  ifta: null,
};

// Required-document ruleset, keyed by vehicle_type. Single source of truth.
const READINESS_RULES = {
  truck: ['registration', 'insurance', 'inspection', 'ifta'],
  trailer: ['registration', 'inspection'],
};

const DOCUMENT_STATES = { VALID: 'valid', MISSING: 'missing', EXPIRED: 'expired' };

const ACTIVATION_STATUSES = new Set(['in-service', 'active']);
const NOT_READY_CODE = 'VEHICLE_NOT_READY';
const NOT_READY_MESSAGE =
  'Vehicle cannot be set to in-service until all required DOT documents are present and unexpired';

/**
 * Normalize a vehicle_type to a rule key. Fleet vehicles default to 'truck'
 * (matching the column default and the all_vehicles COALESCE). Anything that is
 * not a known DOT-gated unit (e.g. 'customer_vehicle') falls through unchanged
 * and resolves to "no rules" — such units are never readiness-gated.
 */
function normalizeVehicleType(vehicleType) {
  const t = String(vehicleType || '').trim().toLowerCase();
  if (t === 'trailer') return 'trailer';
  if (t === '' || t === 'truck') return 'truck';
  return t;
}

function getRequiredDocumentTypes(vehicleType) {
  const rule = READINESS_RULES[normalizeVehicleType(vehicleType)];
  return rule ? [...rule] : [];
}

/**
 * Convert a date-ish value to a comparable day number (UTC midnight ms).
 * - 'YYYY-MM-DD...' strings use their literal calendar date (tz-independent).
 * - Date objects use their LOCAL calendar date — node-pg returns DATE columns
 *   as local-midnight Date objects, so this keeps DB values on the right day.
 */
function toDayNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? null
      : Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function toIsoDate(dayNumber) {
  if (dayNumber === null || dayNumber === undefined) return null;
  return new Date(dayNumber).toISOString().slice(0, 10);
}

/**
 * Does a vehicle_documents row count toward `type`? `document_type` is a free
 * string (FN-1782, no schema change), so we normalize separators and accept
 * common variants by substring match — e.g. 'annual_inspection',
 * 'dot-inspection', 'ifta_decal'.
 */
function documentMatchesType(doc, type) {
  const normalized = String(doc?.document_type || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) return false;
  return normalized === type || normalized.includes(type);
}

// Prefer a candidate that carries a documentId (so the UI can link to the file),
// then the latest expiry day (undated candidates sort last).
function pickCandidate(candidates) {
  return candidates.slice().sort((a, b) => {
    const aDoc = a.documentId ? 1 : 0;
    const bDoc = b.documentId ? 1 : 0;
    if (aDoc !== bDoc) return bDoc - aDoc;
    const aDay = a.day === null ? -Infinity : a.day;
    const bDay = b.day === null ? -Infinity : b.day;
    return bDay - aDay;
  })[0];
}

function evaluateRequirement(type, vehicle, documents, todayDay) {
  const label = DOCUMENT_LABELS[type] || type;

  // Candidates that can satisfy this requirement: matching document rows, plus
  // the vehicle column (when this requirement has one).
  const candidates = documents
    .filter((doc) => documentMatchesType(doc, type))
    .map((doc) => ({ documentId: doc.id ?? null, day: toDayNumber(doc.expiry_date) }));

  const column = REQUIREMENT_COLUMNS[type];
  if (column) {
    const columnDay = toDayNumber(vehicle?.[column]);
    if (columnDay !== null) candidates.push({ documentId: null, day: columnDay });
  }

  if (candidates.length === 0) {
    return { type, label, state: DOCUMENT_STATES.MISSING, expiryDate: null, documentId: null };
  }

  const valid = candidates.filter((c) => c.day !== null && c.day >= todayDay);
  if (valid.length > 0) {
    const best = pickCandidate(valid);
    return {
      type,
      label,
      state: DOCUMENT_STATES.VALID,
      expiryDate: toIsoDate(best.day),
      documentId: best.documentId,
    };
  }

  // A candidate exists but none is current → expired (needs renewal). This also
  // covers a present-but-undated document: there is no proof of validity, so the
  // unit stays gated until a current, dated document is provided.
  const best = pickCandidate(candidates);
  return {
    type,
    label,
    state: DOCUMENT_STATES.EXPIRED,
    expiryDate: toIsoDate(best.day),
    documentId: best.documentId,
  };
}

/**
 * Evaluate a vehicle's readiness from its row + documents.
 * @returns {{ vehicleType, ready, requiredDocuments, missing, expired }}
 */
function evaluateReadiness(vehicle, documents, now = new Date()) {
  const vehicleType = normalizeVehicleType(vehicle?.vehicle_type);
  const requiredTypes = getRequiredDocumentTypes(vehicleType);
  const docs = Array.isArray(documents) ? documents : [];
  const todayDay = toDayNumber(now);

  const requiredDocuments = requiredTypes.map((type) =>
    evaluateRequirement(type, vehicle, docs, todayDay)
  );

  const missing = requiredDocuments
    .filter((r) => r.state === DOCUMENT_STATES.MISSING)
    .map((r) => r.type);
  const expired = requiredDocuments
    .filter((r) => r.state === DOCUMENT_STATES.EXPIRED)
    .map((r) => r.type);
  const ready = requiredDocuments.every((r) => r.state === DOCUMENT_STATES.VALID);

  return { vehicleType, ready, requiredDocuments, missing, expired };
}

function isActivationStatus(status) {
  return ACTIVATION_STATUSES.has(String(status || '').trim().toLowerCase());
}

/**
 * Activation guard shared by POST and PUT. Returns null when activation is not
 * requested or the unit is ready; otherwise a 422 payload describing why.
 */
function evaluateActivationGuard(vehicle, documents, targetStatus, now = new Date()) {
  if (!isActivationStatus(targetStatus)) return null;
  const readiness = evaluateReadiness(vehicle, documents, now);
  if (readiness.ready) return null;
  return {
    message: NOT_READY_MESSAGE,
    code: NOT_READY_CODE,
    missing: readiness.missing,
    expired: readiness.expired,
  };
}

// --- DB-backed helpers (late-bound through the shared bridge) ----------------

async function loadReadinessInputs(vehicleId) {
  const vehicleResult = await db.query(
    `SELECT id, vehicle_type, status, registration_expiry, insurance_expiry, inspection_expiry
       FROM vehicles
      WHERE id = $1`,
    [vehicleId]
  );
  if (!vehicleResult?.rows?.length) return null;
  const documentsResult = await db.query(
    `SELECT id, document_type, expiry_date
       FROM vehicle_documents
      WHERE vehicle_id = $1`,
    [vehicleId]
  );
  return { vehicle: vehicleResult.rows[0], documents: documentsResult?.rows || [] };
}

/**
 * Load a fleet vehicle and compute the readiness contract for the endpoint.
 * Returns null when the vehicle id is not a fleet vehicle.
 */
async function getVehicleReadiness(vehicleId, now = new Date()) {
  const inputs = await loadReadinessInputs(vehicleId);
  if (!inputs) return null;
  const result = evaluateReadiness(inputs.vehicle, inputs.documents, now);
  return { vehicleId, ...result };
}

/**
 * Batch-derive a `ready` flag (+ missing/expired) for a list of vehicle rows
 * (e.g. the equipment list). Rows must carry id, vehicle_type and the *_expiry
 * columns. Document rows are loaded once for all ids; on any DB error the units
 * are evaluated from their columns alone rather than failing the list.
 */
async function deriveReadinessForRows(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = list.map((r) => r && r.id).filter(Boolean);
  const docsByVehicle = new Map();
  if (ids.length > 0) {
    try {
      const docsResult = await db.query(
        `SELECT vehicle_id, id, document_type, expiry_date
           FROM vehicle_documents
          WHERE vehicle_id = ANY($1)`,
        [ids]
      );
      for (const doc of docsResult?.rows || []) {
        if (!docsByVehicle.has(doc.vehicle_id)) docsByVehicle.set(doc.vehicle_id, []);
        docsByVehicle.get(doc.vehicle_id).push(doc);
      }
    } catch (err) {
      // Schema not fully migrated / table absent — fall back to column-only.
      if (typeof console !== 'undefined') {
        console.warn('[vehicle-readiness] document batch load skipped:', err?.message || err);
      }
    }
  }

  return list.map((row) => {
    const readiness = evaluateReadiness(row, docsByVehicle.get(row.id) || [], now);
    return {
      ...row,
      ready: readiness.ready,
      readiness: { missing: readiness.missing, expired: readiness.expired },
    };
  });
}

module.exports = {
  READINESS_RULES,
  DOCUMENT_LABELS,
  REQUIREMENT_COLUMNS,
  DOCUMENT_STATES,
  NOT_READY_CODE,
  normalizeVehicleType,
  getRequiredDocumentTypes,
  evaluateReadiness,
  isActivationStatus,
  evaluateActivationGuard,
  getVehicleReadiness,
  loadReadinessInputs,
  deriveReadinessForRows,
};
