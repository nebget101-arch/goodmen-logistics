const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const knex = require('../config/knex');
const emService = require('../services/employment-application.service');
const { getSignedDownloadUrl } = require('../storage/r2-storage');

router.use(authMiddleware);

// Create draft
router.post('/applications', async (req, res) => {
  try {
    const driverId = req.body.driverId || req.context?.userId || req.user?.id;
    const userId = req.context?.userId || req.user?.id || null;
    const row = await emService.createDraft(driverId, req.body, userId, req.context);
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update draft
router.put('/applications/:id', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const updated = await emService.updateDraft(req.params.id, req.body, userId, req.context);
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

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

// Get by driverId
router.get('/applications/driver/:driverId', async (req, res) => {
  try {
    const apps = await emService.getByDriverId(req.params.driverId, req.context);
    res.json(apps);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

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
