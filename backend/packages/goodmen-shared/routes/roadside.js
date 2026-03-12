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

// POST /api/roadside/calls/:id/ai-call
// Initiate an AI voice call to the caller's phone number
router.post('/calls/:id/ai-call', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const { toPhone, message, autoAnswer } = req.body;

    if (!toPhone) {
      return res.status(400).json({ error: 'toPhone is required' });
    }

    const result = await roadsideService.initiateAiCall(req.params.id, toPhone, {
      message,
      autoAnswer,
      userId
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/notify-dispatcher
// Send notification email(s) to dispatcher(s)
router.post('/calls/:id/notify-dispatcher', async (req, res) => {
  try {
    const { emails, url } = req.body;

    if (!emails || emails.length === 0) {
      return res.status(400).json({ error: 'emails array is required' });
    }

    const result = await roadsideService.notifyDispatcherNewCall(
      req.params.id,
      { emails, url }
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/notify-dispatch-assigned
// Send notification emails when dispatch is assigned
router.post('/calls/:id/notify-dispatch-assigned', async (req, res) => {
  try {
    const result = await roadsideService.notifyDispatchAssigned(
      req.params.id,
      req.body
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/notify-resolved
// Send notification emails when call is resolved
router.post('/calls/:id/notify-resolved', async (req, res) => {
  try {
    const result = await roadsideService.notifyCallResolved(
      req.params.id,
      req.body
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/roadside/calls/:id/notify-payment-contact
// Send billing notification to payment contact
router.post('/calls/:id/notify-payment-contact', async (req, res) => {
  try {
    const result = await roadsideService.notifyPaymentContact(
      req.params.id,
      req.body
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/roadside/calls/:id/recording
// Get Twilio call recording URL if available
router.get('/calls/:id/recording', async (req, res) => {
  try {
    const recordingUrl = await roadsideService.getTwilioCallRecording(req.params.id);

    if (!recordingUrl) {
      return res.status(404).json({ error: 'No recording found' });
    }

    res.json({ recording_url: recordingUrl });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
