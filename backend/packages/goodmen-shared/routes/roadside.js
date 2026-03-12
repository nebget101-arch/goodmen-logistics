const express = require('express');
const router = express.Router();
const roadsideService = require('../services/roadside.service');

// POST /api/roadside/calls
router.post('/calls', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const created = await roadsideService.createCall(req.body, userId, req.context);
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/roadside/calls
router.get('/calls', async (req, res) => {
  try {
    const rows = await roadsideService.listCalls(req.query, req.context);
    res.json(rows);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/roadside/calls/:id
router.get('/calls/:id', async (req, res) => {
  try {
    const row = await roadsideService.getCall(req.params.id, req.context);
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json(row);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// PATCH /api/roadside/calls/:id/status
router.patch('/calls/:id/status', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const row = await roadsideService.setStatus(req.params.id, req.body.status, userId, req.context);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/triage
router.post('/calls/:id/triage', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const row = await roadsideService.triage(req.params.id, req.body, userId, req.context);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/dispatch
router.post('/calls/:id/dispatch', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const row = await roadsideService.assignDispatch(req.params.id, req.body, userId, req.context);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/resolve
router.post('/calls/:id/resolve', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const row = await roadsideService.resolveCall(req.params.id, req.body, userId, req.context);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/work-order
router.post('/calls/:id/work-order', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const row = await roadsideService.linkWorkOrder(req.params.id, req.body, userId, req.context);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/media/upload-url
router.post('/calls/:id/media/upload-url', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const upload = await roadsideService.createMediaUploadUrl(req.params.id, req.body, userId, req.context);
    res.json(upload);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/media
router.post('/calls/:id/media', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const media = await roadsideService.addMedia(req.params.id, req.body, userId, req.context);
    res.status(201).json(media);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/public-link
router.post('/calls/:id/public-link', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const link = await roadsideService.createPublicToken(req.params.id, req.body, userId, req.context);
    res.json(link);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/notify
router.post('/calls/:id/notify', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const result = await roadsideService.notifyCall(req.params.id, req.body, userId, req.context);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/roadside/calls/:id/timeline
router.get('/calls/:id/timeline', async (req, res) => {
  try {
    const timeline = await roadsideService.getTimeline(req.params.id, req.context);
    if (!timeline) return res.status(404).json({ error: 'Not found' });
    return res.json(timeline);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
