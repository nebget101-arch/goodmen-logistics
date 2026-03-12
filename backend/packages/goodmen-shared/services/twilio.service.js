/**
 * Twilio Service: Handle voice calls, call recordings, and call status
 * Supports answering AI calls, transferring to humans, recording calls, and webhooks
 *
 * Env vars (required):
 *   TWILIO_ACCOUNT_SID - Twilio Account SID
 *   TWILIO_AUTH_TOKEN - Twilio Auth Token
 *   TWILIO_PHONE_NUMBER - Twilio phone number for outbound calls
 *   TWILIO_TWIML_URL - Base URL for TwiML (callback for call instructions)
 */

const twilio = require('twilio');
const dtLogger = require('../utils/logger');

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;
const TWIML_URL = process.env.TWILIO_TWIML_URL || 'http://localhost:3000/webhooks/twilio/call';

let twilioClient = null;
if (TWILIO_SID && TWILIO_TOKEN) {
  twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
}

/**
 * Normalize phone to E.164 format for Twilio
 * @param {string} phone
 * @returns {string|null}
 */
function toE164(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return null;
}

/**
 * Initiate an outbound call to a phone number
 * @param {object} params
 * @param {string} params.toPhone - Recipient phone number
 * @param {string} params.callId - Roadside call ID
 * @param {string} params.callerName - Caller name for display
 * @param {string} [params.twimlUrl] - Custom TwiML URL (default: TWIML_URL)
 * @returns {Promise<{ success: boolean, callSid?: string, error?: string }>}
 */
