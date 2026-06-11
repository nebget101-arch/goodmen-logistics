'use strict';

/**
 * FN-1222: Twilio voice intake controller.
 *
 * Handles:
 *  POST /voice/incoming   — Twilio webhook for inbound calls; returns TwiML
 *                           that plays the GDPR consent message and opens a
 *                           Media Streams WebSocket.
 *  POST /voice/consent    — Twilio <Gather> digit webhook; records consent
 *                           decision and either connects ASR or rejects.
 *  WebSocket /voice/stream — Twilio Media Streams connection; feeds audio to
 *                            AsrSession and emits transcript events.
 */

const didMappingService = require('./did-mapping.service');
const consentService = require('./consent.service');
const { createAsrSession } = require('./asr.service');
const { logAiInteraction } = require('../analytics/logger');

const CONSENT_MESSAGE =
  'This call may be recorded for quality and service purposes. ' +
  'Press 1 to agree and continue, or press 2 to decline. ';

function buildTwiml(xml) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${xml}</Response>`;
}

function rejectCall(reason) {
  return buildTwiml('<Say>We are unable to process your call at this time.</Say><Hangup/>');
}

async function handleIncoming(req, res, { consentBaseUrl } = {}) {
  const startedAt = Date.now();
  const called = req.body && (req.body.Called || req.body.To);
  const callSid = req.body && req.body.CallSid;

  if (!called || !callSid) {
    res.status(400).type('text/xml').send(rejectCall('missing params'));
    return;
  }

  let tenantId;
  try {
    tenantId = await didMappingService.lookupTenant(called, { db: req.app.locals.db });
  } catch (err) {
    logAiInteraction({ route: '/voice/incoming', success: false, errorCode: 'DID_LOOKUP_ERROR', processingTimeMs: Date.now() - startedAt });
    res.status(500).type('text/xml').send(rejectCall('lookup error'));
    return;
  }

  if (!tenantId) {
    logAiInteraction({ route: '/voice/incoming', success: false, errorCode: 'DID_UNMAPPED', processingTimeMs: Date.now() - startedAt });
    res.type('text/xml').send(buildTwiml('<Say>This number is not registered. Goodbye.</Say><Hangup/>'));
    return;
  }

  req.app.locals.pendingCalls = req.app.locals.pendingCalls || {};
  req.app.locals.pendingCalls[callSid] = { tenantId, called };

  const base = consentBaseUrl || process.env.VOICE_BASE_URL || '';
  const consentUrl = `${base}/api/voice/consent`;

  logAiInteraction({ route: '/voice/incoming', success: true, processingTimeMs: Date.now() - startedAt });

  res.type('text/xml').send(buildTwiml(
    `<Gather numDigits="1" action="${consentUrl}" method="POST">` +
    `<Say>${CONSENT_MESSAGE}</Say>` +
    `</Gather>` +
    `<Say>We did not receive your input. Goodbye.</Say><Hangup/>`
  ));
}

async function handleConsentGather(req, res) {
  const startedAt = Date.now();
  const digit = req.body && req.body.Digits;
  const callSid = req.body && req.body.CallSid;
  const called = req.body && (req.body.Called || req.body.To);

  const pendingCalls = req.app.locals.pendingCalls || {};
  const callInfo = pendingCalls[callSid] || {};
  const tenantId = callInfo.tenantId;
  const did = callInfo.called || called;

  const granted = digit === '1';

  try {
    await consentService.recordConsent(callSid, tenantId, did, granted, { db: req.app.locals.db });
  } catch (err) {
    logAiInteraction({ route: '/voice/consent', success: false, errorCode: 'CONSENT_WRITE_ERROR', processingTimeMs: Date.now() - startedAt });
  }

  logAiInteraction({
    route: '/voice/consent',
    success: true,
    errorCode: granted ? null : 'CONSENT_DECLINED',
    processingTimeMs: Date.now() - startedAt
  });

  if (!granted) {
    res.type('text/xml').send(buildTwiml('<Say>Thank you. Goodbye.</Say><Hangup/>'));
    return;
  }

  const streamUrl = (process.env.VOICE_WS_URL || process.env.VOICE_BASE_URL || '').replace(/^https?/, 'wss') + '/api/voice/stream';

  res.type('text/xml').send(buildTwiml(
    `<Start><Stream url="${streamUrl}"/></Start>` +
    `<Say>Thank you. Please describe your roadside issue after the tone.</Say>` +
    `<Pause length="60"/>`
  ));
}

function handleMediaStream(ws, req) {
  const callSid = req.query && req.query.callSid;
  const session = createAsrSession(callSid || 'unknown', {
    onTranscript: (evt) => {
      logAiInteraction({ route: '/voice/stream', success: true, errorCode: evt.type === 'final' ? null : 'interim' });
    }
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      return;
    }
    session.handleMessage(msg);
  });

  ws.on('close', () => {
    session.handleMessage({ event: 'stop' });
  });

  ws.on('error', (err) => {
    logAiInteraction({ route: '/voice/stream', success: false, errorCode: 'WS_ERROR' });
    session.emit('error', err);
  });
}

module.exports = {
  handleIncoming,
  handleConsentGather,
  handleMediaStream,
  CONSENT_MESSAGE
};
