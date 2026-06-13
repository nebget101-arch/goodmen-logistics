const express = require('express');
const router = express.Router();
const multer = require('multer');
const { query } = require('../internal/db');
const { uploadBuffer, getSignedDownloadUrl, deleteObject } = require('../storage/r2-storage');

// FN-1742 — Branding logo upload/serve/delete API for operating entities and
// shop locations (epic FN-1736, story FN-1737). Mirrors the multer memoryStorage
// + R2 pattern from routes/dqf-documents.js. Logo metadata lives on the target
// table itself (columns added by FN-1741): logo_storage_key, logo_mime_type,
// logo_uploaded_at. All endpoints are tenant-scoped via req.context.tenantId.

const SIGNED_URL_TTL_SECONDS = 15 * 60; // 15-minute TTL per FN-1737 contract
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_LOGO_DIMENSION = 1024; // px (width and height)

// mime → file extension for the stable R2 object key
const ALLOWED_MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

// Resource map: route param → table + R2 key prefix. Both tables carry the same
// logo_* columns and a tenant_id used for scoping.
const RESOURCES = {
  'operating-entities': { table: 'operating_entities', keyPrefix: 'branding/operating-entities' },
  locations: { table: 'locations', keyPrefix: 'branding/locations' }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TO_EXT[file.mimetype]) {
      return cb(null, true);
    }
    return cb(new Error('Only PNG, JPEG, or WebP images are allowed'));
  }
});

/**
 * Read the pixel dimensions of a PNG, JPEG, or WebP image straight from its
 * header bytes — no image decoding, no extra dependency (jimp doesn't support
 * WebP). Returns { width, height } or null if the header can't be parsed.
 */
function readImageDimensions(buffer) {
  if (!buffer || buffer.length < 16) return null;

  // PNG: 8-byte signature, then IHDR with width@16 / height@20 (big-endian).
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // JPEG: starts FFD8; scan segments for a Start-Of-Frame marker.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      // SOF markers carry frame dimensions; exclude DHT(C4), JPG(C8), DAC(CC).
      const isSof = marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        };
      }
      // Standalone markers (no length payload): RSTn, SOI, EOI, TEM.
      if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
        offset += 2;
        continue;
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) return null;
      offset += 2 + segmentLength;
    }
    return null;
  }

  // WebP: RIFF....WEBP, then a VP8 / VP8L / VP8X chunk.
  if (
    buffer.length >= 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const format = buffer.toString('ascii', 12, 16);
    if (format === 'VP8 ') {
      // Lossy: 14-bit width/height after the 3-byte start code at offset 23.
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      };
    }
    if (format === 'VP8L') {
      // Lossless: dimensions packed in 4 bytes after the 0x2f signature byte@20.
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
      };
    }
    if (format === 'VP8X') {
      // Extended: 24-bit (canvas-1) width@24, height@27, little-endian.
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      return { width, height };
    }
  }

  return null;
}

/** Resolve + validate the :resource param. Sends 404 and returns null if unknown. */
function resolveResource(req, res) {
  const resource = RESOURCES[req.params.resource];
  if (!resource) {
    res.status(404).json({ message: 'Unknown branding resource' });
    return null;
  }
  return resource;
}

/**
 * Fetch the target row scoped to the caller's tenant. Returns the row, or null
 * after sending a 403 (no tenant context) / 404 (missing or cross-tenant) reply.
 */
async function loadScopedRow(req, res, resource) {
  const tenantId = req.context?.tenantId;
  if (!tenantId) {
    res.status(403).json({ message: 'Tenant context required' });
    return null;
  }

  const result = await query(
    `SELECT id, tenant_id, logo_storage_key, logo_mime_type, logo_uploaded_at
     FROM ${resource.table} WHERE id = $1`,
    [req.params.id]
  );

  // Cross-tenant or unknown ids are indistinguishable to the caller (404).
  if (result.rows.length === 0 || result.rows[0].tenant_id !== tenantId) {
    res.status(404).json({ message: 'Not found' });
    return null;
  }

  return result.rows[0];
}

// ─── POST /api/branding/:resource/:id/logo — upload or replace ───────────────
/**
 * @openapi
 * /api/branding/{resource}/{id}/logo:
 *   post:
 *     summary: Upload or replace a branding logo
 *     description: >
 *       Uploads a logo (PNG/JPEG/WebP, max 2MB, max 1024x1024) for an operating
 *       entity or shop location, storing it in R2 and persisting the storage key,
 *       mime type, and upload timestamp. Replaces any existing logo. Tenant-scoped.
 *     tags:
 *       - Branding
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: resource
 *         required: true
 *         schema: { type: string, enum: [operating-entities, locations] }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Logo stored; returns signed URL, mime type, and timestamp
 *       400:
 *         description: Missing/invalid file (type, size, or dimensions)
 *       403:
 *         description: Tenant context required
 *       404:
 *         description: Resource not found or cross-tenant
 *       500:
 *         description: Server error
 */
