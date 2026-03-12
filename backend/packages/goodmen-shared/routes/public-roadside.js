const express = require('express');
const router = express.Router();
const roadsideService = require('../services/roadside.service');
const twilioService = require('../services/twilio.service');
const dtLogger = require('../utils/logger');

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

// Twilio webhook: Handle incoming/outgoing call instructions
// POST /webhooks/twilio/call?callId=...
router.post('/webhooks/call', async (req, res) => {
  try {
    const callId = req.query?.callId;
    const callData = twilioService.parseIncomingCallWebhook(req);

    dtLogger.info(`Twilio call webhook received for ${callId}`, {
      callSid: callData.callSid,
      callStatus: callData.callStatus
    });

    // Generate TwiML response for Twilio
    const twiml = twilioService.generateAiTwiml({
      message: `Thank you for calling FleetNeuron AI Roadside Support. Your call is being connected to our support team.`,
      collectDtmf: null,
      transferTo: null
    });

    res.type('text/xml');
    res.send(twiml);
  } catch (error) {
    dtLogger.error('Twilio call webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Twilio webhook: Handle call status updates
// POST /webhooks/twilio/status?callId=...
router.post('/webhooks/status', async (req, res) => {
  try {
    const callId = req.query?.callId;
    const statusData = twilioService.parseCallStatusWebhook(req);

    dtLogger.info(`Twilio call status update for ${callId}`, {
      callSid: statusData.callSid,
      callStatus: statusData.callStatus,
      callDuration: statusData.callDuration
    });

    // Log event in roadside call
    // Update roadside_event_logs with call status
    // This would be connected to the call data for analytics

    res.json({ ok: true });
  } catch (error) {
    dtLogger.error('Twilio status webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Twilio webhook: Handle call recording completion
// POST /webhooks/twilio/recording?callId=...
router.post('/webhooks/recording', async (req, res) => {
  try {
    const callId = req.query?.callId;
    const recordingData = twilioService.parseRecordingWebhook(req);

    dtLogger.info(`Twilio recording webhook for ${callId}`, {
      recordingSid: recordingData.recordingSid,
      recordingUrl: recordingData.recordingUrl,
      recordingDuration: recordingData.recordingDuration
    });

    // Store recording metadata in roadside_event_logs
    // Create media record with recording URL

    res.json({ ok: true });
  } catch (error) {
    dtLogger.error('Twilio recording webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
