'use strict';

/**
 * FN-1797 (story FN-1788): E-signature request + signing orchestration.
 *
 * Sits on top of the FN-1796 schema (`signature_requests`,
 * `signature_request_fields`, `signatures`) and the FN-1792/FN-1793 agreement
 * templates. Owns the full "fill → send → sign → signed PDF" lifecycle:
 *
 *   - createSignatureRequest  — snapshot a template's field map, persist the
 *     internal-filled values, mint a tokenized signing link (token-service
 *     hashing/expiry, mirroring employer_investigation_tokens), send it via
 *     Twilio/SendGrid, and move the request to `sent`.
 *   - getRequestById          — internal status + signed-PDF download URL.
 *   - getSignerView           — token-gated read for the public signer page;
 *     internal values are read-only, signer-assigned fields are editable;
 *     flips the request to `viewed`.
 *   - submitSignature         — token-gated write: validate (unused/unexpired),
 *     persist signer field values, record a `signatures` row (name/IP/UA/
 *     timestamp + consent snapshot, reusing consent-service semantics),
 *     generate the signed PDF (overlay onto the source doc via pdf.service),
 *     store it in R2, and move the request to `signed`. Idempotent once signed.
 *
 * Heavy deps (knex pool, R2 client, pdf-lib, Twilio/SendGrid) are lazy-required
 * so the pure helpers below — and their unit tests — load without a configured
 * DB / storage / messaging stack.
 */

const dtLogger = require('../utils/logger');
const { generateToken, hashToken } = require('./token-service');

function getKnex() {
  return require('../config/knex');
}
function getR2() {
  return require('../storage/r2-storage');
}
function getPdf() {
  return require('./pdf.service');
}
function getNotifier() {
  return require('./notification-service');
}
function getAgreementService() {
  return require('./agreement-service');
}

const REQUESTS_TABLE = 'signature_requests';
const REQUEST_FIELDS_TABLE = 'signature_request_fields';
const SIGNATURES_TABLE = 'signatures';

/** Canonical request lifecycle. */
const STATUSES = ['draft', 'sent', 'viewed', 'signed', 'completed', 'expired', 'voided'];
/** Statuses past which a request can no longer be (re-)signed. */
const TERMINAL_STATUSES = ['signed', 'completed', 'expired', 'voided'];
/** Per-field fill roles (matches agreement_template_fields). */
const ROLES = ['internal', 'signer'];

const DEFAULT_EXPIRY_DAYS = (() => {
  const raw = Number(process.env.AGREEMENT_SIGN_EXPIRY_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 14;
})();

/**
 * Default in-house e-signature consent text, snapshotted onto every signature
 * (consent-service semantics: persist the exact legal text shown at signing).
 */
const DEFAULT_CONSENT_TEXT =
  process.env.AGREEMENT_SIGN_CONSENT_TEXT ||
  'By typing my name and submitting this form I agree that my electronic signature is the ' +
  'legal equivalent of my handwritten signature, and I consent to sign this agreement ' +
  'electronically. I understand my name, IP address, browser and the time of signing are ' +
  'recorded as part of the signature.';

// ---------------------------------------------------------------------------
// Signature-completion hooks
// ---------------------------------------------------------------------------

/**
 * Adapter modules (e.g. lease-to-own, FN-1803) register a handler here to react
 * when a request they own transitions to `signed`. Keeping the engine hook-based
 * — never importing an adapter — preserves "reuse the generic engine, no adapter
 * coupling in the engine". Handlers run in-process (all signing + adapter routes
 * are mounted in the same logistics-service) and are best-effort: a throwing
 * handler is logged and never fails the signature.
 */
const signedHooks = [];

/** Register a `(ctx) => Promise<void>` handler invoked after a request is signed. */
function onSigned(handler) {
  if (typeof handler === 'function') signedHooks.push(handler);
}

async function fireSignedHooks(ctx) {
  for (const handler of signedHooks) {
    try {
      await handler(ctx);
    } catch (err) {
      dtLogger.error('signature_signed_hook_failed', err, { requestId: ctx && ctx.requestId });
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (no DB / network — unit-tested)
// ---------------------------------------------------------------------------

function trimToNull(value, maxLen = 500) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeStatus(raw) {
  return STATUSES.includes(raw) ? raw : 'draft';
}

function normalizeRole(raw, fallback = 'signer') {
  return ROLES.includes(raw) ? raw : fallback;
}

/** True when `expiresAt` is in the past relative to `now`. Null never expires. */
function isExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return false;
  const exp = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(exp.getTime())) return false;
  return exp.getTime() < now.getTime();
}

/** Compute an expiry timestamp `days` from `from`. */
function computeExpiry(days = DEFAULT_EXPIRY_DAYS, from = new Date()) {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + (Number.isFinite(days) && days > 0 ? days : DEFAULT_EXPIRY_DAYS));
  return d;
}

/**
 * Encode a field value for the `signature_request_fields.value` TEXT column.
 * Structured values (objects/arrays) are JSON-encoded; scalars are stringified;
 * null/undefined/'' become null. Mirrors the agreement_template_fields
 * suggested_value convention.
 */
function encodeFieldValue(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  const s = String(value);
  return s.length ? s : null;
}

/** Decode a stored field value: try JSON, fall back to the raw string. */
function decodeFieldValue(stored) {
  if (stored == null) return null;
  if (typeof stored !== 'string') return stored;
  const s = stored.trim();
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      return stored;
    }
  }
  return stored;
}

