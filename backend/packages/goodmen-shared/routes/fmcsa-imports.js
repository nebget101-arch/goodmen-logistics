'use strict';

/**
 * FN-1424 — FMCSA import control plane HTTP routes.
 *
 * POST /api/fmcsa/imports/run    — enqueue one run per requested file (manual)
 * GET  /api/fmcsa/imports        — list recent runs from the ledger
 *
 * Both routes are gated upstream by the integrations-service bootstrap with:
 *   authMiddleware  →  tenantContextMiddleware  →  requireInternalTenant
 *   →  loadUserRbac  →  requirePermission('fmcsa.imports.manage')
 */

const express = require('express');
const { SUPPORTED_FILES } = require('../services/fmcsa-import-queue');

function createImportsRouter({ importQueue }) {
  if (!importQueue) {
    throw new Error('createImportsRouter: importQueue is required');
  }
  const router = express.Router();

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

module.exports = { createImportsRouter };
