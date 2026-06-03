'use strict';

/**
 * FN-1098: Photo intake for the Quick Add Part flow.
 *
 * Wraps `parts-vision-handler` with two production concerns:
 *   1. Multipart `image` upload OR JSON `{imageBase64, mimeType}` (max 10MB).
 *   2. Persists the uploaded photo to R2 under `parts/photos/<uuid>.<ext>`
 *      so the FE/BE can later attach it to a `parts.image_url` row when
 *      the user saves the prefilled form (FN-1099).
 *
 * On success the response carries both the AI extraction (so the FE can
 * prefill the modal) and the `r2Key` (so a follow-up create/update can
 * persist `image_r2_key`).
 *
 * Auth + rate-limit: same convention as the rest of `/api/ai/*` — the
 * gateway has already verified the bearer JWT before proxying here, so
 * this handler does not re-verify. No service-side rate limit (that lives
 * in the gateway too).
 */

const crypto = require('crypto');
const multer = require('multer');

const { extractPartFromImage, SUPPORTED_MEDIA_TYPES } = require('./parts-vision-handler');

const ROUTE = '/parts/identify-from-photo';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const R2_PREFIX = 'parts/photos';

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function buildR2Key(mimeType) {
  const ext = MIME_TO_EXT[mimeType] || 'bin';
  const uuid = crypto.randomUUID();
  return `${R2_PREFIX}/${uuid}.${ext}`;
}

function approxBase64ByteSize(b64) {
  if (typeof b64 !== 'string') return 0;
  // Rough byte count: every 4 base64 chars decode to ~3 bytes.
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Resolves the image payload from either multipart (req.file) or JSON
 * (req.body.imageBase64 / req.body.mimeType). Returns:
 *   { ok: true, buffer, base64, mimeType }
 *   { ok: false, status, body }
 */
function resolveImagePayload(req) {
  if (req.file && req.file.buffer) {
    const mimeType = req.file.mimetype || 'image/jpeg';
    if (!SUPPORTED_MEDIA_TYPES.includes(mimeType)) {
      return {
        ok: false,
        status: 400,
        body: {
          success: false,
          error: `Unsupported media type: ${mimeType}. Supported: ${SUPPORTED_MEDIA_TYPES.join(', ')}`,
          code: 'AI_BAD_REQUEST',
        },
      };
    }
    if (req.file.size > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        status: 413,
        body: {
          success: false,
          error: `Image exceeds max size of ${MAX_IMAGE_BYTES} bytes`,
          code: 'AI_IMAGE_TOO_LARGE',
        },
      };
    }
    return {
      ok: true,
      buffer: req.file.buffer,
      base64: req.file.buffer.toString('base64'),
      mimeType,
    };
  }

  const body = req.body || {};
  const imageBase64 = body.imageBase64;
  const mimeType = body.mimeType || body.mediaType || 'image/jpeg';

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: 'image (multipart) or imageBase64 (JSON) is required',
        code: 'AI_BAD_REQUEST',
      },
    };
  }

  if (!SUPPORTED_MEDIA_TYPES.includes(mimeType)) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: `Unsupported media type: ${mimeType}. Supported: ${SUPPORTED_MEDIA_TYPES.join(', ')}`,
        code: 'AI_BAD_REQUEST',
      },
    };
  }

  if (approxBase64ByteSize(imageBase64) > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      status: 413,
      body: {
        success: false,
        error: `Image exceeds max size of ${MAX_IMAGE_BYTES} bytes`,
        code: 'AI_IMAGE_TOO_LARGE',
      },
    };
  }

  let buffer;
  try {
    buffer = Buffer.from(imageBase64, 'base64');
  } catch (_e) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: 'imageBase64 is not valid base64',
        code: 'AI_BAD_REQUEST',
      },
    };
  }

  return { ok: true, buffer, base64: imageBase64, mimeType };
}

async function handlePartsPhotoIntake(req, res, deps) {
  const payload = resolveImagePayload(req);
  if (!payload.ok) {
    return res.status(payload.status).json(payload.body);
  }

  const r2Key = buildR2Key(payload.mimeType);

  const storage = (deps && deps.r2Storage) || require('@goodmen/shared/storage/r2-storage');

  let uploadResult;
  try {
    uploadResult = await storage.uploadBuffer({
      buffer: payload.buffer,
      contentType: payload.mimeType,
      key: r2Key,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] parts photo R2 upload failed', err.message || err);
    return res.status(502).json({
      success: false,
      error: 'Failed to upload image to storage',
      code: 'R2_UPLOAD_FAILED',
      details: err.message || 'Unknown error',
    });
  }

  const visionResult = await extractPartFromImage({
    imageBase64: payload.base64,
    mediaType: payload.mimeType,
    deps,
    route: ROUTE,
  });

  // For unreadable / parse / upstream errors we still return the r2Key so
  // the FE can decide whether to retry or discard. The aiResult mirrors the
  // existing /parts/identify-vision contract for the FE to read uniformly.
  const responseBody = {
    success: visionResult.kind === 'success',
    aiResult: visionResult.body,
    r2Key: uploadResult.key,
    meta: {
      processingTimeMs: visionResult.processingTimeMs,
      model: visionResult.model,
    },
  };

  return res.status(visionResult.status).json(responseBody);
}

module.exports = {
  handlePartsPhotoIntake,
  photoUpload,
  resolveImagePayload,
  buildR2Key,
  MAX_IMAGE_BYTES,
  R2_PREFIX,
};
