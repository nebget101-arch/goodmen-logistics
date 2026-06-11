'use strict';

/**
 * FN-1215: Roadside incident triage service (Anthropic Claude + prompt caching).
 *
 * Classifies an inbound roadside incident into severity, serviceCategory,
 * urgency, and vendorSkills. Uses prompt caching on two static blocks:
 *   1. triage.system.md — shared role/rules prompt
 *   2. triage.policy.md — escalation and disambiguation policies
 * Per-request data (redacted description + context) goes in the user message
 * and is NOT cached.
 */

const fs = require('node:fs');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');
const { redact } = require('./redactor');
const { emitSuccess, emitFailure } = require('../telemetry/triage.telemetry');

const PROMPT_VERSION = 'v1';
const MODEL_ENV = 'ANTHROPIC_TRIAGE_MODEL';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const VALID_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const VALID_CATEGORIES = [
  'TOWING', 'TIRE_CHANGE', 'JUMP_START', 'FUEL_DELIVERY',
  'LOCKOUT', 'ACCIDENT_RECOVERY', 'MECHANICAL', 'OTHER'
];
const VALID_URGENCIES = ['IMMEDIATE', 'WITHIN_HOUR', 'SCHEDULED'];

let cachedSystemPrompt = null;
let cachedPolicyPrompt = null;

function loadSystemPrompt() {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  cachedSystemPrompt = fs.readFileSync(
    path.join(__dirname, 'prompts', 'triage.system.md'),
    'utf8'
  );
  return cachedSystemPrompt;
}

function loadPolicyPrompt() {
  if (cachedPolicyPrompt) return cachedPolicyPrompt;
  cachedPolicyPrompt = fs.readFileSync(
    path.join(__dirname, 'prompts', 'triage.policy.md'),
    'utf8'
  );
  return cachedPolicyPrompt;
}

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return anthropicClient;
}

function buildUserMessage({ description, tenantId, vehicleType, location, tenantPolicy }) {
  const payload = {
    description,
    tenantId,
    vehicleType: vehicleType || null,
    location: location || null
  };
  if (tenantPolicy) {
    payload.tenantPolicyOverride = tenantPolicy;
  }
  return JSON.stringify(payload);
}

function parseAndValidate(raw) {
  let parsed;
  try {
    const cleaned = (raw || '').trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (_e) {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const severity = typeof parsed.severity === 'string' ? parsed.severity.toUpperCase() : null;
  const serviceCategory = typeof parsed.serviceCategory === 'string' ? parsed.serviceCategory.toUpperCase() : null;
  const urgency = typeof parsed.urgency === 'string' ? parsed.urgency.toUpperCase() : null;

  if (!VALID_SEVERITIES.includes(severity)) return null;
  if (!VALID_CATEGORIES.includes(serviceCategory)) return null;
  if (!VALID_URGENCIES.includes(urgency)) return null;

  const vendorSkills = Array.isArray(parsed.vendorSkills) && parsed.vendorSkills.length > 0
    ? parsed.vendorSkills.filter(s => typeof s === 'string' && s.trim())
    : null;
  if (!vendorSkills) return null;

  const rationale = typeof parsed.rationale === 'string' && parsed.rationale.trim()
    ? parsed.rationale.trim()
    : null;
  if (!rationale) return null;

  return {
    severity,
    serviceCategory,
    urgency,
    vendorSkills,
    rationale,
    safetyRisk: parsed.safetyRisk === true
  };
}

/**
 * Triage an inbound roadside incident.
 *
 * @param {object} incident
 * @param {string} incident.tenantId
 * @param {string} incident.description   Free-text from driver or dispatcher
 * @param {string} [incident.vehicleType] e.g. "semi", "pickup", "box truck"
 * @param {string} [incident.location]    e.g. "I-35 northbound near exit 42"
 * @param {string} [incident.tenantPolicy] Tenant-specific policy override text
 * @param {object} [deps]  Injectable deps for testing (deps.anthropic)
 * @returns {Promise<object>} Triage record
 */
async function triageIncident(incident, deps) {
  const { tenantId, description, vehicleType, location, tenantPolicy } = incident;

  const { redacted, counts: redactionCounts } = redact(description);

  const startedAt = Date.now();
  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env[MODEL_ENV] || DEFAULT_MODEL;

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: 512,
      temperature: 0,
      system: [
        {
          type: 'text',
          text: loadSystemPrompt(),
          cache_control: { type: 'ephemeral' }
        },
        {
          type: 'text',
          text: loadPolicyPrompt(),
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        {
          role: 'user',
          content: buildUserMessage({ description: redacted, tenantId, vehicleType, location, tenantPolicy })
        }
      ]
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    emitFailure({ tenantId, latencyMs, errorCode: err.status ? `HTTP_${err.status}` : 'AI_UPSTREAM_ERROR' });
    throw err;
  }

  const latencyMs = Date.now() - startedAt;
  const rawText = message.content?.[0]?.text || '';
  const cacheReadTokens = (message.usage && message.usage.cache_read_input_tokens) || 0;
  const cacheCreationTokens = (message.usage && message.usage.cache_creation_input_tokens) || 0;

  const validated = parseAndValidate(rawText);
  if (!validated) {
    emitFailure({ tenantId, latencyMs, errorCode: 'TRIAGE_PARSE_ERROR' });
    throw Object.assign(new Error('Triage model returned unparseable output'), { code: 'TRIAGE_PARSE_ERROR' });
  }

  emitSuccess({ tenantId, latencyMs, cacheReadTokens, cacheCreationTokens, model: message.model || model });

  return {
    ...validated,
    prompt_version: PROMPT_VERSION,
    model_name: message.model || model,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheCreationTokens,
    latency_ms: latencyMs,
    redaction_counts: redactionCounts
  };
}

module.exports = {
  triageIncident,
  parseAndValidate,
  buildUserMessage,
  PROMPT_VERSION
};
