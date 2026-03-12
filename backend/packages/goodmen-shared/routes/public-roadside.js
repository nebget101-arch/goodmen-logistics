const express = require('express');
const router = express.Router();
const roadsideService = require('../services/roadside.service');

// GET /public/roadside/:callId?token=...
router.get('/:callId', async (req, res) => {
  try {
    const token = req.query?.token;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const call = await roadsideService.getPublicCallByToken(token);
    if (!call || call.call_id !== req.params.callId) {
      return res.status(404).json({ error: 'Not found or expired link' });
    }
    return res.json(call);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// POST /public/roadside/:callId/media?token=...
router.post('/:callId/media', async (req, res) => {
  try {
    const token = req.query?.token;
    if (!token) return res.status(400).json({ error: 'token is required' });
    if (!req.body?.storage_key) return res.status(400).json({ error: 'storage_key is required' });

    const call = await roadsideService.getPublicCallByToken(token);
    if (!call || call.call_id !== req.params.callId) {
      return res.status(404).json({ error: 'Not found or expired link' });
    }

    const media = await roadsideService.addPublicMedia(token, req.body);
    return res.status(201).json(media);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// POST /public/roadside/:callId/media/upload-url?token=...
router.post('/:callId/media/upload-url', async (req, res) => {
  try {
    const token = req.query?.token;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const call = await roadsideService.getPublicCallByToken(token);
    if (!call || call.call_id !== req.params.callId) {
      return res.status(404).json({ error: 'Not found or expired link' });
    }

    const upload = await roadsideService.createPublicMediaUploadUrl(token, req.body || {});
    return res.json(upload);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// POST /public/roadside/:callId/context?token=...
router.post('/:callId/context', async (req, res) => {
  try {
    const token = req.query?.token;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const call = await roadsideService.getPublicCallByToken(token);
    if (!call || call.call_id !== req.params.callId) {
      return res.status(404).json({ error: 'Not found or expired link' });
    }

    const updated = await roadsideService.updatePublicContext(token, req.body || {});
    return res.json(updated);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// POST /public/roadside/:callId/complete?token=...
router.post('/:callId/complete', async (req, res) => {
  try {
    const token = req.query?.token;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const call = await roadsideService.getPublicCallByToken(token);
    if (!call || call.call_id !== req.params.callId) {
      return res.status(404).json({ error: 'Not found or expired link' });
    }

    await roadsideService.markPublicTokenUsed(token);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
