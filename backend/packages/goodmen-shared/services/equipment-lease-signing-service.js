'use strict';

/**
 * FN-1800 (story FN-1789): Equipment / Motor-Carrier Lease Agreement adapter.
 *
 * A thin linkage layer on top of the generic e-signature engine (FN-1797
 * signature-service + FN-1796 schema). It does NOT re-implement any signing
 * logic — it delegates the whole "fill → send → sign → signed PDF" lifecycle to
 * signature-service and only records which equipment subject (a fleet vehicle or
 * an equipment-owner / lessor payee) a given signature request was started for.
 *
 *   - createEquipmentLeaseSigning — start a lease signing for a subject by
 *     delegating to signatureService.createSignatureRequest, then persist the
 *     `equipment_lease_signings` linkage row.
 *   - listEquipmentLeaseSignings — list a subject's lease signings, enriched
 *     with live status + signed-PDF URL from signatureService.getRequestById,
 *     lazily backfilling the signed-PDF key onto the linkage once signed.
 *
 * Heavy deps (knex pool, signature-service → R2/pdf/messaging) are lazy-required
 * so the pure helpers below — and their unit tests — load without a configured
 * DB / storage / messaging stack.
 */

const dtLogger = require('../utils/logger');

function getKnex() {
  return require('../config/knex');
}
function getSignatureService() {
  return require('./signature-service');
}

const LINKS_TABLE = 'equipment_lease_signings';

/** Equipment subjects a lease can be sent for. */
const SUBJECT_TYPES = ['vehicle', 'equipment_owner'];
const DEFAULT_DOCUMENT_TYPE = 'lease_agreement';

// ---------------------------------------------------------------------------
// Pure helpers (no DB / network — unit-tested)
// ---------------------------------------------------------------------------

function normalizeSubjectType(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  return SUBJECT_TYPES.includes(s) ? s : null;
}

function trimToNull(value, maxLen = 500) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** Map a DB linkage row to a camelCase DTO. */
function mapLinkRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    operatingEntityId: row.operating_entity_id || null,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    signatureRequestId: row.signature_request_id,
    documentType: row.document_type,
    signedPdfStorageKey: row.signed_pdf_storage_key || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Validate the inputs for starting a lease signing. Throws a coded Error
 * (`err.code` + `err.statusCode`) so the route can map to a clean 400.
 * Returns the normalized `{ subjectType, subjectId, templateId }`.
 */
function validateCreateInput({ subjectType, subjectId, templateId, signer } = {}) {
  const normalizedSubjectType = normalizeSubjectType(subjectType);
  if (!normalizedSubjectType) {
    const err = new Error(`subjectType must be one of: ${SUBJECT_TYPES.join(', ')}`);
    err.code = 'INVALID_SUBJECT_TYPE';
    err.statusCode = 400;
    throw err;
  }
  const normalizedSubjectId = trimToNull(subjectId, 100);
  if (!normalizedSubjectId) {
    const err = new Error('subjectId is required');
    err.code = 'INVALID_SUBJECT_ID';
    err.statusCode = 400;
    throw err;
  }
  const normalizedTemplateId = trimToNull(templateId, 100);
  if (!normalizedTemplateId) {
    const err = new Error('templateId is required');
    err.code = 'INVALID_TEMPLATE_ID';
    err.statusCode = 400;
    throw err;
  }
  const s = signer || {};
  if (!s.email && !s.phone) {
    const err = new Error('A signer email or phone is required to send the link');
    err.code = 'INVALID_SIGNER';
    err.statusCode = 400;
    throw err;
  }
  return { subjectType: normalizedSubjectType, subjectId: normalizedSubjectId, templateId: normalizedTemplateId };
}

/**
 * Combine a linkage DTO with the live signature request into the response shape
 * the equipment record renders. Also decides whether the signed-PDF key needs
 * to be backfilled onto the linkage row (request signed, key present, linkage
 * not yet caught up).
 *
 * @returns {{ dto: object, backfillKey: string|null }}
 */
function mergeRequestIntoLink(linkDto, request) {
  const req = request || null;
  const signedKey = req && req.signedPdfStorageKey ? req.signedPdfStorageKey : null;
  const backfillKey = signedKey && signedKey !== linkDto.signedPdfStorageKey ? signedKey : null;

  const dto = {
    id: linkDto.id,
    subjectType: linkDto.subjectType,
    subjectId: linkDto.subjectId,
    signatureRequestId: linkDto.signatureRequestId,
    documentType: linkDto.documentType,
    createdAt: linkDto.createdAt,
    request: req
      ? {
        id: req.id,
        status: req.status,
        signerName: req.signerName || null,
        signerEmail: req.signerEmail || null,
        signerRole: req.signerRole || null,
        sentAt: req.sentAt || null,
        viewedAt: req.viewedAt || null,
        signedAt: req.signedAt || null,
        expiresAt: req.expiresAt || null,
        signedPdfUrl: req.signedPdfUrl || null
      }
      : null
  };
  return { dto, backfillKey };
}

