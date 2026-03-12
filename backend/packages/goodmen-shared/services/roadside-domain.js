const ROADSIDE_CALL_SOURCE_CHANNELS = Object.freeze(['PHONE', 'SMS', 'APP', 'WEB', 'DISPATCH']);
const ROADSIDE_CALL_URGENCY = Object.freeze(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
const ROADSIDE_CALL_STATUS = Object.freeze([
  'OPEN',
  'TRIAGED',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SCENE',
  'TOWING',
  'RESOLVED',
  'CANCELED'
]);

const ROADSIDE_SESSION_STATUS = Object.freeze(['ACTIVE', 'ENDED', 'EXPIRED']);
const ROADSIDE_INTAKE_SOURCE = Object.freeze(['AI_AGENT', 'HUMAN_AGENT', 'DRIVER_SELF']);
const ROADSIDE_MEDIA_TYPE = Object.freeze(['PHOTO', 'VIDEO', 'AUDIO', 'DOCUMENT']);
const ROADSIDE_LOCATION_SOURCE = Object.freeze(['GPS', 'MANUAL', 'TELEMATICS']);
const ROADSIDE_RISK_LEVEL = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const ROADSIDE_DISPATCH_STATUS = Object.freeze(['PENDING', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'COMPLETED', 'CANCELED']);
const ROADSIDE_PAYER_TYPE = Object.freeze(['COMPANY', 'DRIVER', 'CUSTOMER', 'INSURANCE', 'OTHER']);
const ROADSIDE_PAYMENT_STATUS = Object.freeze(['UNPAID', 'PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED']);
const ROADSIDE_ACTOR_TYPE = Object.freeze(['SYSTEM', 'AI', 'USER', 'DRIVER', 'DISPATCHER']);
const ROADSIDE_PUBLIC_TOKEN_STATUS = Object.freeze(['ACTIVE', 'USED', 'EXPIRED', 'REVOKED']);
const ROADSIDE_WORK_ORDER_LINK_STATUS = Object.freeze(['PENDING', 'CREATED', 'LINKED', 'CLOSED', 'FAILED']);

const ROADSIDE_CONFIDENCE_TIER = Object.freeze(['LOW_CONFIDENCE', 'MEDIUM_CONFIDENCE', 'HIGH_CONFIDENCE']);

const ROADSIDE_ISSUE_TYPE = Object.freeze([
  'FLAT_TIRE',
  'BATTERY',
  'ENGINE',
  'BRAKE',
  'TRANSMISSION',
  'ELECTRICAL',
  'ACCIDENT',
  'LOCKOUT',
  'FUEL',
  'TOW_REQUIRED',
  'OTHER'
]);

function enumIncludes(enumValues, value) {
  return enumValues.includes(value);
}

function normalizeEnum(value, enumValues, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  const normalized = value.trim().toUpperCase();
  return enumIncludes(enumValues, normalized) ? normalized : fallback;
}

function resolveConfidenceTier(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'LOW_CONFIDENCE';
  if (n >= 85) return 'HIGH_CONFIDENCE';
  if (n >= 60) return 'MEDIUM_CONFIDENCE';
  return 'LOW_CONFIDENCE';
}

/**
 * @typedef {Object} RoadsideCallDraft
 * @property {string} [source_channel]
 * @property {string} [urgency]
 * @property {string} [status]
 * @property {string} [issue_type]
 * @property {string} [incident_summary]
 * @property {string} [caller_name]
 * @property {string} [caller_phone]
 * @property {string} [caller_email]
 */

/**
 * @param {RoadsideCallDraft} payload
 */
function normalizeRoadsideCallDraft(payload = {}) {
  return {
    source_channel: normalizeEnum(payload.source_channel, ROADSIDE_CALL_SOURCE_CHANNELS, 'PHONE'),
    urgency: normalizeEnum(payload.urgency, ROADSIDE_CALL_URGENCY, 'NORMAL'),
    status: normalizeEnum(payload.status, ROADSIDE_CALL_STATUS, 'OPEN'),
    issue_type: normalizeEnum(payload.issue_type, ROADSIDE_ISSUE_TYPE, 'OTHER'),
    incident_summary: payload.incident_summary || null,
    caller_name: payload.caller_name || null,
    caller_phone: payload.caller_phone || null,
    caller_email: payload.caller_email || null
  };
}

module.exports = {
  ROADSIDE_CALL_SOURCE_CHANNELS,
  ROADSIDE_CALL_URGENCY,
  ROADSIDE_CALL_STATUS,
  ROADSIDE_SESSION_STATUS,
  ROADSIDE_INTAKE_SOURCE,
  ROADSIDE_MEDIA_TYPE,
  ROADSIDE_LOCATION_SOURCE,
  ROADSIDE_RISK_LEVEL,
  ROADSIDE_DISPATCH_STATUS,
  ROADSIDE_PAYER_TYPE,
  ROADSIDE_PAYMENT_STATUS,
  ROADSIDE_ACTOR_TYPE,
  ROADSIDE_PUBLIC_TOKEN_STATUS,
  ROADSIDE_WORK_ORDER_LINK_STATUS,
  ROADSIDE_CONFIDENCE_TIER,
  ROADSIDE_ISSUE_TYPE,
  normalizeEnum,
  resolveConfidenceTier,
  normalizeRoadsideCallDraft
};