/** Build the public signing URL the signer opens. */
function buildSignerLink(token, baseUrl) {
  const base = (baseUrl || process.env.PUBLIC_APP_URL || 'http://localhost:4200')
    .toString()
    .replace(/\/+$/, '');
  return `${base}/agreements/sign/${token}`;
}

function mapRequestRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    operatingEntityId: row.operating_entity_id || null,
    templateId: row.template_id || null,
    documentType: row.document_type,
    status: row.status,
    signerName: row.signer_name || null,
    signerEmail: row.signer_email || null,
    signerPhone: row.signer_phone || null,
    signerRole: row.signer_role || null,
    signedPdfStorageKey: row.signed_pdf_storage_key || null,
    sentAt: row.sent_at || null,
    viewedAt: row.viewed_at || null,
    signedAt: row.signed_at || null,
    expiresAt: row.expires_at || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapFieldRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    fieldKey: row.field_key,
    role: row.role,
    value: decodeFieldValue(row.value),
    filledBy: row.filled_by || null,
    filledAt: row.filled_at || null
  };
}

/**
 * Merge the template field map (bbox/page/label/type) with the request's
 * captured values into the placement list pdf.service needs to overlay a
 * signed PDF.
 *
 * @param {Array} templateFields - from agreement-service (fieldKey, bbox, page, label, fieldType, role)
 * @param {Object} valuesByKey   - fieldKey -> decoded value
 * @param {Object} signature     - { signerName, signatureValue }
 */
function buildPlacements(templateFields, valuesByKey, signature = {}) {
  const fields = Array.isArray(templateFields) ? templateFields : [];
  const values = valuesByKey || {};
  return fields.map((f) => {
    const isSignature = f.fieldType === 'signature' || f.fieldType === 'initials';
    const raw = isSignature
      ? (signature.signatureValue || signature.signerName)
      : values[f.fieldKey];
    const value = raw == null ? '' : (typeof raw === 'object' ? JSON.stringify(raw) : String(raw));
    return {
      fieldKey: f.fieldKey,
      label: f.label || f.fieldKey,
      fieldType: f.fieldType,
      page: f.page,
      bbox: f.bbox,
      role: f.role,
      value
    };
  });
}

/** Public-facing signer field DTO: signer fields editable, internal read-only. */
function toSignerField(templateField, valuesByKey) {
  const values = valuesByKey || {};
  const role = normalizeRole(templateField.role);
  return {
    fieldKey: templateField.fieldKey,
    label: templateField.label || templateField.fieldKey,
    fieldType: templateField.fieldType,
    page: templateField.page,
    role,
    readOnly: role === 'internal',
    value: values[templateField.fieldKey] ?? null
  };
}

// ---------------------------------------------------------------------------
// Persistence / orchestration
// ---------------------------------------------------------------------------

