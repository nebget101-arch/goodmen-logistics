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

function pickLast(value) {
  if (Array.isArray(value)) return value[value.length - 1];
  return value;
}

async function handleTwilioCallWebhook(req, res) {
  try {
    const callData = twilioService.parseIncomingCallWebhook(req);
    let call = null;
    let callId = pickLast(req.query?.callId) || pickLast(req.body?.callId);

    const configuredWebhookBaseUrl = (process.env.TWILIO_TWIML_URL || '').trim();
    const webhookBaseUrl = configuredWebhookBaseUrl
      || `${req.protocol}://${req.get('host')}${req.baseUrl}${req.path}`;
    const questionIndexRaw = Number(pickLast(req.query?.q) ?? pickLast(req.body?.q));
    const hasQuestionIndex = Number.isInteger(questionIndexRaw) && questionIndexRaw >= 0;

    const speechAnswer = String(pickLast(req.body?.SpeechResult) || pickLast(req.query?.SpeechResult) || '').trim();
    const digitAnswer = String(pickLast(req.body?.Digits) || pickLast(req.query?.Digits) || '').trim();
    const answerText = speechAnswer || digitAnswer;
    const answerInputType = speechAnswer ? 'speech' : (digitAnswer ? 'dtmf' : null);
    const confidenceRaw = pickLast(req.body?.Confidence) ?? pickLast(req.query?.Confidence);
    const confidence = Number.isFinite(Number(confidenceRaw)) ? Number(confidenceRaw) : null;

    if (callId) {
      call = await roadsideService.getCall(callId, { isGlobalAdmin: true });
    } else {
      const created = await roadsideService.createInboundTwilioCall(callData);
      callId = created?.id;
      call = callId ? await roadsideService.getCall(callId, { isGlobalAdmin: true }) : null;
    }

    if (!callId || !call) {
      throw new Error('Unable to resolve or create roadside call for Twilio webhook');
    }

    if (answerText && hasQuestionIndex) {
      await roadsideService.appendInboundAiAnswer(callId, {
        answer: answerText,
        question_index: questionIndexRaw,
        call_sid: callData.callSid,
        input_type: answerInputType,
        confidence
      });

      call = await roadsideService.getCall(callId, { isGlobalAdmin: true });
    }

    dtLogger.info(`Twilio call webhook received for ${callId}`, {
      callSid: callData.callSid,
      callStatus: callData.callStatus,
      from: callData.from,
      questionIndex: hasQuestionIndex ? questionIndexRaw : null,
      answerCaptured: !!answerText
    });

    const questions = Array.isArray(call?.ai_questions) ? call.ai_questions : [];
    const nextQuestionIndex = hasQuestionIndex
      ? (answerText ? questionIndexRaw + 1 : questionIndexRaw)
      : 0;

    let twiml = '';

    if (nextQuestionIndex < questions.length) {
      const nextQuestion = questions[nextQuestionIndex];
      const alreadyLogged = Array.isArray(call?.ai_qa_history)
        ? call.ai_qa_history.some((entry) => entry.question_index === nextQuestionIndex && !!entry.question)
        : false;

      if (!alreadyLogged) {
        await roadsideService.appendInboundAiQuestion(callId, {
          question: nextQuestion,
          question_index: nextQuestionIndex,
          call_sid: callData.callSid
        });
      }

      const introMessage = !hasQuestionIndex
        ? `Thank you for calling FleetNeuron AI Roadside Support. Your roadside request ${call.call_number || ''} has been created. Please answer a few quick questions.`
        : (!answerText ? 'I did not hear a response. Please answer the next question.' : null);

      const actionUrl = `${webhookBaseUrl}?callId=${encodeURIComponent(callId)}&q=${nextQuestionIndex}`;
      twiml = twilioService.generateQuestionFlowTwiml({
        introMessage,
        question: nextQuestion,
        actionUrl
      });
    } else {
      twiml = twilioService.generateQuestionFlowTwiml({
        finishMessage: 'Thank you. We captured your responses and will dispatch support shortly. Goodbye.'
      });
    }

    res.type('text/xml');
    res.send(twiml);
  } catch (error) {
    dtLogger.error('Twilio call webhook error:', error);
    res.status(400).json({ error: error.message });
  }
}