async function initiateCall({ toPhone, callId, callerName, twimlUrl }) {
  if (!twilioClient || !TWILIO_FROM) {
    return {
      success: false,
      error: 'Twilio not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)'
    };
  }

  const to = toE164(toPhone);
  if (!to) {
    return { success: false, error: 'Invalid phone number format' };
  }

  try {
    const url = twimlUrl || `${TWIML_URL}?callId=${encodeURIComponent(callId)}`;
    const call = await twilioClient.calls.create({
      to,
      from: TWILIO_FROM,
      url,
      statusCallback: `${TWIML_URL.replace('/call', '/status')}?callId=${encodeURIComponent(callId)}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      record: true,
      recordingStatusCallback: `${TWIML_URL.replace('/call', '/recording')}?callId=${encodeURIComponent(callId)}`
    });

    dtLogger.info(`Twilio: Initiated call ${call.sid} to ${to} for roadside call ${callId}`);
    return { success: true, callSid: call.sid };
  } catch (err) {
    const message = err.message || String(err);
    dtLogger.error(`Twilio call initiation error: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Get call details from Twilio
 * @param {string} callSid - Twilio call SID
 * @returns {Promise<object|null>}
 */
async function getCallDetails(callSid) {
  if (!twilioClient) return null;

  try {
    const call = await twilioClient.calls(callSid).fetch();
    return {
      sid: call.sid,
      status: call.status,
      duration: call.duration,
      startTime: call.startTime,
      endTime: call.endTime,
      to: call.to,
      from: call.from,
      direction: call.direction,
      answeredBy: call.answeredBy
    };
  } catch (err) {
    dtLogger.error(`Twilio fetch call error: ${err.message}`);
    return null;
  }
}

/**
 * Get recording URL for a call
 * @param {string} callSid - Twilio call SID
 * @returns {Promise<string|null>}
 */
async function getCallRecordingUrl(callSid) {
  if (!twilioClient) return null;

  try {
    const recordings = await twilioClient.calls(callSid).recordings.list({ limit: 1 });
    if (recordings.length === 0) return null;

    const recording = recordings[0];
    return `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Recordings/${recording.sid}.wav`;
  } catch (err) {
    dtLogger.error(`Twilio fetch recording error: ${err.message}`);
    return null;
  }
}

/**
 * Generate TwiML for AI voice response
 * @param {object} options
 * @param {string} options.message - Initial message to play
 * @param {string} [options.collectDtmf] - Digits to collect (e.g., '1')
 * @param {string} [options.transferTo] - Phone number to transfer to
 * @returns {string} TwiML XML
 */
function generateAiTwiml({ message, collectDtmf, transferTo }) {
  let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';

  // Play initial message
  if (message) {
    twiml += `<Say voice="alice">${escapeXml(message)}</Say>`;
  }

  // Collect DTMF input if specified
  if (collectDtmf) {
    twiml += `<Gather numDigits="${collectDtmf.length}" timeout="5">
      <Say voice="alice">Press ${collectDtmf.split('').join(' or ')} to continue.</Say>
    </Gather>`;
  }

  // Transfer to human if specified
  if (transferTo) {
    const phoneE164 = toE164(transferTo);
    if (phoneE164) {
      twiml += `<Dial>${phoneE164}</Dial>`;
    }
  }

  twiml += '</Response>';
  return twiml;
}

/**
 * Generate TwiML for interactive Q&A with speech/DTMF gather.
 * @param {object} options
 * @param {string} [options.introMessage]
 * @param {string} [options.question]
 * @param {string} [options.actionUrl]
 * @param {string} [options.finishMessage]
 * @returns {string}
 */
function generateQuestionFlowTwiml({ introMessage, question, actionUrl, finishMessage }) {
  let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';

  if (introMessage) {
    twiml += `<Say voice="alice">${escapeXml(introMessage)}</Say>`;
  }

  if (question && actionUrl) {
    twiml += `<Gather input="speech dtmf" timeout="6" speechTimeout="auto" method="POST" action="${escapeXml(actionUrl)}">`;
    twiml += `<Say voice="alice">${escapeXml(question)}</Say>`;
    twiml += '</Gather>';
    twiml += '<Say voice="alice">I did not receive a response. We will continue and a dispatcher can follow up.</Say>';
  } else if (finishMessage) {
    twiml += `<Say voice="alice">${escapeXml(finishMessage)}</Say>`;
  }

  twiml += '</Response>';
  return twiml;
}

/**
 * Escape XML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Create a Twilio Studio flow for complex IVR
 * (Note: Requires Studio API - not implemented here, use Twilio console for complex flows)
 */

/**
 * Handle incoming call webhook - parse call details
 * @param {object} req - Express request with Twilio webhook data
 * @returns {object} Parsed call info
 */
function parseIncomingCallWebhook(req) {
  return {
    callSid: req.body?.CallSid,
    accountSid: req.body?.AccountSid,
    from: req.body?.From,
    to: req.body?.To,
    callStatus: req.body?.CallStatus,
    direction: req.body?.Direction,
    apiVersion: req.body?.ApiVersion
  };
}

/**
 * Handle call status webhook - parse updated status
 * @param {object} req - Express request with Twilio webhook data
 * @returns {object} Parsed status info
 */
function parseCallStatusWebhook(req) {
  return {
    callSid: req.body?.CallSid,
    callStatus: req.body?.CallStatus,
    callDuration: req.body?.CallDuration,
    recordingUrl: req.body?.RecordingUrl,
    recordingSid: req.body?.RecordingSid
  };
}

/**
 * Handle recording status webhook
 * @param {object} req - Express request with Twilio webhook data
 * @returns {object} Parsed recording info
 */
function parseRecordingWebhook(req) {
  return {
    recordingSid: req.body?.RecordingSid,
    recordingUrl: req.body?.RecordingUrl,
    recordingStatus: req.body?.RecordingStatus,
    recordingDuration: req.body?.RecordingDuration,
    callSid: req.body?.CallSid
  };
}

module.exports = {
  initiateCall,
  getCallDetails,
  getCallRecordingUrl,
  generateAiTwiml,
  generateQuestionFlowTwiml,
  escapeXml,
  toE164,
  parseIncomingCallWebhook,
  parseCallStatusWebhook,
  parseRecordingWebhook,
  isConfigured: () => !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM)
};
