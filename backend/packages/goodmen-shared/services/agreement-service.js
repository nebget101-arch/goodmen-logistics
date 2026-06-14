'use strict';

/**
 * FN-1793 (story FN-1787): Agreement template service.
 *
 * Owns the persistence + AI-orchestration logic behind routes/agreements.js:
 *   - upload an agreement source PDF/image to R2,
 *   - create an `agreement_templates` row,
 *   - invoke the ai-service field-detection handler and persist the detected
 *     field map into `agreement_template_fields`,
 *   - read back a template + ordered field map (with a signed download URL),
 *   - apply user edits to the field map (role flips, labels) and finalize.
 *
 * Hallucination guard (FN-1787 AC): the AI response is never trusted blindly.
 * `validateDetectionResult` re-validates every field's type/role enums, page
 * range, bbox shape and confidence before anything is persisted — invalid
 * fields are dropped, not stored.
 *
 * Built against the FN-1787 contract; persists into the FN-1792 schema. Until
 * the AI handler (FN-1791) deploys, set `AGREEMENTS_AI_DETECT_STUB=1` to
 * exercise the upload→persist→review flow with a deterministic stub.
 *
 * Schema (owned by FN-1792 — column names centralized below):
 *
 *   agreement_templates(
 *     id uuid pk, tenant_id uuid, operating_entity_id uuid null, name text,
 *     document_type text, source_storage_key text null, page_count int,
 *     status text ('draft'|'ready'), created_by uuid null,
 *     created_at timestamptz, updated_at timestamptz)
 *
 *   agreement_template_fields(
 *     id uuid pk, template_id uuid fk, field_key text, label text null,
 *     field_type text, page int, bbox jsonb null, role text,
 *     suggested_role text null, suggested_value text null,
 *     confidence numeric(5,4) null, sort_order int,
 *     created_at timestamptz, updated_at timestamptz)
 *
 * Note: `agreement_template_fields` has no tenant_id column — fields are
 * tenant-scoped transitively through their template, which we always verify
 * against the caller's tenant before touching fields.
 *
 * ---------------------------------------------------------------------------
 * Canonical bbox / coordinate convention (FN-1808 — shared with FN-1797)
 * ---------------------------------------------------------------------------
 * A field's placement is `{ page, bbox }`:
 *   - `page`  : 1-based page index, valid in [1, template.page_count].
 *   - `bbox`  : [x, y, width, height] in PDF points (1 pt = 1/72").
 *               Origin is the TOP-LEFT of the page; +x → right, +y → down.
 *               x ≥ 0, y ≥ 0, width > 0, height > 0.
 *
 * This top-left point space is exactly what the AI detector emits and what the
 * visual editor (FN-1807) draws in: the FE renders a page at scale `s`
 * (pixels-per-point) and maps a box to pixels as [x·s, y·s, w·s, h·s] from the
 * page's top-left. The signed-PDF overlay (FN-1797) consumes the SAME bbox and
 * converts to PDF native space (origin bottom-left) at fill time using the page
 * height H: pdfX = x, pdfY = H − y − height. Because both the editor and the
 * PDF overlay derive from this single convention, a box drawn in the editor
 * lands in the same place on the generated PDF. Full write-up:
 * docs/design/agreements-bbox-coordinates.md
 */

const dtLogger = require('../utils/logger');

// Heavy deps (knex pool, R2/aws-sdk client) are lazy-required so the pure
// validation/normalization helpers below — and their unit tests — can load
// this module without a configured DB or storage client present.
function getKnex() {
  return require('../config/knex');
}
function getSignedDownloadUrl(...args) {
  return require('../storage/r2-storage').getSignedDownloadUrl(...args);
}

const TEMPLATES_TABLE = 'agreement_templates';
const FIELDS_TABLE = 'agreement_template_fields';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:4100';
const AI_DETECT_PATH = '/api/ai/agreements/detect-fields';
const AI_TIMEOUT_MS = Number(process.env.AGREEMENTS_AI_TIMEOUT_MS) || 60_000;

