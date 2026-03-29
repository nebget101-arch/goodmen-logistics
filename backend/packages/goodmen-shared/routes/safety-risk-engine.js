'use strict';

/**
 * Composite Driver Risk Scoring Engine — FN-479
 * Mounted at /api/safety/driver-risk-scores in the drivers-compliance service.
 *
 * Endpoints:
 *   GET    /api/safety/driver-risk-scores/fleet-summary
 *   POST   /api/safety/driver-risk-scores/:driverId/recalculate
 *   GET    /api/safety/driver-risk-scores/:driverId
 *   GET    /api/safety/driver-risk-scores/:driverId/timeline
 *   GET    /api/safety/driver-risk-scores/:driverId/events
 */

const express = require('express');
const router = express.Router();
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const { loadUserRbac, requireAnyPermission } = require('../middleware/rbac-middleware');

// ─── RBAC ───────────────────────────────────────────────────────────────────
const RISK_ANY_PERMISSION = [
  'safety.incidents.view',
  'safety.incidents.create',
  'safety.incidents.edit',
  'safety.reports.view',
];

router.use(loadUserRbac);
router.use(requireAnyPermission(RISK_ANY_PERMISSION));

const canView = requireAnyPermission(['safety.incidents.view', 'safety.reports.view']);
const canRecalculate = requireAnyPermission(['safety.incidents.edit', 'safety.incidents.create']);

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_WEIGHTS = {
  mvr_violations: 0.25,
  psp_screening: 0.15,
  dot_inspections: 0.20,
  safety_incidents: 0.15,
  claims_history: 0.10,
  hos_violations: 0.10,
  training_gaps: 0.05,
};

/** Recency multiplier — events older than 24 months are ignored. */
function recencyMultiplier(eventDate) {
  const now = new Date();
  const monthsAgo = (now - new Date(eventDate)) / (1000 * 60 * 60 * 24 * 30.44);
  if (monthsAgo <= 6) return 1.0;
  if (monthsAgo <= 12) return 0.75;
  if (monthsAgo <= 18) return 0.5;
  if (monthsAgo <= 24) return 0.25;
  return 0;
}

/** Map severity text to a numeric base score (0-100 scale). */
function severityScore(severity) {
  switch ((severity || '').toLowerCase()) {
    case 'critical': return 100;
    case 'major': return 75;
    case 'moderate': return 50;
    case 'minor': return 25;
    default: return 25;
  }
}