/**
 * Create a signature request from a finalized template, persist the internal
 * field values, mint a tokenized signing link, send it, and mark the request
 * `sent`. Returns `{ requestId, signerLink, token, status, send }`.
 */
async function createSignatureRequest({
  templateId,
  tenantId,
  operatingEntityId = null,
  fieldValues = {},
  signer = {},
  expiresInDays = DEFAULT_EXPIRY_DAYS,
  baseUrl,
  createdBy = null,
  send = true,
  db = getKnex()
}) {
  if (!tenantId) throw new Error('signature-service: tenantId is required');
  if (!templateId) throw new Error('signature-service: templateId is required');

  const template = await getAgreementService().getTemplateWithFields({
    templateId,
    tenantId,
    withDownloadUrl: false,
    db
  });
  if (!template) {
    const err = new Error('Agreement template not found');
    err.code = 'TEMPLATE_NOT_FOUND';
    throw err;
  }

  const templateFields = template.fields || [];
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = computeExpiry(expiresInDays);

  const requestId = await db.transaction(async (trx) => {
    const [reqRow] = await trx(REQUESTS_TABLE)
      .insert({
        tenant_id: tenantId,
        operating_entity_id: operatingEntityId,
        template_id: template.id,
        document_type: template.documentType || 'generic',
        status: 'draft',
        signer_name: trimToNull(signer.name, 300),
        signer_email: trimToNull(signer.email, 300),
        signer_phone: trimToNull(signer.phone, 50),
        signer_role: trimToNull(signer.role, 100),
        expires_at: expiresAt,
        created_by: createdBy
      })
      .returning('id');
    const newId = reqRow.id || reqRow;

    // Snapshot the template field map into the request. Internal-assigned
    // fields get the values the internal user just filled; signer fields stay
    // empty until the signer submits.
    if (templateFields.length) {
      const fieldRows = templateFields.map((f) => {
        const role = normalizeRole(f.role);
        const provided = role === 'internal' ? fieldValues[f.fieldKey] : undefined;
        const value = provided !== undefined
          ? encodeFieldValue(provided)
          : (role === 'internal' ? encodeFieldValue(f.suggestedValue) : null);
        return {
          request_id: newId,
          field_key: f.fieldKey,
          role,
          value,
          filled_by: role === 'internal' && value != null ? createdBy : null,
          filled_at: role === 'internal' && value != null ? trx.fn.now() : null
        };
      });
      await trx(REQUEST_FIELDS_TABLE).insert(fieldRows);
    }

    // Tokenized signing-link credential (mirrors employer_investigation_tokens).
    await trx(SIGNATURES_TABLE).insert({
      request_id: newId,
      token_hash: tokenHash,
      expires_at: expiresAt
    });

    return newId;
  });

  const signerLink = buildSignerLink(rawToken, baseUrl);

  let sendResult = null;
  if (send) {
    sendResult = await sendSignerLink({
      signer,
      signerLink,
      documentLabel: template.name
    }).catch((err) => {
      dtLogger.error('signature_send_link_failed', err, { requestId });
      return { sms: { sent: false }, email: { sent: false }, error: err.message };
    });

    // Only advance to `sent` once the link is actually out the door.
    const delivered = !!(sendResult && (sendResult.sms?.sent || sendResult.email?.sent));
    await db(REQUESTS_TABLE)
      .where({ id: requestId, tenant_id: tenantId })
      .update({
        status: delivered ? 'sent' : 'draft',
        sent_at: delivered ? db.fn.now() : null,
        updated_at: db.fn.now()
      });
  }

  return {
    requestId,
    signerLink,
    token: rawToken,
    status: send && sendResult && (sendResult.sms?.sent || sendResult.email?.sent) ? 'sent' : 'draft',
    send: sendResult
  };
}

/**
 * Send the signing link to the signer via SMS and/or email (best-effort;
 * never throws). Chooses channel from whichever contact details are present.
 */