// Twilio webhook: Handle incoming/outgoing call instructions
// POST/GET /webhooks/twilio/call?callId=...&q=...
router.post('/webhooks/call', handleTwilioCallWebhook);
router.get('/webhooks/call', handleTwilioCallWebhook);
router.post('/webhooks/twilio/call', handleTwilioCallWebhook);
router.get('/webhooks/twilio/call', handleTwilioCallWebhook);

// Twilio webhook: Handle call status updates
// POST /webhooks/twilio/status?callId=...
router.post('/webhooks/status', async (req, res) => {
  try {
    const statusData = twilioService.parseCallStatusWebhook(req);
    let callId = req.query?.callId;

    if (!callId && statusData.callSid) {
      const call = await roadsideService.findCallByTwilioCallSid(statusData.callSid);
      callId = call?.id;
    }

    dtLogger.info(`Twilio call status update for ${callId}`, {
      callSid: statusData.callSid,
      callStatus: statusData.callStatus,
      callDuration: statusData.callDuration
    });

    if (callId) {
      await roadsideService.logTwilioCallStatus(callId, statusData);
      if (['completed', 'canceled', 'busy', 'failed', 'no-answer'].includes(String(statusData.callStatus || '').toLowerCase())) {
        await roadsideService.endActiveSession(callId);
      }
    }

    res.json({ ok: true });
  } catch (error) {
    dtLogger.error('Twilio status webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});
router.post('/webhooks/twilio/status', async (req, res) => {
  try {
    const statusData = twilioService.parseCallStatusWebhook(req);
    let callId = req.query?.callId;

    if (!callId && statusData.callSid) {
      const call = await roadsideService.findCallByTwilioCallSid(statusData.callSid);
      callId = call?.id;
    }

    dtLogger.info(`Twilio call status update for ${callId}`, {
      callSid: statusData.callSid,
      callStatus: statusData.callStatus,
      callDuration: statusData.callDuration
    });

    if (callId) {
      await roadsideService.logTwilioCallStatus(callId, statusData);
      if (['completed', 'canceled', 'busy', 'failed', 'no-answer'].includes(String(statusData.callStatus || '').toLowerCase())) {
        await roadsideService.endActiveSession(callId);
      }
    }

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
    const recordingData = twilioService.parseRecordingWebhook(req);
    let callId = req.query?.callId;

    if (!callId && recordingData.callSid) {
      const call = await roadsideService.findCallByTwilioCallSid(recordingData.callSid);
      callId = call?.id;
    }

    dtLogger.info(`Twilio recording webhook for ${callId}`, {
      recordingSid: recordingData.recordingSid,
      recordingUrl: recordingData.recordingUrl,
      recordingDuration: recordingData.recordingDuration
    });

    if (callId) {
      await roadsideService.logTwilioRecording(callId, recordingData);
    }

    res.json({ ok: true });
  } catch (error) {
    dtLogger.error('Twilio recording webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});
router.post('/webhooks/twilio/recording', async (req, res) => {
  try {
    const recordingData = twilioService.parseRecordingWebhook(req);
    let callId = req.query?.callId;

    if (!callId && recordingData.callSid) {
      const call = await roadsideService.findCallByTwilioCallSid(recordingData.callSid);
      callId = call?.id;
    }

    dtLogger.info(`Twilio recording webhook for ${callId}`, {
      recordingSid: recordingData.recordingSid,
      recordingUrl: recordingData.recordingUrl,
      recordingDuration: recordingData.recordingDuration
    });

    if (callId) {
      await roadsideService.logTwilioRecording(callId, recordingData);
    }

    res.json({ ok: true });
  } catch (error) {
    dtLogger.error('Twilio recording webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