/** Determine risk level from composite score. */
function riskLevel(score) {
  if (score <= 25) return 'low';
  if (score <= 50) return 'medium';
  if (score <= 75) return 'high';
  return 'critical';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || null;
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireTenant(req, res) {
  const tid = tenantId(req);
  if (!tid) { sendError(res, 401, 'Tenant context required'); return null; }
  return tid;
}

// ─── Core Scoring Logic ─────────────────────────────────────────────────────

/**
 * Gather all risk events for a driver within 24 months and compute a
 * weighted composite score with recency multipliers.
 */
async function calculateCompositeScore(tid, driverId) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);

  // 1. MVR violations
  const mvrRows = await knex('mvr_extracted_records')
    .where({ tenant_id: tid, driver_id: driverId })
    .where('record_date', '>=', cutoff)
    .whereIn('record_type', ['violation', 'conviction', 'suspension'])
    .select('id', 'record_date', 'severity', 'description', 'record_type');

  // 2. DOT inspections / FMCSA violations
  const dotRows = await knex('fmcsa_inspections')
    .where({ tenant_id: tid, driver_id: driverId })
    .where('inspection_date', '>=', cutoff)
    .select('id', 'inspection_date', 'total_violation_count', 'out_of_service_driver',
      'out_of_service_vehicle', 'severity_weight');

  // 3. Safety incidents / accidents
  const incidentRows = await knex('safety_incidents')
    .where({ tenant_id: tid, driver_id: driverId })
    .where('incident_date', '>=', cutoff)
    .select('id', 'incident_date', 'severity', 'incident_type');

  // 4. Claims history
  const claimRows = await knex('safety_claims')
    .join('safety_incidents', 'safety_claims.incident_id', 'safety_incidents.id')
    .where('safety_incidents.tenant_id', tid)
    .where('safety_incidents.driver_id', driverId)
    .where('safety_incidents.incident_date', '>=', cutoff)
    .select('safety_claims.id', 'safety_incidents.incident_date', 'safety_claims.claim_type');

  // 5. HOS violations
  let hosRows = [];
  const hasHosTable = await knex.schema.hasTable('hos_records');
  if (hasHosTable) {
    hosRows = await knex('hos_records')
      .where({ driver_id: driverId })
      .where('record_date', '>=', cutoff)
      .whereRaw("violations IS NOT NULL AND violations != '[]'::jsonb")
      .select('id', 'record_date', 'violations');
  }

  // 6. Training gaps
  let trainingGapCount = 0;
  const hasTrainingTable = await knex.schema.hasTable('driver_training_records');
  if (hasTrainingTable) {
    const overdue = await knex('driver_training_records')
      .where({ driver_id: driverId })
      .where('due_date', '<', new Date())
      .whereNull('completed_date')
      .count('id as cnt');
    trainingGapCount = parseInt(String(overdue[0]?.cnt || 0), 10);
  }

  // ─── Score each category ──────────────────────────────────────────────
  const events = [];

  // MVR
  let mvrRaw = 0;
  for (const row of mvrRows) {
    const rm = recencyMultiplier(row.record_date);
    if (rm === 0) continue;
    const base = severityScore(row.severity);
    mvrRaw += base * rm;
    events.push({
      event_type: 'mvr_violation', event_date: row.record_date,
      severity: row.severity || 'minor', description: row.description || row.record_type,
      source_id: row.id, source_table: 'mvr_extracted_records',
      weight_applied: base, recency_multiplier: rm,
    });
  }
  const mvrScore = mvrRows.length > 0 ? Math.min(100, mvrRaw / Math.max(mvrRows.length, 1)) : 0;

  // DOT inspections
  let dotRaw = 0;
  for (const row of dotRows) {
    const rm = recencyMultiplier(row.inspection_date);
    if (rm === 0) continue;
    let base = (row.total_violation_count || 0) * 15;
    if (row.out_of_service_driver) base += 40;
    if (row.out_of_service_vehicle) base += 20;
    base = Math.min(100, base);
    dotRaw += base * rm;
    events.push({
      event_type: 'dot_inspection', event_date: row.inspection_date,
      severity: row.out_of_service_driver ? 'critical' : (row.total_violation_count > 2 ? 'major' : 'moderate'),
      description: `Inspection: ${row.total_violation_count} violations` +
        (row.out_of_service_driver ? ', driver OOS' : '') +
        (row.out_of_service_vehicle ? ', vehicle OOS' : ''),
      source_id: row.id, source_table: 'fmcsa_inspections',
      weight_applied: base, recency_multiplier: rm,
    });
  }
  const dotScore = dotRows.length > 0 ? Math.min(100, dotRaw / Math.max(dotRows.length, 1)) : 0;

  // Safety incidents
  let incRaw = 0;
  for (const row of incidentRows) {
    const rm = recencyMultiplier(row.incident_date);
    if (rm === 0) continue;
    const base = severityScore(row.severity);
    incRaw += base * rm;
    events.push({
      event_type: 'safety_incident', event_date: row.incident_date,
      severity: row.severity || 'moderate', description: `${row.incident_type || 'Incident'}`,
      source_id: row.id, source_table: 'safety_incidents',
      weight_applied: base, recency_multiplier: rm,
    });
  }
  const incidentScore = incidentRows.length > 0 ? Math.min(100, incRaw / Math.max(incidentRows.length, 1)) : 0;

  // Claims
  let claimsRaw = 0;
  for (const row of claimRows) {
    const rm = recencyMultiplier(row.incident_date);
    if (rm === 0) continue;
    const base = 50;
    claimsRaw += base * rm;
    events.push({
      event_type: 'claim', event_date: row.incident_date,
      severity: 'moderate', description: `Claim: ${row.claim_type || 'general'}`,
      source_id: row.id, source_table: 'safety_claims',
      weight_applied: base, recency_multiplier: rm,
    });
  }
  const claimsScore = claimRows.length > 0 ? Math.min(100, claimsRaw / Math.max(claimRows.length, 1)) : 0;

  // HOS violations
  let hosRaw = 0;
  let hosViolCount = 0;
  for (const row of hosRows) {
    const rm = recencyMultiplier(row.record_date);
    if (rm === 0) continue;
    let viols = [];
    try { viols = typeof row.violations === 'string' ? JSON.parse(row.violations) : (row.violations || []); } catch (_) { /* ignore */ }
    if (!Array.isArray(viols) || viols.length === 0) continue;
    hosViolCount += viols.length;
    const base = Math.min(100, viols.length * 30);
    hosRaw += base * rm;
    events.push({
      event_type: 'hos_violation', event_date: row.record_date,
      severity: viols.length > 2 ? 'major' : 'moderate',
      description: `HOS: ${viols.length} violation(s)`,
      source_id: row.id, source_table: 'hos_records',
      weight_applied: base, recency_multiplier: rm,
    });
  }
  const hosScore = hosViolCount > 0 ? Math.min(100, hosRaw / Math.max(hosRows.length, 1)) : 0;

  // Training gaps
  const trainingScore = Math.min(100, trainingGapCount * 20);

  // PSP screening — derived from MVR + DOT data (no separate table)
  const pspScore = Math.min(100, (mvrScore * 0.6 + dotScore * 0.4));

  // ─── Weighted composite ───────────────────────────────────────────────
  const categoryScores = {
    mvr_violations: Math.round(mvrScore * 100) / 100,
    psp_screening: Math.round(pspScore * 100) / 100,
    dot_inspections: Math.round(dotScore * 100) / 100,
    safety_incidents: Math.round(incidentScore * 100) / 100,
    claims_history: Math.round(claimsScore * 100) / 100,
    hos_violations: Math.round(hosScore * 100) / 100,
    training_gaps: Math.round(trainingScore * 100) / 100,
  };

  let composite = 0;
  for (const [cat, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    composite += (categoryScores[cat] || 0) * weight;
  }
  composite = Math.round(Math.min(100, Math.max(0, composite)) * 100) / 100;

  // ─── Trend detection ──────────────────────────────────────────────────
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const previousScoreRow = await knex('driver_risk_scores')
    .where({ tenant_id: tid, driver_id: driverId })
    .where('calculated_at', '<=', ninetyDaysAgo)
    .orderBy('calculated_at', 'desc')
    .first();

  let trend = 'stable';
  if (previousScoreRow) {
    const delta = composite - previousScoreRow.score;
    if (delta <= -5) trend = 'improving';
    else if (delta >= 5) trend = 'worsening';
  }

  return {
    score: composite,
    riskLevel: riskLevel(composite),
    trend,
    categoryScores,
    eventCount: events.length,
    events,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES — fleet-summary MUST be before /:driverId to avoid param capture
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /fleet-summary ─────────────────────────────────────────────────────

router.get('/fleet-summary', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const latestScores = await knex.raw(`
      SELECT DISTINCT ON (driver_id)
        drs.driver_id, drs.score, drs.risk_level, drs.trend, drs.calculated_at,
        d.first_name, d.last_name
      FROM driver_risk_scores drs
      JOIN drivers d ON d.id = drs.driver_id
      WHERE drs.tenant_id = ?
      ORDER BY drs.driver_id, drs.calculated_at DESC
    `, [tid]);

    const rows = latestScores.rows || [];

    const summary = {
      total_drivers_scored: rows.length,
      by_level: {
        low: rows.filter((r) => r.risk_level === 'low').length,
        medium: rows.filter((r) => r.risk_level === 'medium').length,
        high: rows.filter((r) => r.risk_level === 'high').length,
        critical: rows.filter((r) => r.risk_level === 'critical').length,
      },
      by_trend: {
        improving: rows.filter((r) => r.trend === 'improving').length,
        stable: rows.filter((r) => r.trend === 'stable').length,
        worsening: rows.filter((r) => r.trend === 'worsening').length,
      },
      average_score: rows.length > 0
        ? Math.round(rows.reduce((sum, r) => sum + parseFloat(r.score), 0) / rows.length * 100) / 100
        : 0,
      high_risk_drivers: rows
        .filter((r) => r.risk_level === 'high' || r.risk_level === 'critical')
        .map((r) => ({
          driver_id: r.driver_id,
          name: `${r.first_name} ${r.last_name}`,
          score: parseFloat(r.score),
          risk_level: r.risk_level,
          trend: r.trend,
          calculated_at: r.calculated_at,
        })),
    };

    res.json(summary);
  } catch (err) {
    dtLogger.error('risk_fleet_summary_error', err);
    sendError(res, 500, 'Failed to fetch fleet risk summary');
  }
});