async function sendSignerLink({ signer = {}, signerLink, documentLabel }) {
  const notifier = getNotifier();
  const label = documentLabel ? ` "${documentLabel}"` : '';
  const name = signer.name ? ` ${signer.name}` : '';
  const result = { sms: { sent: false }, email: { sent: false } };

  if (signer.phone) {
    result.sms = await notifier.sendSms(
      signer.phone,
      `FleetNeuron: please review and sign the agreement${label}. ${signerLink}`
    );
  }
  if (signer.email) {
    result.email = await notifier.sendEmail({
      to: signer.email,
      subject: `Please sign your agreement${label}`,
      text: `Hello${name},\n\nYou have an agreement${label} ready for your signature. ` +
        `Open the secure link below to review and sign:\n\n${signerLink}\n\n— FleetNeuron`,
      html: `<p>Hello${name},</p>` +
        `<p>You have an agreement${label} ready for your signature. ` +
        `Open the secure link below to review and sign:</p>` +
        `<p><a href="${signerLink}">${signerLink}</a></p><p>— FleetNeuron</p>`
    });
  }
  return result;
}

/**
 * Internal read: request status + signed-PDF download URL (tenant-scoped).
 * Returns null when the request doesn't exist for this tenant.
 */
async function getRequestById({ id, tenantId, db = getKnex() }) {
  const row = await db(REQUESTS_TABLE).where({ id, tenant_id: tenantId }).first();
  if (!row) return null;

  const request = mapRequestRow(row);
  const fieldRows = await db(REQUEST_FIELDS_TABLE)
    .where({ request_id: id })
    .orderBy('created_at', 'asc');
  request.fields = fieldRows.map(mapFieldRow);

  if (request.signedPdfStorageKey) {
    try {
      request.signedPdfUrl = await getR2().getSignedDownloadUrl(request.signedPdfStorageKey);
    } catch (err) {
      dtLogger.warn('signature_signed_pdf_sign_failed', { id, message: err.message });
      request.signedPdfUrl = null;
    }
  }
  return request;
}

/**
 * Resolve a raw signing token to its `{ signature, request }` rows, with a
 * normalized gate state. Never throws on a bad token — returns
 * `{ error, status }` instead.
 */
async function resolveToken(rawToken, db = getKnex()) {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16) {
    return { error: 'Invalid token', status: 404 };
  }
  const tokenHash = hashToken(rawToken);
  const signature = await db(SIGNATURES_TABLE).where({ token_hash: tokenHash }).first();
  if (!signature) return { error: 'Token not found', status: 404 };

  const request = await db(REQUESTS_TABLE).where({ id: signature.request_id }).first();
  if (!request) return { error: 'Signature request not found', status: 404 };

  if (request.status === 'voided') return { error: 'This signing link has been voided', status: 410, signature, request };

  const alreadySigned = !!signature.signed_at || request.status === 'signed' || request.status === 'completed';
  if (alreadySigned) return { signature, request, alreadySigned: true };

  if (request.status === 'expired' || isExpired(signature.expires_at)) {
    return { error: 'This signing link has expired', status: 410, signature, request };
  }
  return { signature, request };
}

/**
 * Public signer read. Validates the token, returns the document context +
 * signer-assigned fields (internal values read-only), and flips the request
 * to `viewed` on first open. Idempotently returns the signed state once signed.
 */
