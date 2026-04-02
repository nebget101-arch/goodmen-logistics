const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const knex = require('../config/knex');
const emService = require('../services/employment-application.service');
const { getSignedDownloadUrl } = require('../storage/r2-storage');

router.use(authMiddleware);

/**
 * @openapi
 * /api/employment/applications:
 *   post:
 *     summary: Create a draft employment application
 *     description: Creates a new draft employment application for a driver. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               driverId:
 *                 type: string
 *                 description: The driver ID (defaults to authenticated user ID if omitted)
 *               operatingEntityId:
 *                 type: string
 *                 description: Operating entity ID to associate with the application
 *     responses:
 *       200:
 *         description: Draft application created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
// Create draft
router.post('/applications', async (req, res) => {
  try {
    const driverId = req.body.driverId || req.context?.userId || req.user?.id;
    const userId = req.context?.userId || req.user?.id || null;
    // FN-548: Merge operatingEntityId from request body into context so it persists on the application record
    const context = { ...req.context, operatingEntityId: req.body.operatingEntityId || req.context?.operatingEntityId || null };
    const row = await emService.createDraft(driverId, req.body, userId, context);
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * @openapi
 * /api/employment/applications/{id}:
 *   put:
 *     summary: Update a draft employment application
 *     description: Updates an existing draft employment application. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The application ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               operatingEntityId:
 *                 type: string
 *                 description: Operating entity ID
 *     responses:
 *       200:
 *         description: Updated application
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
// Update draft
router.put('/applications/:id', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    // FN-548: Merge operatingEntityId from request body into context
    const context = { ...req.context, operatingEntityId: req.body.operatingEntityId || req.context?.operatingEntityId || null };
    const updated = await emService.updateDraft(req.params.id, req.body, userId, context);
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * @openapi
 * /api/employment/applications/{id}:
 *   get:
 *     summary: Get an employment application by ID
 *     description: Retrieves a single employment application by its ID. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The application ID
 *     responses:
 *       200:
 *         description: The employment application
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Application not found
 */
// Get by id
router.get('/applications/:id', async (req, res) => {
  try {
    const app = await emService.getById(req.params.id, req.context);
    if (!app) return res.status(404).json({ error: 'Not found' });
    res.json(app);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * @openapi
 * /api/employment/applications/driver/{driverId}:
 *   get:
 *     summary: Get employment applications by driver ID
 *     description: Retrieves all employment applications for a specific driver. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *         description: The driver ID
 *     responses:
 *       200:
 *         description: Array of employment applications for the driver
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
// Get by driverId
router.get('/applications/driver/:driverId', async (req, res) => {
  try {
    const apps = await emService.getByDriverId(req.params.driverId, req.context);
    res.json(apps);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * @openapi
 * /api/employment/applications/{id}/submit:
 *   post:
 *     summary: Submit an employment application
 *     description: Submits a draft employment application for processing. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The application ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Application submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
// Submit application
router.post('/applications/:id/submit', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const result = await emService.submitApplication(req.params.id, req.body, userId, req.context);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * @openapi
 * /api/employment/applications/{id}/document:
 *   get:
 *     summary: Get signed download URL for application document
 *     description: Returns a signed URL to download the PDF document for a submitted employment application. Per 49 CFR 391.21 — Application for employment.
 *     tags:
 *       - Employment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The application ID
 *     responses:
 *       200:
 *         description: Signed download URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   description: Signed URL to download the application PDF
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Document not found
 */
// Get signed URL for application document
router.get('/applications/:id/document', async (req, res) => {
  try {
    const app = await knex('employment_applications').where({ id: req.params.id }).first();
    if (!app || !app.pdf_storage_key) return res.status(404).json({ error: 'document not found' });
    const url = await getSignedDownloadUrl(app.pdf_storage_key);
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
