'use strict';

const { triageIncident } = require('./triage.service');

/**
 * POST /api/ai/roadside/triage
 *
 * Request body:
 *   tenantId    string  required
 *   description string  required — free-text incident description
 *   vehicleType string  optional — e.g. "semi", "pickup"
 *   location    string  optional — e.g. "I-35 northbound mile 42"
 *
 * Response 200:
 *   { success, data: TriageRecord }
 *   where TriageRecord includes severity, serviceCategory, urgency,
 *   vendorSkills, rationale, safetyRisk, prompt_version, model_name,
 *   cache_read_tokens, cache_creation_tokens, latency_ms
 */
async function handleRoadsideTriage(req, res, deps) {
  const body = req.body || {};

  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: 'tenantId is required',
      code: 'TRIAGE_BAD_REQUEST'
    });
  }
  if (!description) {
    return res.status(400).json({
      success: false,
      error: 'description is required',
      code: 'TRIAGE_BAD_REQUEST'
    });
  }

  const vehicleType = typeof body.vehicleType === 'string' ? body.vehicleType.trim() || null : null;
  const location = typeof body.location === 'string' ? body.location.trim() || null : null;

  try {
    const record = await triageIncident(
      { tenantId, description, vehicleType, location },
      deps
    );
    return res.json({ success: true, data: record });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] roadside triage error', err.message || err);

    if (err.code === 'TRIAGE_PARSE_ERROR') {
      return res.status(502).json({
        success: false,
        error: 'AI returned unparseable triage output',
        code: 'TRIAGE_PARSE_ERROR'
      });
    }

    return res.status(502).json({
      success: false,
      error: 'Triage service unavailable',
      code: 'TRIAGE_UPSTREAM_ERROR'
    });
  }
}

module.exports = { handleRoadsideTriage };