async function getSignerView({ token, db = getKnex() }) {
  const resolved = await resolveToken(token, db);
  if (resolved.error && !resolved.request) {
    return { error: resolved.error, status: resolved.status };
  }
  const { request, signature } = resolved;

  const fieldRows = await db(REQUEST_FIELDS_TABLE)
    .where({ request_id: request.id })
    .orderBy('created_at', 'asc');
  const valuesByKey = {};
  for (const r of fieldRows) valuesByKey[r.field_key] = decodeFieldValue(r.value);

  // Pull bbox/label/type ordering from the template field map when available.
  let templateFields = [];
  if (request.template_id) {
    const tpl = await getAgreementService().getTemplateWithFields({
      templateId: request.template_id,
      tenantId: request.tenant_id,
      withDownloadUrl: false,
      db
    }).catch(() => null);
    if (tpl) templateFields = tpl.fields || [];
  }
  // Fall back to the request's own field rows when there's no template map.
  const fieldSource = templateFields.length
    ? templateFields
    : fieldRows.map((r) => ({ fieldKey: r.field_key, label: r.field_key, fieldType: 'text', page: 1, role: r.role }));

  const fields = fieldSource.map((f) => toSignerField(f, valuesByKey));

  // First view → mark viewed (don't regress a signed/expired request).
  if (request.status === 'sent') {
    await db(REQUESTS_TABLE)
      .where({ id: request.id, status: 'sent' })
      .update({ status: 'viewed', viewed_at: db.fn.now(), updated_at: db.fn.now() });
  }

  const out = {
    status: resolved.alreadySigned ? (request.status === 'completed' ? 'completed' : 'signed') : (request.status === 'sent' ? 'viewed' : request.status),
    alreadySigned: !!resolved.alreadySigned,
    document: {
      name: request.signer_role || request.document_type,
      documentType: request.document_type,
      signerName: request.signer_name || (signature && signature.signer_name) || null,
      signerRole: request.signer_role || null
    },
    consentText: DEFAULT_CONSENT_TEXT,
    fields,
    expiresAt: request.expires_at || null
  };

  if (resolved.alreadySigned && request.signed_pdf_storage_key) {
    try {
      out.signedPdfUrl = await getR2().getSignedDownloadUrl(request.signed_pdf_storage_key);
    } catch {
      out.signedPdfUrl = null;
    }
  }
  return out;
}

/**
 * Public signer write. Validates the token, persists signer field values,
 * records the signature (name/IP/UA/timestamp + consent snapshot), generates
 * the signed PDF, stores it in R2, and moves the request to `signed`.
 * Idempotent: a second submit on an already-signed request returns the
 * existing signed state without re-generating.
 */
async function submitSignature({
  token,
  fieldValues = {},
  signerName,
  signatureValue,
  consent,
  ipAddress = null,
  userAgent = null,
  db = getKnex()
}) {
  const resolved = await resolveToken(token, db);
  if (resolved.error && !resolved.alreadySigned) {
    return { error: resolved.error, status: resolved.status };
  }
  const { request, signature } = resolved;

  // Idempotent: already signed → return the existing signed state.
  if (resolved.alreadySigned) {
    let signedPdfUrl = null;
    if (request.signed_pdf_storage_key) {
      signedPdfUrl = await getR2().getSignedDownloadUrl(request.signed_pdf_storage_key).catch(() => null);
    }
    return { status: request.status === 'completed' ? 'completed' : 'signed', signedPdfUrl, alreadySigned: true };
  }

  // Consent + typed-name signature are required (consent-service semantics).
  const name = trimToNull(signerName, 300) || request.signer_name;
  if (consent !== true && String(consent) !== 'true') {
    return { error: 'Consent is required to sign', status: 400 };
  }
  if (!name) {
    return { error: 'signerName is required', status: 400 };
  }
  // Typed name IS the signature when no explicit value is given (FN-243 parity).
  const sigValue = trimToNull(signatureValue, 300) || name;

  // 1) Persist signer-assigned field values (only the signer's own fields).
  const signerFieldRows = await db(REQUEST_FIELDS_TABLE)
    .where({ request_id: request.id, role: 'signer' });
  const signerKeys = new Set(signerFieldRows.map((r) => r.field_key));
  await db.transaction(async (trx) => {
    for (const [key, val] of Object.entries(fieldValues || {})) {
      if (!signerKeys.has(key)) continue; // never let the signer overwrite internal fields
      await trx(REQUEST_FIELDS_TABLE)
        .where({ request_id: request.id, field_key: key })
        .update({ value: encodeFieldValue(val), filled_at: trx.fn.now(), updated_at: trx.fn.now() });
    }

    // 2) Record the signature on the existing token row.
    await trx(SIGNATURES_TABLE)
      .where({ id: signature.id })
      .update({
        signer_name: name,
        signature_value: sigValue,
        ip_address: ipAddress,
        user_agent: userAgent,
        signed_at: trx.fn.now(),
        consent_text_snapshot: DEFAULT_CONSENT_TEXT,
        updated_at: trx.fn.now()
      });

    // 3) Move the request to `signed`.
    await trx(REQUESTS_TABLE)
      .where({ id: request.id })
      .update({
        status: 'signed',
        signed_at: trx.fn.now(),
        signer_name: name,
        updated_at: trx.fn.now()
      });
  });

  // 4) Generate + store the signed PDF (non-fatal: the signature is already
  // recorded; a PDF failure leaves status `signed` with no key, retryable).
  let signedPdfUrl = null;
  let signedPdfStorageKey = null;
  try {
    const { storageKey } = await generateAndStoreSignedPdf({
      request,
      signature: { signerName: name, signatureValue: sigValue, ipAddress, userAgent, consentText: DEFAULT_CONSENT_TEXT },
      db
    });
    signedPdfStorageKey = storageKey || null;
    if (storageKey) {
      signedPdfUrl = await getR2().getSignedDownloadUrl(storageKey).catch(() => null);
    }
  } catch (err) {
    dtLogger.error('signature_signed_pdf_generate_failed', err, { requestId: request.id });
  }

  // Notify adapters (e.g. lease-to-own) that a request they own has been signed.
  // Best-effort: hook failures never fail the signature itself.
  await fireSignedHooks({
    requestId: request.id,
    tenantId: request.tenant_id,
    documentType: request.document_type,
    signedPdfStorageKey,
    signerName: name,
    db
  });

  return { status: 'signed', signedPdfUrl };
}

