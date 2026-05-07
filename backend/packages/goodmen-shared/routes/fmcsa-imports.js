'use strict';

/**
 * FN-1424 — FMCSA import control plane HTTP routes.
 *
 * POST /api/fmcsa/imports/run         — enqueue runs from env-var URL sources (manual)
 * POST /api/fmcsa/imports/run-upload  — enqueue a run from an uploaded bulk file (FN-1457)
 * GET  /api/fmcsa/imports             — list recent runs from the ledger
 *
 * Both routes are gated upstream by the integrations-service bootstrap with:
 *   authMiddleware  →  tenantContextMiddleware  →  requireInternalTenant
 *   →  loadUserRbac  →  requirePermission('fmcsa.imports.manage')
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { SUPPORTED_FILES } = require('../services/fmcsa-import-queue');

const UPLOAD_SIZE_LIMIT = 1024 * 1024 * 1024; // 1 GB
const ACCEPTED_MIME_TYPES = new Set([
  'text/csv',
  'application/gzip',
  'application/x-gzip',
  'application/octet-stream',
]);

function getUploadDir() {
  return process.env.FMCSA_UPLOAD_DIR || '/tmp/fmcsa-uploads';
}

function buildUploadMiddleware() {
  const storage = multer.diskStorage({
    destination(_req, _file, cb) {
      const dir = getUploadDir();
      fs.mkdir(dir, { recursive: true }, (err) => cb(err || null, dir));
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || '') || '';
      const stamp = Date.now().toString(36);
      const rand = crypto.randomBytes(6).toString('hex');
      cb(null, `fmcsa-${stamp}-${rand}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: UPLOAD_SIZE_LIMIT, files: 1 },
    fileFilter(_req, file, cb) {
      if (!ACCEPTED_MIME_TYPES.has(file.mimetype)) {
        const err = new Error(
          `unsupported MIME type: ${file.mimetype} (expected one of ${[...ACCEPTED_MIME_TYPES].join(', ')})`,
        );
        err.code = 'UNSUPPORTED_MIME';
        return cb(err);
      }
      return cb(null, true);
    },
  }).single('file');
}

function unlinkSafe(filePath) {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {});
}

function createImportsRouter({ importQueue }) {
  if (!importQueue) {
    throw new Error('createImportsRouter: importQueue is required');
  }
  const router = express.Router();
  const uploadMiddleware = buildUploadMiddleware();

  /**
   * @openapi
   * /api/fmcsa/imports/run:
   *   post:
   *     summary: Enqueue FMCSA reference dataset imports
   *     description: |
   *       Queue one import per file in the request body. Restricted to
   *       FleetNeuron-internal tenants with the `fmcsa.imports.manage`
   *       permission. Returns 202 with the run IDs created in the ledger.
   *     tags: [FMCSA Imports]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [files]
   *             properties:
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   enum: [census, authority, inspections, crashes, sms]
   *               dryRun:
   *                 type: boolean
   *     responses:
   *       202:
   *         description: Runs enqueued
   */
  router.post('/run', async (req, res) => {
    const { files, dryRun } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'files must be a non-empty array' });
    }
    const invalid = files.filter((f) => !SUPPORTED_FILES.includes(f));
    if (invalid.length > 0) {
      return res.status(400).json({
        success: false,
        error: `unsupported files: ${invalid.join(', ')}`,
        supported: SUPPORTED_FILES,
      });
    }

    try {
      const runIds = [];
      for (const file of files) {
        const row = await importQueue.enqueueImportRun({
          file,
          dryRun: !!dryRun,
          triggeredBy: 'manual',
          triggeredByUserId: req.user?.id || null,
        });
        runIds.push(row.id);
      }
      return res.status(202).json({ success: true, data: { runIds } });
    } catch (err) {
      console.error('[fmcsa-imports] enqueue failed', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * @openapi
   * /api/fmcsa/imports/run-upload:
   *   post:
   *     summary: Enqueue an FMCSA import from an uploaded bulk file
   *     description: |
   *       Accepts a single FMCSA bulk CSV (or .csv.gz) up to 1 GB and enqueues a
   *       run that consumes it from a tmp path on disk. Bypasses the
   *       `FMCSA_*_URL` env-var fallback so operators can sidestep FMCSA's
   *       gated auth/captcha endpoints (FN-1456). The tmp file is deleted in
   *       the queue processor's `finally` after the import completes or fails.
   *     tags: [FMCSA Imports]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [file, fileType]
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *               fileType:
   *                 type: string
   *                 enum: [census, authority, inspections, crashes, sms]
   *               dryRun:
   *                 type: string
   *                 enum: ["true", "false"]
   *     responses:
   *       202:
   *         description: Run enqueued
   *       400:
   *         description: Validation failure
   *       413:
   *         description: Uploaded file exceeds the 1 GB limit
   */
  router.post('/run-upload', (req, res) => {
    uploadMiddleware(req, res, async (uploadErr) => {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            success: false,
            error: `uploaded file exceeds the ${UPLOAD_SIZE_LIMIT}-byte limit`,
          });
        }
        if (uploadErr.code === 'UNSUPPORTED_MIME') {
          return res.status(400).json({ success: false, error: uploadErr.message });
        }
        console.error('[fmcsa-imports] upload failed', uploadErr);
        return res.status(400).json({ success: false, error: uploadErr.message });
      }

      const uploaded = req.file;
      const { fileType, dryRun: dryRunRaw } = req.body || {};

      if (!uploaded) {
        return res.status(400).json({ success: false, error: 'file is required (multipart field "file")' });
      }
      if (!fileType || !SUPPORTED_FILES.includes(fileType)) {
        unlinkSafe(uploaded.path);
        return res.status(400).json({
          success: false,
          error: `fileType must be one of ${SUPPORTED_FILES.join(', ')}`,
          supported: SUPPORTED_FILES,
        });
      }

      const dryRun = dryRunRaw === 'true' || dryRunRaw === true;

      try {
        const row = await importQueue.enqueueImportRun({
          file: fileType,
          dryRun,
          triggeredBy: 'manual',
          triggeredByUserId: req.user?.id || null,
          source: { type: 'path', value: uploaded.path },
        });
        return res.status(202).json({
          success: true,
          data: { runId: row.id, file: fileType, uploadedSizeBytes: uploaded.size },
        });
      } catch (err) {
        unlinkSafe(uploaded.path);
        console.error('[fmcsa-imports] run-upload enqueue failed', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    });
  });

  /**
   * @openapi
   * /api/fmcsa/imports:
   *   get:
   *     summary: List recent FMCSA import runs
   *     description: Returns recent rows from `fmcsa.import_runs` ordered by `started_at DESC`.
   *     tags: [FMCSA Imports]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
   *     responses:
   *       200:
   *         description: Array of import-run rows
   */
  router.get('/', async (req, res) => {
    try {
      const rows = await importQueue.listRecentRuns(req.query.limit);
      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error('[fmcsa-imports] list failed', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = {
  createImportsRouter,
  // Exposed for tests
  _internals: { ACCEPTED_MIME_TYPES, UPLOAD_SIZE_LIMIT, getUploadDir },
};
