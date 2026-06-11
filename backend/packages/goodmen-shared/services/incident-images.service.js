'use strict';

/**
 * FN-1231 — Incident image upload, storage, and signed-URL retrieval.
 *
 * All images are stored in R2 under a tenant-scoped prefix:
 *   tenants/{tenantId}/incidents/{incidentId}/{timestamp}-{hex}-{filename}
 *
 * Metadata is persisted in the `incident_images` table (created by FN-1232).
 * Signed GET URLs are generated on demand and are never stored.
 *
 * Validation constraints (enforced before any S3 write):
 *   - Max size : 10 MB
 *   - MIME types: image/jpeg, image/png, image/heic
 */

const db = require('../internal/db');
const dtLogger = require('../utils/logger');
const { uploadBuffer, getSignedDownloadUrl } = require('../storage/r2-storage');

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/heic']);
const SIGNED_URL_TTL_SECONDS = Number(process.env.INCIDENT_IMAGE_SIGNED_URL_TTL || 900);

function validateFile(file) {
  const errors = [];
  if (file.size > MAX_SIZE_BYTES) {
    errors.push(`file_too_large: max ${MAX_SIZE_BYTES} bytes, got ${file.size}`);
  }
  if (!ALLOWED_MIMES.has(file.mimetype)) {
    errors.push(`unsupported_format: allowed jpg/png/heic, got ${file.mimetype}`);
  }
  return errors;
}

function buildS3Key(tenantId, incidentId, originalName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = (originalName || 'image')
    .toString()
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 64);
  return `tenants/${tenantId}/incidents/${incidentId}/${stamp}-${safe}`;
}

async function assertCallAccess(incidentId, context = {}) {
  const row = await db.knex('roadside_calls')
    .where('id', incidentId)
    .modify((qb) => {
      if (!context.isGlobalAdmin && context.tenantId) {
        qb.where('tenant_id', context.tenantId);
      }
    })
    .first();
  if (!row) throw Object.assign(new Error('Incident not found'), { status: 404 });
  return row;
}

/**
 * Upload a single image file for an incident.
 *
 * @param {string} incidentId
 * @param {{ buffer: Buffer, mimetype: string, size: number, originalname: string }} file
 * @param {string|null} uploadedBy  user ID
 * @param {object} context          tenant context from middleware
 * @returns {Promise<object>}       persisted image metadata row
 */
async function uploadImage(incidentId, file, uploadedBy, context = {}) {
  const validationErrors = validateFile(file);
  if (validationErrors.length > 0) {
    const err = Object.assign(
      new Error(`Validation failed: ${validationErrors.join('; ')}`),
      { status: 400, reasons: validationErrors }
    );
    dtLogger.warn('incident_image_rejected', {
      incidentId,
      tenantId: context.tenantId,
      reasons: validationErrors,
      size: file.size,
      mimetype: file.mimetype
    });
    throw err;
  }

  const call = await assertCallAccess(incidentId, context);
  const tenantId = call.tenant_id || context.tenantId;
  const s3Key = buildS3Key(tenantId, incidentId, file.originalname);

  await uploadBuffer({
    buffer: file.buffer,
    contentType: file.mimetype,
    key: s3Key
  });

  const [row] = await db.knex('incident_images')
    .insert({
      incident_id: incidentId,
      tenant_id: tenantId,
      s3_key: s3Key,
      mime_type: file.mimetype,
      size_bytes: file.size,
      original_file_name: file.originalname || null,
      uploaded_by: uploadedBy || null
    })
    .returning('*');

  dtLogger.info('incident_image_uploaded', {
    imageId: row.id,
    incidentId,
    tenantId,
    sizeBytes: file.size,
    mimeType: file.mimetype
  });

  return row;
}

/**
 * List images for an incident, each decorated with a short-lived signed URL.
 *
 * @param {string} incidentId
 * @param {object} context
 * @returns {Promise<object[]>}
 */
async function listImages(incidentId, context = {}) {
  await assertCallAccess(incidentId, context);

  const rows = await db.knex('incident_images')
    .where('incident_id', incidentId)
    .orderBy('uploaded_at', 'asc');

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      signed_url: await getSignedDownloadUrl(row.s3_key, SIGNED_URL_TTL_SECONDS),
      signed_url_expires_in: SIGNED_URL_TTL_SECONDS
    }))
  );
}

/**
 * Get a single incident image with a signed URL.
 *
 * @param {string} incidentId
 * @param {string} imageId
 * @param {object} context
 * @returns {Promise<object>}
 */
async function getImage(incidentId, imageId, context = {}) {
  await assertCallAccess(incidentId, context);

  const row = await db.knex('incident_images')
    .where({ id: imageId, incident_id: incidentId })
    .first();

  if (!row) throw Object.assign(new Error('Image not found'), { status: 404 });

  return {
    ...row,
    signed_url: await getSignedDownloadUrl(row.s3_key, SIGNED_URL_TTL_SECONDS),
    signed_url_expires_in: SIGNED_URL_TTL_SECONDS
  };
}

module.exports = { uploadImage, listImages, getImage };
