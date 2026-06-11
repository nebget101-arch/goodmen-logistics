'use strict';

/**
 * FN-1231 — Incident image upload + signed-URL retrieval routes.
 *
 * Mounted at /api/incidents in drivers-compliance-service, so the full paths are:
 *   POST /api/incidents/:id/images         — multipart upload (one file per request)
 *   GET  /api/incidents/:id/images         — list images with signed GET URLs
 *   GET  /api/incidents/:id/images/:imageId — single image with signed GET URL
 */

const express = require('express');
const multer = require('multer');

const router = express.Router();
const incidentImagesService = require('../services/incident-images.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/heic'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(Object.assign(
        new Error(`unsupported_format: allowed jpg/png/heic, got ${file.mimetype}`),
        { status: 400 }
      ));
    }
  }
});

/**
 * @openapi
 * /api/incidents/{id}/images:
 *   post:
 *     summary: Upload a damage photo for a roadside incident
 *     description: Accepts a multipart image (jpg/png/heic, ≤10 MB), stores it under a tenant-scoped R2 prefix, and returns the metadata row with a signed GET URL. Tenant path — tenants/{tenantId}/incidents/{incidentId}/.
 *     tags:
 *       - Incidents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside incident ID
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Image uploaded; metadata + signed_url returned
 *       400:
 *         description: Validation error (size > 10 MB, unsupported format)
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.post('/:id/images', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'image field is required (multipart/form-data)' });
    }
    const uploadedBy = req.context?.userId || req.user?.id || null;
    const image = await incidentImagesService.uploadImage(
      req.params.id,
      req.file,
      uploadedBy,
      req.context
    );
    return res.status(201).json(image);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message, reasons: err.reasons });
  }
});

/**
 * @openapi
 * /api/incidents/{id}/images:
 *   get:
 *     summary: List all images for a roadside incident
 *     description: Returns image metadata rows each decorated with a short-lived signed GET URL (default 15-min TTL, configurable via INCIDENT_IMAGE_SIGNED_URL_TTL env var).
 *     tags:
 *       - Incidents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside incident ID
 *     responses:
 *       200:
 *         description: Array of image records with signed_url
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.get('/:id/images', async (req, res) => {
  try {
    const images = await incidentImagesService.listImages(req.params.id, req.context);
    return res.json(images);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/incidents/{id}/images/{imageId}:
 *   get:
 *     summary: Get a single incident image with signed URL
 *     tags:
 *       - Incidents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside incident ID
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema:
 *           type: string
 *         description: Image ID
 *     responses:
 *       200:
 *         description: Image metadata with signed_url
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Image not found
 *       500:
 *         description: Server error
 */
router.get('/:id/images/:imageId', async (req, res) => {
  try {
    const image = await incidentImagesService.getImage(
      req.params.id,
      req.params.imageId,
      req.context
    );
    return res.json(image);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
});

module.exports = router;