// ---------------------------------------------------------------------------
// Persistence / orchestration
// ---------------------------------------------------------------------------

/**
 * Start an equipment-lease signing for a subject. Delegates the full signing
 * lifecycle to signature-service (fill internal fields, mint tokenized link,
 * send it), then records the equipment linkage row. Returns the engine result
 * plus the persisted linkage DTO.
 */
async function createEquipmentLeaseSigning({
  tenantId,
  operatingEntityId = null,
  subjectType,
  subjectId,
  templateId,
  fieldValues = {},
  signer = {},
  expiresInDays,
  baseUrl,
  createdBy = null,
  db = getKnex(),
  signatureService = getSignatureService()
}) {
  if (!tenantId) throw new Error('equipment-lease-signing-service: tenantId is required');
  const normalized = validateCreateInput({ subjectType, subjectId, templateId, signer });

  // Delegate the entire signing flow to the generic engine — no duplicate logic.
  const result = await signatureService.createSignatureRequest({
    templateId: normalized.templateId,
    tenantId,
    operatingEntityId,
    fieldValues,
    signer,
    expiresInDays,
    baseUrl,
    createdBy,
    db
  });

  // Record the equipment-domain linkage.
  const [row] = await db(LINKS_TABLE)
    .insert({
      tenant_id: tenantId,
      operating_entity_id: operatingEntityId,
      subject_type: normalized.subjectType,
      subject_id: normalized.subjectId,
      signature_request_id: result.requestId,
      document_type: DEFAULT_DOCUMENT_TYPE,
      created_by: createdBy
    })
    .returning('*');

  return { ...result, link: mapLinkRow(row) };
}

/**
 * List a subject's lease signings (newest first), each enriched with the live
 * request status + signed-PDF download URL. Lazily backfills the signed-PDF key
 * onto the linkage row once the request has been signed.
 */
async function listEquipmentLeaseSignings({
  tenantId,
  subjectType,
  subjectId,
  db = getKnex(),
  signatureService = getSignatureService()
}) {
  if (!tenantId) throw new Error('equipment-lease-signing-service: tenantId is required');
  const normalizedSubjectType = normalizeSubjectType(subjectType);
  const normalizedSubjectId = trimToNull(subjectId, 100);
  if (!normalizedSubjectType || !normalizedSubjectId) {
    const err = new Error('subjectType and subjectId are required');
    err.code = 'INVALID_SUBJECT';
    err.statusCode = 400;
    throw err;
  }

  const rows = await db(LINKS_TABLE)
    .where({ tenant_id: tenantId, subject_type: normalizedSubjectType, subject_id: normalizedSubjectId })
    .orderBy('created_at', 'desc');

  const out = [];
  for (const row of rows) {
    const linkDto = mapLinkRow(row);
    let request = null;
    try {
      request = await signatureService.getRequestById({ id: linkDto.signatureRequestId, tenantId, db });
    } catch (err) {
      dtLogger.warn('equipment_lease_signing_request_load_failed', {
        linkId: linkDto.id,
        requestId: linkDto.signatureRequestId,
        message: err.message
      });
    }

    const { dto, backfillKey } = mergeRequestIntoLink(linkDto, request);
    if (backfillKey) {
      await db(LINKS_TABLE)
        .where({ id: linkDto.id, tenant_id: tenantId })
        .update({ signed_pdf_storage_key: backfillKey, updated_at: db.fn.now() })
        .catch((err) => {
          dtLogger.warn('equipment_lease_signing_backfill_failed', { linkId: linkDto.id, message: err.message });
        });
      dto.signedPdfStorageKey = backfillKey;
    }
    out.push(dto);
  }
  return out;
}

module.exports = {
  // orchestration / persistence
  createEquipmentLeaseSigning,
  listEquipmentLeaseSignings,
  // pure helpers (exported for unit tests + reuse)
  normalizeSubjectType,
  mapLinkRow,
  validateCreateInput,
  mergeRequestIntoLink,
  trimToNull,
  // constants
  SUBJECT_TYPES,
  DEFAULT_DOCUMENT_TYPE,
  LINKS_TABLE
};
