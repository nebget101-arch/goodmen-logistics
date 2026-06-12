'use strict';

const knex = require('@goodmen/shared/config/knex');

async function persistTriageResult({ incidentId, tenantId, result, latencyMs }) {
  const [row] = await knex('incident_triage')
    .insert({
      incident_id: incidentId,
      tenant_id: tenantId,
      severity: result.severity || null,
      category: result.category || null,
      urgency: result.urgency || null,
      vendor_skills: result.vendor_skills ? JSON.stringify(result.vendor_skills) : null,
      rationale: result.rationale || null,
      prompt_version: result.prompt_version || null,
      model_name: result.model_name || null,
      latency_ms: latencyMs,
      cache_read_tokens: result.cache_read_tokens || 0,
      cache_creation_tokens: result.cache_creation_tokens || 0,
    })
    .returning('*');
  return row;
}

async function getLatestTriage({ incidentId, tenantId }) {
  return knex('incident_triage')
    .where({ incident_id: incidentId, tenant_id: tenantId })
    .orderBy('created_at', 'desc')
    .first();
}

module.exports = { persistTriageResult, getLatestTriage };