/**
 * Build the signed PDF by overlaying field values + signature onto the source
 * document, store it in R2, and persist the key onto the request. Returns
 * `{ storageKey }` (null storageKey when no source/template is resolvable).
 */
async function generateAndStoreSignedPdf({ request, signature, db = getKnex() }) {
  // Load the merged field values.
  const fieldRows = await db(REQUEST_FIELDS_TABLE).where({ request_id: request.id });
  const valuesByKey = {};
  for (const r of fieldRows) valuesByKey[r.field_key] = decodeFieldValue(r.value);

  // Resolve the template (source bytes + bbox/page map).
  let template = null;
  if (request.template_id) {
    template = await getAgreementService().getTemplateWithFields({
      templateId: request.template_id,
      tenantId: request.tenant_id,
      withDownloadUrl: false,
      db
    }).catch(() => null);
  }
  const templateFields = template?.fields || fieldRows.map((r) => ({
    fieldKey: r.field_key, label: r.field_key, fieldType: 'text', page: 1, bbox: null, role: r.role
  }));

  let sourceBytes = null;
  if (template?.sourceStorageKey) {
    sourceBytes = await getR2().downloadBuffer(template.sourceStorageKey).catch((err) => {
      dtLogger.warn('signature_source_download_failed', { requestId: request.id, message: err.message });
      return null;
    });
  }

  const placements = buildPlacements(templateFields, valuesByKey, signature);
  const pdfBuffer = await getPdf().overlaySignedAgreementPdf({
    sourceBytes,
    placements,
    signature: { ...signature, signedAt: new Date().toISOString() }
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const storageKey = `agreements/signed/${request.tenant_id}/${request.id}-${stamp}.pdf`;
  await getR2().uploadBuffer({ buffer: pdfBuffer, contentType: 'application/pdf', key: storageKey });

  await db(REQUESTS_TABLE)
    .where({ id: request.id })
    .update({ signed_pdf_storage_key: storageKey, updated_at: db.fn.now() });

  return { storageKey };
}

module.exports = {
  // orchestration / persistence
  createSignatureRequest,
  getRequestById,
  getSignerView,
  submitSignature,
  generateAndStoreSignedPdf,
  sendSignerLink,
  resolveToken,
  // signature-completion hooks (adapter integration — FN-1803)
  onSigned,
  // pure helpers (exported for unit tests + reuse)
  normalizeStatus,
  normalizeRole,
  isExpired,
  computeExpiry,
  encodeFieldValue,
  decodeFieldValue,
  buildSignerLink,
  buildPlacements,
  toSignerField,
  mapRequestRow,
  mapFieldRow,
  trimToNull,
  // constants
  STATUSES,
  TERMINAL_STATUSES,
  ROLES,
  DEFAULT_EXPIRY_DAYS,
  DEFAULT_CONSENT_TEXT,
  REQUESTS_TABLE,
  REQUEST_FIELDS_TABLE,
  SIGNATURES_TABLE
};