// ─── POST /:driverId/recalculate ────────────────────────────────────────────

router.post('/:driverId/recalculate', canRecalculate, async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const { driverId } = req.params;

    const driver = await knex('drivers')
      .where({ id: driverId, tenant_id: tid })
      .first('id', 'first_name', 'last_name');

    if (!driver) return sendError(res, 404, 'Driver not found');

    const result = await calculateCompositeScore(tid, driverId);

    const [scoreRow] = await knex('driver_risk_scores').insert({
      tenant_id: tid,
      driver_id: driverId,
      score: result.score,
      risk_level: result.riskLevel,
      trend: result.trend,
      category_scores: JSON.stringify(result.categoryScores),
      calculated_at: new Date(),
      event_count: result.eventCount,
    }).returning('*');

    if (result.events.length > 0) {
      const eventRows = result.events.map((e) => ({
        tenant_id: tid,
        driver_id: driverId,
        event_type: e.event_type,
        event_date: e.event_date,
        severity: e.severity,
        title: e.description,
        description: e.description,
        source_id: e.source_id,
        source_table: e.source_table,
        weight_applied: e.weight_applied,
        recency_multiplier: e.recency_multiplier,
        score_after: result.score,
        metadata: JSON.stringify({ score_id: scoreRow.id }),
      }));
      await knex('driver_risk_events').insert(eventRows);
    }

    res.status(200).json({
      id: scoreRow.id,
      driver_id: driverId,
      score: result.score,
      risk_level: result.riskLevel,
      trend: result.trend,
      category_scores: result.categoryScores,
      event_count: result.eventCount,
      calculated_at: scoreRow.calculated_at,
    });
  } catch (err) {
    dtLogger.error('risk_score_recalculate_error', err);
    sendError(res, 500, 'Failed to recalculate risk score');
  }
});