router.post('/:resource/:id/logo', (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        const message = uploadErr.code === 'LIMIT_FILE_SIZE'
          ? 'Logo must be 2MB or smaller'
          : uploadErr.message || 'Invalid upload';
        return res.status(400).json({ message });
      }

      const resource = resolveResource(req, res);
      if (!resource) return undefined;

      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const ext = ALLOWED_MIME_TO_EXT[req.file.mimetype];
      if (!ext) {
        return res.status(400).json({ message: 'Only PNG, JPEG, or WebP images are allowed' });
      }

      const dimensions = readImageDimensions(req.file.buffer);
      if (!dimensions) {
        return res.status(400).json({ message: 'Unable to read image dimensions; file may be corrupt' });
      }
      if (dimensions.width > MAX_LOGO_DIMENSION || dimensions.height > MAX_LOGO_DIMENSION) {
        return res.status(400).json({
          message: `Logo dimensions must be ${MAX_LOGO_DIMENSION}x${MAX_LOGO_DIMENSION} or smaller`
        });
      }

      const row = await loadScopedRow(req, res, resource);
      if (!row) return undefined;

      const storageKey = `${resource.keyPrefix}/${row.id}/logo.${ext}`;

      await uploadBuffer({
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
        key: storageKey
      });

      // Replacing with a different extension leaves the old object orphaned — remove it.
      if (row.logo_storage_key && row.logo_storage_key !== storageKey) {
        await deleteObject(row.logo_storage_key).catch(() => {});
      }

      const updated = await query(
        `UPDATE ${resource.table}
         SET logo_storage_key = $1, logo_mime_type = $2, logo_uploaded_at = NOW()
         WHERE id = $3
         RETURNING logo_mime_type, logo_uploaded_at`,
        [storageKey, req.file.mimetype, row.id]
      );

      const saved = updated.rows[0];
      return res.json({
        logoUrl: await getSignedDownloadUrl(storageKey, SIGNED_URL_TTL_SECONDS),
        mimeType: saved.logo_mime_type,
        uploadedAt: saved.logo_uploaded_at
      });
    } catch (error) {
      console.error('Error uploading branding logo:', error);
      return res.status(500).json({ message: 'Failed to upload logo' });
    }
  });
});

// ─── GET /api/branding/:resource/:id/logo — signed URL or null ───────────────
/**
 * @openapi
 * /api/branding/{resource}/{id}/logo:
 *   get:
 *     summary: Get a signed URL for a branding logo
 *     description: >
 *       Returns a 15-minute signed download URL for the resource's logo, or
 *       { logoUrl: null } when none is set. Tenant-scoped.
 *     tags:
 *       - Branding
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: resource
 *         required: true
 *         schema: { type: string, enum: [operating-entities, locations] }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Signed logo URL with metadata, or { logoUrl: null }
 *       403:
 *         description: Tenant context required
 *       404:
 *         description: Resource not found or cross-tenant
 *       500:
 *         description: Server error
 */
router.get('/:resource/:id/logo', async (req, res) => {
  try {
    const resource = resolveResource(req, res);
    if (!resource) return undefined;

    const row = await loadScopedRow(req, res, resource);
    if (!row) return undefined;

    if (!row.logo_storage_key) {
      return res.json({ logoUrl: null });
    }

    return res.json({
      logoUrl: await getSignedDownloadUrl(row.logo_storage_key, SIGNED_URL_TTL_SECONDS),
      mimeType: row.logo_mime_type,
      uploadedAt: row.logo_uploaded_at
    });
  } catch (error) {
    console.error('Error fetching branding logo:', error);
    return res.status(500).json({ message: 'Failed to fetch logo' });
  }
});

// ─── DELETE /api/branding/:resource/:id/logo — remove object + clear columns ──
/**
 * @openapi
 * /api/branding/{resource}/{id}/logo:
 *   delete:
 *     summary: Delete a branding logo
 *     description: >
 *       Removes the logo object from R2 and clears the storage key, mime type,
 *       and timestamp columns. Idempotent. Tenant-scoped.
 *     tags:
 *       - Branding
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: resource
 *         required: true
 *         schema: { type: string, enum: [operating-entities, locations] }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: '{ ok: true }'
 *       403:
 *         description: Tenant context required
 *       404:
 *         description: Resource not found or cross-tenant
 *       500:
 *         description: Server error
 */
router.delete('/:resource/:id/logo', async (req, res) => {
  try {
    const resource = resolveResource(req, res);
    if (!resource) return undefined;

    const row = await loadScopedRow(req, res, resource);
    if (!row) return undefined;

    if (row.logo_storage_key) {
      await deleteObject(row.logo_storage_key);
      await query(
        `UPDATE ${resource.table}
         SET logo_storage_key = NULL, logo_mime_type = NULL, logo_uploaded_at = NULL
         WHERE id = $1`,
        [row.id]
      );
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting branding logo:', error);
    return res.status(500).json({ message: 'Failed to delete logo' });
  }
});

module.exports = router;
// Exported for unit testing the header-only dimension parser.
module.exports.readImageDimensions = readImageDimensions;
