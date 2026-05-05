'use strict';

/**
 * FN-1103: Invoice intake for the Quick Add Part — AI Invoice OCR flow.
 *
 * Wraps `parts-invoice-vision-handler` (FN-1102) with two production
 * concerns:
 *   1. Multipart `image` upload OR JSON `{base64, mimeType}` (max 20MB).
 *      Accepts images (jpeg/png/webp) AND PDFs (application/pdf).
 *   2. Persists the uploaded file to R2 under `parts/invoices/<uuid>.<ext>`
 *      so the BE can later attach it to a parts-import audit record (or
 *      simply preserve the source artefact).
 *
 * On success the response carries both the AI extraction (so the FE can
 * show a checkbox table for review) and the `r2Key`.
 *
 * Auth + rate-limit: same convention as the rest of `/api/ai/*` and
 * FN-1098 — the gateway has already verified the bearer JWT before
 * proxying here, so this handler does not re-verify. No service-side
 * rate limit (that lives in the gateway too).
 *
 * Pattern note: the FN-1102 handler exports `handlePartsInvoiceVision(req,
 * res, deps)` which writes directly to `res`. We must NOT modify that
 * file (per FN-1103 scope), so we use a tiny response-capturing shim to
 * get the JSON envelope back.
 */

const crypto = require('crypto');
const multer = require('multer');

const {
  handlePartsInvoiceVision,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_PDF_TYPE,
} = require('./parts-invoice-vision-handler');

const ROUTE = '/parts/extract-from-invoice';
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const R2_PREFIX = 'parts/invoices';

const SUPPORTED_TYPES = [...SUPPORTED_IMAGE_TYPES, SUPPORTED_PDF_TYPE];

const invoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

function buildR2Key(mimeType) {
  const ext = MIME_TO_EXT[mimeType] || 'bin';
  const uuid = crypto.randomUUID();
  return `${R2_PREFIX}/${uuid}.${ext}`;
}

function approxBase64ByteSize(b64) {
  if (typeof b64 !== 'string') return 0;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Resolves the file payload from either multipart (req.file) or JSON
 * (req.body.base64 / req.body.mimeType). Returns:
 *   { ok: true, buffer, base64, mimeType }
 *   { ok: false, status, body }
 */
function resolveInvoicePayload(req) {
  if (req.file && req.file.buffer) {
    const mimeType = req.file.mimetype || 'image/jpeg';
    if (!SUPPORTED_TYPES.includes(mimeType)) {
      return {
        ok: false,
        status: 400,
        body: {
          success: false,
          error: `Unsupported media type: ${mimeType}. Supported: ${SUPPORTED_TYPES.join(', ')}`,
          code: 'AI_BAD_REQUEST',
        },
      };
    }
    if (req.file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        status: 413,
        body: {
          success: false,
          error: `File exceeds max size of ${MAX_FILE_BYTES} bytes`,
          code: 'AI_FILE_TOO_LARGE',
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
  const base64 = body.base64 || body.imageBase64 || body.pdfBase64;
  const mimeType = body.mimeType || body.mediaType || 'image/jpeg';

  if (!base64 || typeof base64 !== 'string') {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: 'image (multipart) or base64 (JSON) is required',
        code: 'AI_BAD_REQUEST',
      },
    };
  }

  if (!SUPPORTED_TYPES.includes(mimeType)) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: `Unsupported media type: ${mimeType}. Supported: ${SUPPORTED_TYPES.join(', ')}`,
        code: 'AI_BAD_REQUEST',
      },
    };
  }

  if (approxBase64ByteSize(base64) > MAX_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      body: {
        success: false,
        error: `File exceeds max size of ${MAX_FILE_BYTES} bytes`,
        code: 'AI_FILE_TOO_LARGE',
      },
    };
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch (_e) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: 'base64 is not valid base64',
        code: 'AI_BAD_REQUEST',
      },
    };
  }

  return { ok: true, buffer, base64, mimeType };
}

/**
 * Calls the FN-1102 handler with a synthetic req/res so we can capture
 * the JSON envelope. The handler always responds via `res.json()` and
 * `res.status().json()`, so a tiny response-capturing shim is enough.
 */
async function callInvoiceVision({ base64, mimeType, deps }) {
  const isPdf = mimeType === SUPPORTED_PDF_TYPE;
  const innerReq = {
    body: isPdf
      ? { pdfBase64: base64, mediaType: mimeType }
      : { imageBase64: base64, mediaType: mimeType },
  };

  let capturedStatus = 200;
  let capturedBody = null;
  const innerRes = {
    status(code) {
      capturedStatus = code;
      return this;
    },
    json(payload) {
      capturedBody = payload;
      return this;
    },
  };

  await handlePartsInvoiceVision(innerReq, innerRes, deps || {});

  return { status: capturedStatus, body: capturedBody };
}

async function handlePartsInvoiceIntake(req, res, deps) {
  const payload = resolveInvoicePayload(req);
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
    console.error('[ai-service] parts invoice R2 upload failed', err.message || err);
    return res.status(502).json({
      success: false,
      error: 'Failed to upload invoice to storage',
      code: 'R2_UPLOAD_FAILED',
      details: err.message || 'Unknown error',
    });
  }

  const visionResponse = await callInvoiceVision({
    base64: payload.base64,
    mimeType: payload.mimeType,
    deps,
  });

  // Mirror the FN-1098 envelope shape: aiResult + r2Key. Even on
  // 422/502 we return r2Key so the FE can decide retry vs discard.
  const responseBody = {
    success: visionResponse.status === 200 && visionResponse.body && visionResponse.body.success === true,
    aiResult: visionResponse.body,
    r2Key: uploadResult.key,
  };

  return res.status(visionResponse.status).json(responseBody);
}

module.exports = {
  handlePartsInvoiceIntake,
  invoiceUpload,
  resolveInvoicePayload,
  buildR2Key,
  callInvoiceVision,
  MAX_FILE_BYTES,
  R2_PREFIX,
  SUPPORTED_TYPES,
};