/** Allowed field types — anything else from the AI is dropped. */
const FIELD_TYPES = ['text', 'date', 'number', 'checkbox', 'signature', 'initials'];
/** Allowed fill-roles. */
const ROLES = ['internal', 'signer'];
/** Allowed document types; unknown values normalize to 'generic'. */
const DOCUMENT_TYPES = ['lease_agreement', 'generic'];
/** Template status lifecycle (per FN-1792 schema). */
const TEMPLATE_STATUSES = ['draft', 'ready'];

/**
 * Confidence below which a field is flagged for mandatory user review.
 * The FE renders these prominently (FN-1787 AC: "low-confidence fields are
 * visually flagged").
 */
const LOW_CONFIDENCE_THRESHOLD = (() => {
  const raw = process.env.AGREEMENTS_LOW_CONFIDENCE_THRESHOLD;
  const parsed = raw == null ? NaN : Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  return 0.6;
})();

// ---------------------------------------------------------------------------
// Pure validation / normalization helpers (no DB, no network — unit-tested)
// ---------------------------------------------------------------------------

function isLowConfidence(confidence) {
  return typeof confidence === 'number' && confidence < LOW_CONFIDENCE_THRESHOLD;
}

/** Coerce an AI bbox into a [x, y, w, h] array of finite numbers, or null. */
function coerceBbox(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = raw.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

/**
 * Validate a user-supplied bbox against the canonical convention (see header):
 * a 4-number [x, y, w, h] with x ≥ 0, y ≥ 0, w > 0, h > 0. Returns the
 * normalized array, or null when the shape/bounds are invalid. Unlike
 * `coerceBbox` (which only checks shape, used for AI output we keep-but-null),
 * a geometry *edit* or *add* must carry a usable box, so a bad bbox is rejected.
 */
function validateBbox(raw) {
  const bbox = coerceBbox(raw);
  if (!bbox) return null;
  const [x, y, w, h] = bbox;
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
  return bbox;
}

/**
 * Validate a 1-based page index against the document's page count. Returns the
 * integer page, or null when it isn't a positive integer or exceeds
 * `pageCount` (when known). A pageCount of 0/unknown only enforces page ≥ 1.
 */
function validatePage(raw, pageCount) {
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) return null;
  if (Number.isInteger(pageCount) && pageCount > 0 && page > pageCount) return null;
  return page;
}