// ─── GET /:driverId — current score + history ───────────────────────────────

router.get('/:driverId', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const { driverId } = req.params;

    const current = await knex('driver_risk_scores')
      .where({ tenant_id: tid, driver_id: driverId })
      .orderBy('calculated_at', 'desc')
      .first();

    if (!current) {
      return res.json({ driver_id: driverId, score: null, risk_level: null, message: 'No score calculated yet' });
    }

    const recentScores = await knex('driver_risk_scores')
      .where({ tenant_id: tid, driver_id: driverId })
      .orderBy('calculated_at', 'desc')
      .limit(5)
      .select('id', 'score', 'risk_level', 'trend', 'category_scores', 'calculated_at', 'event_count');

    res.json({
      current: {
        id: current.id,
        driver_id: driverId,
        score: current.score,
        risk_level: current.risk_level,
        trend: current.trend,
        category_scores: current.category_scores,
        event_count: current.event_count,
        calculated_at: current.calculated_at,
      },
      history: recentScores,
    });
  } catch (err) {
    dtLogger.error('risk_score_get_error', err);
    sendError(res, 500, 'Failed to fetch risk score');
  }
});

// ─── GET /:driverId/timeline ────────────────────────────────────────────────

router.get('/:driverId/timeline', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const { driverId } = req.params;

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const timeline = await knex('driver_risk_scores')
      .where({ tenant_id: tid, driver_id: driverId })
      .where('calculated_at', '>=', twelveMonthsAgo)
      .orderBy('calculated_at', 'asc')
      .select('id', 'score', 'risk_level', 'trend', 'category_scores', 'calculated_at', 'event_count');

    res.json({ driver_id: driverId, timeline });
  } catch (err) {
    dtLogger.error('risk_score_timeline_error', err);
    sendError(res, 500, 'Failed to fetch score timeline');
  }
});

// ─── GET /:driverId/events ──────────────────────────────────────────────────

router.get('/:driverId/events', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const { driverId } = req.params;
    const { page = 1, pageSize = 25 } = req.query;

    const offset = (parseInt(String(page), 10) - 1) * parseInt(String(pageSize), 10);
    const limit = Math.min(parseInt(String(pageSize), 10), 100);

    const baseQuery = knex('driver_risk_events')
      .where({ tenant_id: tid, driver_id: driverId });

    const [{ total }] = await baseQuery.clone().count('id as total');
    const rows = await baseQuery.clone()
      .orderBy('event_date', 'desc')
      .limit(limit)
      .offset(offset)
      .select('id', 'event_type', 'event_date', 'severity', 'title', 'description',
        'source_id', 'source_table', 'weight_applied', 'recency_multiplier',
        'score_before', 'score_after', 'is_resolved', 'created_at');

    res.json({
      driver_id: driverId,
      data: rows,
      total: parseInt(String(total), 10),
      page: parseInt(String(page), 10),
      pageSize: limit,
    });
  } catch (err) {
    dtLogger.error('risk_events_list_error', err);
    sendError(res, 500, 'Failed to fetch risk events');
  }
});

// ─── Fire-and-forget recalculation helper (used by trigger hooks) ───────────

/**
 * Trigger a risk score recalculation for a driver. Fire-and-forget —
 * used from safety.js, fmcsa-safety.js, and hos.js after risk-relevant events.
 *
 * @param {string} tid   - Tenant ID
 * @param {string} driverId
 */
async function triggerRecalculation(tid, driverId) {
  if (!tid || !driverId) return;
  try {
    const result = await calculateCompositeScore(tid, driverId);
    await knex('driver_risk_scores').insert({
      tenant_id: tid,
      driver_id: driverId,
      score: result.score,
      risk_level: result.riskLevel,
      trend: result.trend,
      category_scores: JSON.stringify(result.categoryScores),
      calculated_at: new Date(),
      event_count: result.eventCount,
    });
    dtLogger.info('risk_score_auto_recalculated', { tid, driverId });
  } catch (err) {
    // Fire-and-forget — log but never throw
    dtLogger.error('risk_score_auto_recalculate_failed', err, { tid, driverId });
  }
}

router.triggerRecalculation = triggerRecalculation;

module.exports = router;