/** Coerce a confidence into [0, 1], or null when absent/invalid. */
function coerceConfidence(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Normalize a role to an allowed enum, falling back to `fallback`. */
function normalizeRole(raw, fallback = 'internal') {
  return ROLES.includes(raw) ? raw : fallback;
}

function normalizeDocumentType(raw) {
  return DOCUMENT_TYPES.includes(raw) ? raw : 'generic';
}

function trimToNull(value, maxLen = 500) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Validate + normalize a single AI-detected field against the contract.
 * Returns a clean field object, or null if it cannot be salvaged.
 *
 * A field is unsalvageable when it has no usable key/label, an unrecognized
 * type, or a page outside [1, pageCount]. Everything else is coerced.
 */
function validateDetectedField(raw, { pageCount } = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const fieldType = FIELD_TYPES.includes(raw.type) ? raw.type : null;
  if (!fieldType) return null;

  const key = trimToNull(raw.key, 200);
  const label = trimToNull(raw.label, 300) || key;
  if (!key && !label) return null;

  let page = Number(raw.page);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (Number.isInteger(pageCount) && pageCount > 0 && page > pageCount) {
    // Page references a sheet that doesn't exist → drop (likely hallucinated).
    return null;
  }

  const suggestedRole = normalizeRole(raw.suggestedRole, 'internal');
  const confidence = coerceConfidence(raw.confidence);

  return {
    fieldKey: key || label,
    label: label || key,
    fieldType,
    page,
    bbox: coerceBbox(raw.bbox),
    suggestedRole,
    // The user's confirmed role defaults to the AI suggestion until edited.
    role: suggestedRole,
    suggestedValue: trimToNull(raw.suggestedValue, 1000),
    confidence,
    lowConfidence: isLowConfidence(confidence)
  };
}

/**
 * Hallucination guard: validate the full AI detection payload, dropping any
 * fields that fail validation. Returns the normalized, persist-ready shape.
 */
function validateDetectionResult(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const pageCountNum = Number(payload.pageCount);
  const pageCount = Number.isInteger(pageCountNum) && pageCountNum > 0 ? pageCountNum : null;

  const rawFields = Array.isArray(payload.fields) ? payload.fields : [];
  const fields = [];
  let droppedCount = 0;

  for (const rawField of rawFields) {
    const field = validateDetectedField(rawField, { pageCount });
    if (field) {
      fields.push({ ...field, sortOrder: fields.length });
    } else {
      droppedCount += 1;
    }
  }

  return {
    documentType: normalizeDocumentType(payload.documentType),
    pageCount,
    fields,
    droppedCount
  };
}

/**
 * Sanitize a single user-supplied field patch (PATCH body). Mutable columns are
 * `role`, `label`, and — since FN-1808 (visual placement editor) — the geometry
 * `page` and `bbox`. AI/detection-owned columns (type, confidence,
 * suggestedRole, suggestedValue) stay immutable and are ignored. Returns the
 * subset of columns to update (bbox as a logical [x,y,w,h] array, not yet
 * JSON-stringified), or null when the patch is a no-op.
 *
 * Geometry is validated against the canonical convention: `page` must fall in
 * [1, pageCount] and `bbox` must be a well-formed non-negative box. An invalid
 * page/bbox is dropped from the patch rather than corrupting the field; passing
 * `bbox: null` explicitly clears the stored box.
 */
function sanitizeFieldUpdate(raw, { pageCount } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const update = {};

  if ('role' in raw && ROLES.includes(raw.role)) {
    update.role = raw.role;
  }
  if ('label' in raw) {
    const label = trimToNull(raw.label, 300);
    if (label) update.label = label;
  }
  if ('page' in raw) {
    const page = validatePage(raw.page, pageCount);
    if (page != null) update.page = page;
  }
  if ('bbox' in raw) {
    if (raw.bbox === null) {
      update.bbox = null;
    } else {
      const bbox = validateBbox(raw.bbox);
      if (bbox) update.bbox = bbox;
    }
  }

  return Object.keys(update).length ? update : null;
}

/**
 * Sanitize a user-drawn (manual) field to add to a template's field map.
 * Unlike a detected field, a manual field MUST carry a valid `fieldType`,
 * `page` (in [1, pageCount]) and `bbox` — the user drew a real box. Its
 * `confidence` is null (no AI involved) and `role` defaults to `internal`
 * unless a valid role is supplied. Returns a persist-ready DTO (matching the
 * shape `buildFieldRows` expects) or null when it can't be salvaged.
 */
function sanitizeNewField(raw, { pageCount } = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const fieldType = FIELD_TYPES.includes(raw.fieldType)
    ? raw.fieldType
    : FIELD_TYPES.includes(raw.type)
      ? raw.type
      : null;
  if (!fieldType) return null;

  const page = validatePage(raw.page, pageCount);
  if (page == null) return null;

  const bbox = validateBbox(raw.bbox);
  if (!bbox) return null;

  const key = trimToNull(raw.fieldKey ?? raw.key, 200);
  const label = trimToNull(raw.label, 300) || key;
  if (!key && !label) return null;

  const role = normalizeRole(raw.role, 'internal');

  return {
    fieldKey: key || label,
    label: label || key,
    fieldType,
    page,
    bbox,
    role,
    // A manually placed field has no AI suggestion; mirror the confirmed role.
    suggestedRole: role,
    suggestedValue: null,
    confidence: null,
    lowConfidence: false
  };
}

// ---------------------------------------------------------------------------
// Row <-> DTO mapping
// ---------------------------------------------------------------------------

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapTemplateRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    operatingEntityId: row.operating_entity_id || null,
    name: row.name,
    documentType: row.document_type,
    sourceStorageKey: row.source_storage_key,
    pageCount: row.page_count,
    status: row.status,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapFieldRow(row) {
  if (!row) return null;
  const confidence = row.confidence == null ? null : Number(row.confidence);
  return {
    id: row.id,
    templateId: row.template_id,
    sortOrder: row.sort_order,
    fieldKey: row.field_key,
    label: row.label,
    fieldType: row.field_type,
    page: row.page,
    bbox: parseJson(row.bbox, null),
    role: row.role,
    suggestedRole: row.suggested_role,
    suggestedValue: row.suggested_value,
    confidence,
    lowConfidence: isLowConfidence(confidence),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ---------------------------------------------------------------------------
// AI orchestration
// ---------------------------------------------------------------------------

function isAiStubEnabled() {
  return process.env.AGREEMENTS_AI_DETECT_STUB === '1';
}

/**
 * Deterministic stub detection result used until the AI handler (FN-1791)
 * lands. Shaped exactly like the FN-1787 contract so the validate→persist
 * path is exercised identically to the real handler.
 */
function stubDetectionResult() {
  return {
    documentType: 'generic',
    pageCount: 1,
    fields: [
      {
        key: 'party_name',
        label: 'Party Name',
        type: 'text',
        page: 1,
        bbox: [72, 120, 240, 24],
        suggestedRole: 'internal',
        suggestedValue: null,
        confidence: 0.88
      },
      {
        key: 'signer_signature',
        label: 'Signer Signature',
        type: 'signature',
        page: 1,
        bbox: [72, 400, 240, 48],
        suggestedRole: 'signer',
        suggestedValue: null,
        confidence: 0.93
      }
    ]
  };
}

/**
 * Call the ai-service detect-fields handler. Returns the raw (un-validated)
 * detection payload, or null on any failure (network/timeout/non-2xx). The
 * caller decides how to degrade — a failed detection still yields a usable
 * template the user can populate manually.
 *
 * `fetcher` is injectable for tests; defaults to global fetch (Node ≥ 18).
 */
async function callDetectFieldsAi({ fileUrl, base64, contentType, fetcher = globalThis.fetch }) {
  if (isAiStubEnabled()) {
    return stubDetectionResult();
  }

  const body = fileUrl ? { fileUrl } : { base64, contentType };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetcher(`${AI_SERVICE_URL}${AI_DETECT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok || res.status >= 500) {
      dtLogger.warn('agreements_detect_ai_unavailable', { status: res.status });
      return null;
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  } catch (err) {
    dtLogger.error('agreements_detect_ai_error', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Build the insert rows for a template's detected fields. */
function buildFieldRows(templateId, fields) {
  return fields.map((f, idx) => ({
    template_id: templateId,
    sort_order: typeof f.sortOrder === 'number' ? f.sortOrder : idx,
    field_key: f.fieldKey,
    label: f.label,
    field_type: f.fieldType,
    page: f.page,
    bbox: f.bbox == null ? null : JSON.stringify(f.bbox),
    role: f.role,
    suggested_role: f.suggestedRole,
    suggested_value: f.suggestedValue ?? null,
    confidence: f.confidence
  }));
}

/**
 * Create a template row for an already-uploaded source document.
 * The source bytes are expected to already live in R2 at `storageKey`.
 */
async function createTemplate({
  tenantId,
  operatingEntityId = null,
  name,
  storageKey,
  fileName,
  createdBy = null,
  db = getKnex()
}) {
  if (!tenantId) throw new Error('agreement-service: tenantId is required');
  if (!storageKey) throw new Error('agreement-service: storageKey is required');

  const [row] = await db(TEMPLATES_TABLE)
    .insert({
      tenant_id: tenantId,
      operating_entity_id: operatingEntityId,
      name: trimToNull(name, 300) || trimToNull(fileName, 300) || 'Untitled agreement',
      document_type: 'generic',
      source_storage_key: storageKey,
      page_count: 0,
      status: 'draft'
    })
    .returning('*');

  return mapTemplateRow(row);
}

/**
 * Replace a template's field map with `detection.fields`.
 * Runs in a transaction so a template never has a half-written field map.
 * The template stays `draft` until the user finalizes it (PATCH).
 */
async function persistDetectedFields({ templateId, tenantId, detection, db = getKnex() }) {
  const fields = detection?.fields || [];
  const pageCount = Number.isInteger(detection?.pageCount) ? detection.pageCount : 0;

  await db.transaction(async (trx) => {
    // Fields are scoped via template_id; the template itself is tenant-verified.
    await trx(FIELDS_TABLE).where({ template_id: templateId }).del();

    if (fields.length) {
      await trx(FIELDS_TABLE).insert(buildFieldRows(templateId, fields));
    }

    await trx(TEMPLATES_TABLE)
      .where({ id: templateId, tenant_id: tenantId })
      .update({
        document_type: normalizeDocumentType(detection?.documentType),
        page_count: pageCount,
        updated_at: db.fn.now()
      });
  });
}

/**
 * Full upload→detect→persist orchestration for a freshly created template.
 * Signs a short-lived download URL so the AI service can pull the source
 * from R2, validates the response, and persists the field map. On AI failure
 * the template keeps an empty field map (user fills it in) and stays `draft`.
 */
async function detectAndPersistFields({ template, fetcher, db = getKnex() }) {
  let detection = { documentType: 'generic', pageCount: 0, fields: [], droppedCount: 0 };

  try {
    const fileUrl = await getSignedDownloadUrl(template.sourceStorageKey);
    const rawDetection = await callDetectFieldsAi({ fileUrl, fetcher });
    if (rawDetection) {
      detection = validateDetectionResult(rawDetection);
      dtLogger.info('agreements_detect_complete', {
        templateId: template.id,
        detectedFieldCount: detection.fields.length,
        droppedCount: detection.droppedCount,
        lowConfidenceFieldCount: detection.fields.filter((f) => f.lowConfidence).length,
        stub: isAiStubEnabled()
      });
    } else {
      dtLogger.warn('agreements_detect_no_result', { templateId: template.id });
    }
  } catch (err) {
    dtLogger.error('agreements_detect_failed', err, { templateId: template.id });
  }

  await persistDetectedFields({
    templateId: template.id,
    tenantId: template.tenantId,
    detection,
    db
  });

  return detection;
}

/**
 * Read a template + its ordered field map. Tenant-scoped. Returns null when
 * the template doesn't exist or belongs to another tenant.
 * `withDownloadUrl` adds a signed URL for the source doc.
 */
async function getTemplateWithFields({
  templateId,
  tenantId,
  withDownloadUrl = true,
  db = getKnex()
}) {
  const templateRow = await db(TEMPLATES_TABLE)
    .where({ id: templateId, tenant_id: tenantId })
    .first();
  if (!templateRow) return null;

  const fieldRows = await db(FIELDS_TABLE)
    .where({ template_id: templateId })
    .orderBy('sort_order', 'asc')
    .orderBy('created_at', 'asc');

  const template = mapTemplateRow(templateRow);
  template.fields = fieldRows.map(mapFieldRow);

  if (withDownloadUrl && template.sourceStorageKey) {
    try {
      template.sourceDownloadUrl = await getSignedDownloadUrl(template.sourceStorageKey);
    } catch (err) {
      dtLogger.warn('agreements_sign_download_failed', { templateId, message: err.message });
      template.sourceDownloadUrl = null;
    }
  }

  return template;
}

/** List a tenant's templates (newest first), without field maps. */
async function listTemplates({ tenantId, db = getKnex() }) {
  const rows = await db(TEMPLATES_TABLE)
    .where({ tenant_id: tenantId })
    .orderBy('created_at', 'desc');
  return rows.map(mapTemplateRow);
}

/** Extract field ids from a `deletes` array of ids or `{ id }` objects. */
function normalizeDeleteIds(deletes) {
  return (Array.isArray(deletes) ? deletes : [])
    .map((d) => (d && typeof d === 'object' ? d.id : d))
    .filter((id) => id != null && id !== '');
}

/** Convert a sanitized field update into a DB row patch (jsonb bbox stringified). */
function fieldUpdateToRow(update) {
  const row = { ...update };
  if ('bbox' in row) {
    row.bbox = row.bbox == null ? null : JSON.stringify(row.bbox);
  }
  return row;
}

/**
 * Apply user edits to a template's field map and optionally finalize it.
 *
 * Three independent mutation sets, applied in a single transaction:
 *   - `updates`: `[{ id, role?, label?, page?, bbox? }]` — edit existing fields
 *     (geometry edits since FN-1808). Sort order is preserved.
 *   - `deletes`: `[fieldId | { id }]` — remove fields the user erased.
 *   - `adds`:    `[{ fieldType, page, bbox, label?, role?, fieldKey? }]` —
 *     user-drawn boxes appended after the current max `sort_order`.
 *
 * All three are tenant-scoped: the template is verified against the caller's
 * tenant up front, and every field write is additionally constrained by
 * `template_id`, so a tenant can only touch fields of its own template. Page +
 * bbox are validated against the template's `page_count`. When `finalize` is
 * true the template status advances to `ready`.
 *
 * Returns the refreshed template + field map, or null if the template doesn't
 * exist for this tenant.
 */
async function updateTemplateFields({
  templateId,
  tenantId,
  updates = [],
  adds = [],
  deletes = [],
  finalize = false,
  db = getKnex()
}) {
  const existing = await db(TEMPLATES_TABLE)
    .where({ id: templateId, tenant_id: tenantId })
    .first();
  if (!existing) return null;

  const pageCount = Number.isInteger(existing.page_count) ? existing.page_count : 0;

  await db.transaction(async (trx) => {
    // 1) Deletes first, so a delete + re-add of the same box can't collide.
    const deleteIds = normalizeDeleteIds(deletes);
    if (deleteIds.length) {
      await trx(FIELDS_TABLE)
        .where({ template_id: templateId })
        .whereIn('id', deleteIds)
        .del();
    }

    // 2) Edits to existing fields (role / label / page / bbox). sort_order is
    //    left untouched, so the field map keeps its order.
    for (const patch of Array.isArray(updates) ? updates : []) {
      const fieldId = patch?.id;
      if (!fieldId) continue;
      const update = sanitizeFieldUpdate(patch, { pageCount });
      if (!update) continue;

      // template_id scope ensures a tenant can only edit fields of its own
      // (already tenant-verified) template.
      await trx(FIELDS_TABLE)
        .where({ id: fieldId, template_id: templateId })
        .update({ ...fieldUpdateToRow(update), updated_at: trx.fn.now() });
    }

    // 3) Adds (user-drawn boxes) appended after the current max sort_order so
    //    they slot in at the end and existing positions are preserved.
    const newFields = (Array.isArray(adds) ? adds : [])
      .map((a) => sanitizeNewField(a, { pageCount }))
      .filter(Boolean);
    if (newFields.length) {
      const maxRow = await trx(FIELDS_TABLE)
        .where({ template_id: templateId })
        .max({ max: 'sort_order' })
        .first();
      const base = (maxRow && maxRow.max != null ? Number(maxRow.max) : -1) + 1;
      const ordered = newFields.map((f, i) => ({ ...f, sortOrder: base + i }));
      await trx(FIELDS_TABLE).insert(buildFieldRows(templateId, ordered));
    }

    await trx(TEMPLATES_TABLE)
      .where({ id: templateId, tenant_id: tenantId })
      .update({
        ...(finalize ? { status: 'ready' } : {}),
        updated_at: trx.fn.now()
      });
  });

  return getTemplateWithFields({ templateId, tenantId, db });
}

module.exports = {
  // orchestration / persistence
  createTemplate,
  detectAndPersistFields,
  persistDetectedFields,
  getTemplateWithFields,
  listTemplates,
  updateTemplateFields,
  callDetectFieldsAi,
  // pure helpers (exported for unit tests + reuse)
  validateDetectionResult,
  validateDetectedField,
  sanitizeFieldUpdate,
  sanitizeNewField,
  normalizeDeleteIds,
  fieldUpdateToRow,
  buildFieldRows,
  coerceBbox,
  validateBbox,
  validatePage,
  coerceConfidence,
  normalizeRole,
  normalizeDocumentType,
  isLowConfidence,
  mapTemplateRow,
  mapFieldRow,
  stubDetectionResult,
  // constants
  FIELD_TYPES,
  ROLES,
  DOCUMENT_TYPES,
  TEMPLATE_STATUSES,
  LOW_CONFIDENCE_THRESHOLD,
  AI_SERVICE_URL,
  TEMPLATES_TABLE,
  FIELDS_TABLE
};
