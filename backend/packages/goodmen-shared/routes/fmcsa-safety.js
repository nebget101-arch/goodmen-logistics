'use strict';

/**
 * FMCSA Safety Module – Express router.
 * Mounted at /api/fmcsa/safety in the integrations service.
 *
 * Internal routes (FleetNeuron safety team — read-only after FN-1451):
 *   GET    /api/fmcsa/safety/dashboard
 *   GET    /api/fmcsa/safety/carriers
 *   POST   /api/fmcsa/safety/carriers
 *   DELETE /api/fmcsa/safety/carriers/:id
 *   GET    /api/fmcsa/safety/carriers/:id/history
 *   GET    /api/fmcsa/safety/carriers/:id/basic-details
 *   GET    /api/fmcsa/safety/carriers/:id/basic-details/:basicName
 *   GET    /api/fmcsa/safety/carriers/:id/basic-details/:basicName/history
 *   GET    /api/fmcsa/safety/jobs
 *
 * Client-facing routes (tenant-scoped):
 *   GET    /api/fmcsa/safety/my-scores                      (FN-1427 → fmcsa-reference)
 *   GET    /api/fmcsa/safety/my-scores/:dotNumber/history   (FN-1427 → fmcsa-reference)
 *   GET    /api/fmcsa/safety/my-scores/:dotNumber/basic-details
 *
 * FN-474 inspection ingest / list / match (kept):
 *   POST   /api/fmcsa/safety/inspections/ingest
 *   GET    /api/fmcsa/safety/inspections
 *   GET    /api/fmcsa/safety/inspections/:id
 *   PATCH  /api/fmcsa/safety/inspections/:id/match
 *   POST   /api/fmcsa/safety/inspections/rematch
 *
 * Migration history:
 *   FN-1427 — tenant-facing reads switched to fmcsa.* via fmcsa-reference.js.
 *   FN-1451 — SAFER scraper retired: POST /scrape* endpoints + initQueue +
 *             fmcsa-safer-scraper.js + fmcsa-scrape-queue.js + utils/fmcsa.js
 *             removed. Read endpoints + their backing legacy tables
 *             (fmcsa_monitored_carriers, fmcsa_safety_snapshots,
 *             fmcsa_basic_details*, fmcsa_scrape_jobs) deliberately kept
 *             intact: a frontend cleanup ticket will retire the legacy
 *             admin UI (fmcsa-dashboard / fmcsa-carriers / fmcsa-carrier-detail)
 *             before those reads + tables get dropped.
 */

const express = require('express');
const router = express.Router();
const knex = require('../config/knex');
const { loadUserRbac, requirePermission, requireAnyPermission } = require('../middleware/rbac-middleware');
const fmcsaRef = require('../services/fmcsa-reference');

// RBAC middleware applied to all routes
router.use(loadUserRbac);
router.use(requireAnyPermission([
  'fmcsa_safety.view',
  'fmcsa_safety.manage',
]));

const canView = requirePermission('fmcsa_safety.view');
const canManage = requirePermission('fmcsa_safety.manage');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || null;
}

function userId(req) {
  return req.user?.id || null;
}

/**
 * Check if the user belongs to the platform default tenant (FleetNeuron Default).
 * The default tenant is the FIRST tenant created (oldest by created_at).
 * Only users in this tenant can see all carriers and trigger full scrapes.
 */
let _defaultTenantId = null;
async function isDefaultTenant(req) {
  const tid = tenantId(req);
  if (!tid) return false;

  // Cache the default tenant ID (first tenant created)
  if (!_defaultTenantId) {
    const defaultTenant = await knex('tenants')
      .where({ status: 'active' })
      .orderBy('created_at', 'asc')
      .first();
    _defaultTenantId = defaultTenant?.id || null;
  }

  return tid === _defaultTenantId;
}

/**
 * Get the DOT numbers belonging to the user's tenant via operating_entities.
 * Returns null for the default tenant (meaning "show all").
 * Returns an array of DOT numbers for regular tenant users.
 */
async function getTenantDotNumbers(req) {
  if (await isDefaultTenant(req)) return null; // default tenant sees all

  const tid = tenantId(req);
  if (!tid) return []; // no tenant = no data

  const entities = await knex('operating_entities')
    .where({ tenant_id: tid })
    .whereNotNull('dot_number')
    .andWhere('dot_number', '!=', '')
    .select('dot_number');

  return entities.map((e) => e.dot_number);
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function parseJsonSafe(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

const DOT_RE = /^\d{1,8}$/;

/**
 * Verify the carrier belongs to the user's tenant.
 * Platform admin (default tenant) bypasses this check.
 * Returns the carrier row or sends 403/404.
 */
async function verifyCarrierAccess(req, res) {
  const carrier = await knex('fmcsa_monitored_carriers')
    .where({ id: req.params.id })
    .first();
  if (!carrier) {
    sendError(res, 404, 'Carrier not found');
    return null;
  }
  if (await isDefaultTenant(req)) return carrier;

  const tenantDots = await getTenantDotNumbers(req);
  if (tenantDots !== null && !tenantDots.includes(carrier.dot_number)) {
    sendError(res, 403, 'Carrier not associated with your tenant');
    return null;
  }
  return carrier;
}

// ─── Score thresholds for alerts ─────────────────────────────────────────────
const ALERT_THRESHOLD = 75; // percentile above which we flag a score
const SCORE_INCREASE_THRESHOLD = 15; // point increase between snapshots

// ─── FN-1427: BASIC name → snapshot-shape field mapping ───────────────────────
// FMCSA SMS bulk files emit BASIC tokens like "UNSAFE_DRIVING"; the legacy
// snapshot-shaped API exposes them as fields like "unsafe_driving_score". This
// keeps the public contract stable while we migrate the storage layer.
const BASIC_TO_FIELD = {
  UNSAFE_DRIVING: 'unsafe_driving_score',
  HOS: 'hos_compliance_score',
  HOS_COMPLIANCE: 'hos_compliance_score',
  VEHICLE_MAINT: 'vehicle_maintenance_score',
  VEHICLE_MAINTENANCE: 'vehicle_maintenance_score',
  CONTROLLED_SUBS: 'controlled_substances_score',
  CONTROLLED_SUBSTANCES: 'controlled_substances_score',
  DRIVER_FITNESS: 'driver_fitness_score',
  CRASH_INDICATOR: 'crash_indicator_score',
  HAZMAT: 'hazmat_score',
  HAZMAT_COMPLIANCE: 'hazmat_score',
};

const SCORE_FIELDS = [
  { key: 'unsafe_driving_score', label: 'Unsafe Driving' },
  { key: 'hos_compliance_score', label: 'HOS Compliance' },
  { key: 'vehicle_maintenance_score', label: 'Vehicle Maintenance' },
  { key: 'controlled_substances_score', label: 'Controlled Substances' },
  { key: 'driver_fitness_score', label: 'Driver Fitness' },
  { key: 'crash_indicator_score', label: 'Crash Indicator' },
  { key: 'hazmat_score', label: 'Hazmat' },
];

/**
 * Build a snapshot-shaped row from fmcsa.* data for one DOT.
 * Returned object matches the field set consumers expected from
 * `fmcsa_safety_snapshots` so the API contract stays stable for pass 1.
 *
 * `safety_rating`, `safety_rating_date`, and `out_of_service_date` are not
 * yet in the fmcsa.* schema; they're returned as null until a future importer
 * pass adds them (tracked as an Open Item on FN-1416).
 */
async function buildSnapshotShape(dot) {
  const dotInt = parseInt(dot, 10);
  if (!Number.isFinite(dotInt)) return null;

  const [carrier, scores, authorities] = await Promise.all([
    fmcsaRef.getCarrier(dotInt),
    fmcsaRef.getBasicScores(dotInt),
    fmcsaRef.getCarrierAuthorities(dotInt),
  ]);
  if (!carrier) return null;

  const snap = {
    scraped_at: null,
    operating_status: carrier.status || null,
    safety_rating: null,
    safety_rating_date: null,
    out_of_service_date: null,
    total_drivers: carrier.drivers ?? null,
    total_power_units: carrier.power_units ?? null,
    bipd_insurance_required: null,
    bipd_insurance_on_file: null,
    cargo_insurance_required: null,
    cargo_insurance_on_file: null,
    bond_insurance_required: null,
    bond_insurance_on_file: null,
    authority_common: null,
    authority_contract: null,
    authority_broker: null,
  };

  for (const field of SCORE_FIELDS) snap[field.key] = null;

  let mostRecent = null;
  for (const s of scores || []) {
    const fieldKey = BASIC_TO_FIELD[String(s.basic).toUpperCase()];
    if (!fieldKey) continue;
    snap[fieldKey] = s.percentile != null ? Number(s.percentile) : null;
    if (!mostRecent || (s.computed_at && s.computed_at > mostRecent)) {
      mostRecent = s.computed_at;
    }
  }
  snap.scraped_at = mostRecent;

  for (const a of authorities || []) {
    if (a.authority_type === 'Common') snap.authority_common = a.status;
    else if (a.authority_type === 'Contract') snap.authority_contract = a.status;
    else if (a.authority_type === 'Broker') snap.authority_broker = a.status;

    // Insurance is a JSONB blob keyed loosely by type; surface a YES/NO if any
    // entry exists for the given type (legacy contract was a YES/NO string).
    const amounts = parseJsonSafe(a.insurance_amounts) || {};
    const upperKeys = Object.keys(amounts).map((k) => String(k).toUpperCase());
    if (snap.bipd_insurance_on_file == null && upperKeys.some((k) => k.includes('BIPD'))) {
      snap.bipd_insurance_on_file = 'YES';
    }
    if (snap.cargo_insurance_on_file == null && upperKeys.some((k) => k.includes('CARGO'))) {
      snap.cargo_insurance_on_file = 'YES';
    }
    if (snap.bond_insurance_on_file == null && upperKeys.some((k) => k.includes('BOND'))) {
      snap.bond_insurance_on_file = 'YES';
    }
  }

  return snap;
}

// ─── Internal: Dashboard ─────────────────────────────────────────────────────

/**
 * @openapi
 * /api/fmcsa/safety/dashboard:
 *   get:
 *     summary: FMCSA Safety dashboard summary
 *     tags: [FMCSA Safety]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Dashboard data with carriers, scores, and alerts
 */
router.get('/dashboard', canView, async (req, res) => {
  try {
    // Scope to tenant's DOT numbers (null = super_admin, show all)
    const tenantDots = await getTenantDotNumbers(req);

    // Get monitored carriers with latest snapshot
    let query = knex('fmcsa_monitored_carriers as mc')
      .leftJoin(
        knex('fmcsa_safety_snapshots')
          .distinctOn('monitored_carrier_id')
          .orderBy('monitored_carrier_id')
          .orderBy('scraped_at', 'desc')
          .as('s'),
        'mc.id', 's.monitored_carrier_id'
      )
      .where('mc.monitoring_active', true)
      .select(
        'mc.id', 'mc.dot_number', 'mc.mc_number', 'mc.legal_name', 'mc.dba_name',
        'mc.monitoring_active', 'mc.source',
        's.scraped_at', 's.unsafe_driving_score', 's.hos_compliance_score',
        's.vehicle_maintenance_score', 's.controlled_substances_score',
        's.driver_fitness_score', 's.crash_indicator_score', 's.hazmat_score',
        's.operating_status', 's.safety_rating', 's.total_drivers', 's.total_power_units',
        's.bipd_insurance_on_file', 's.cargo_insurance_on_file', 's.bond_insurance_on_file',
        's.authority_common', 's.authority_contract', 's.authority_broker'
      )
      .orderBy('mc.legal_name');

    // Non-super_admin: filter to only their tenant's DOT numbers
    if (tenantDots !== null) {
      if (tenantDots.length === 0) {
        return res.json({ carriers: [], alerts: [], total_carriers: 0, alerts_count: 0, last_scrape_job: null });
      }
      query = query.whereIn('mc.dot_number', tenantDots);
    }

    const carriers = await query;

    // Generate alerts
    const alerts = [];
    const scoreFields = [
      { key: 'unsafe_driving_score', label: 'Unsafe Driving' },
      { key: 'hos_compliance_score', label: 'HOS Compliance' },
      { key: 'vehicle_maintenance_score', label: 'Vehicle Maintenance' },
      { key: 'controlled_substances_score', label: 'Controlled Substances' },
      { key: 'driver_fitness_score', label: 'Driver Fitness' },
      { key: 'crash_indicator_score', label: 'Crash Indicator' },
      { key: 'hazmat_score', label: 'Hazmat' },
    ];

    for (const carrier of carriers) {
      // High score alerts
      for (const { key, label } of scoreFields) {
        const score = parseFloat(carrier[key]);
        if (!isNaN(score) && score >= ALERT_THRESHOLD) {
          alerts.push({
            type: 'high_score',
            carrier_id: carrier.id,
            carrier_name: carrier.legal_name,
            dot_number: carrier.dot_number,
            category: label,
            score,
          });
        }
      }

      // Insurance alerts
      if (carrier.bipd_insurance_on_file && carrier.bipd_insurance_on_file.toUpperCase().includes('NO')) {
        alerts.push({
          type: 'insurance_lapse',
          carrier_id: carrier.id,
          carrier_name: carrier.legal_name,
          dot_number: carrier.dot_number,
          detail: 'BIPD insurance not on file',
        });
      }
      if (carrier.cargo_insurance_on_file && carrier.cargo_insurance_on_file.toUpperCase().includes('NO')) {
        alerts.push({
          type: 'insurance_lapse',
          carrier_id: carrier.id,
          carrier_name: carrier.legal_name,
          dot_number: carrier.dot_number,
          detail: 'Cargo insurance not on file',
        });
      }

      // Authority alerts
      if (carrier.operating_status && !carrier.operating_status.toUpperCase().includes('AUTHORIZED')) {
        alerts.push({
          type: 'authority_issue',
          carrier_id: carrier.id,
          carrier_name: carrier.legal_name,
          dot_number: carrier.dot_number,
          detail: `Operating status: ${carrier.operating_status}`,
        });
      }
    }

    // Last scrape job
    const lastJob = await knex('fmcsa_scrape_jobs')
      .orderBy('created_at', 'desc')
      .first();

    res.json({
      carriers,
      alerts,
      total_carriers: carriers.length,
      alerts_count: alerts.length,
      last_scrape_job: lastJob || null,
    });
  } catch (err) {
    console.error('[fmcsa-safety] dashboard error', err);
    sendError(res, 500, 'Failed to load dashboard');
  }
});

// ─── Internal: Carriers CRUD ─────────────────────────────────────────────────

router.get('/carriers', canView, async (req, res) => {
  try {
    const tenantDots = await getTenantDotNumbers(req);
    let query = knex('fmcsa_monitored_carriers').orderBy('legal_name').select('*');
    if (tenantDots !== null) {
      if (tenantDots.length === 0) return res.json([]);
      query = query.whereIn('dot_number', tenantDots);
    }
    const carriers = await query;
    res.json(carriers);
  } catch (err) {
    console.error('[fmcsa-safety] list carriers error', err);
    sendError(res, 500, 'Failed to list carriers');
  }
});

router.post('/carriers', canManage, async (req, res) => {
  try {
    const { dot_number, mc_number, legal_name, dba_name } = req.body;

    if (!dot_number || !DOT_RE.test(dot_number)) {
      return sendError(res, 400, 'Valid DOT number required (1-8 digits)');
    }

    // Check for duplicate
    const existing = await knex('fmcsa_monitored_carriers')
      .where({ dot_number })
      .first();
    if (existing) {
      return sendError(res, 409, 'Carrier with this DOT number is already monitored');
    }

    const [carrier] = await knex('fmcsa_monitored_carriers')
      .insert({
        dot_number,
        mc_number: mc_number || null,
        legal_name: legal_name || null,
        dba_name: dba_name || null,
        source: 'manual',
        monitoring_active: true,
        created_by: userId(req),
      })
      .returning('*');

    res.status(201).json(carrier);
  } catch (err) {
    console.error('[fmcsa-safety] add carrier error', err);
    sendError(res, 500, 'Failed to add carrier');
  }
});

router.delete('/carriers/:id', canManage, async (req, res) => {
  try {
    const deleted = await knex('fmcsa_monitored_carriers')
      .where({ id: req.params.id })
      .delete();

    if (!deleted) {
      return sendError(res, 404, 'Carrier not found');
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[fmcsa-safety] delete carrier error', err);
    sendError(res, 500, 'Failed to delete carrier');
  }
});

// ─── Internal: Carrier History ───────────────────────────────────────────────

router.get('/carriers/:id/history', canView, async (req, res) => {
  try {
    const carrier = await verifyCarrierAccess(req, res);
    if (!carrier) return; // response already sent

    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const offset = parseInt(req.query.offset) || 0;

    const snapshots = await knex('fmcsa_safety_snapshots')
      .where({ monitored_carrier_id: carrier.id })
      .orderBy('scraped_at', 'desc')
      .limit(limit)
      .offset(offset)
      .select('*');

    const [{ count }] = await knex('fmcsa_safety_snapshots')
      .where({ monitored_carrier_id: carrier.id })
      .count('id as count');

    res.json({ snapshots, total: parseInt(count), limit, offset });
  } catch (err) {
    console.error('[fmcsa-safety] carrier history error', err);
    sendError(res, 500, 'Failed to load carrier history');
  }
});

// ─── Internal: BASIC Detail Data ────────────────────────────────────────────

/**
 * GET /carriers/:id/basic-details
 * Latest BASIC detail records for a carrier (one per BASIC category).
 */
router.get('/carriers/:id/basic-details', canView, async (req, res) => {
  try {
    const carrier = await verifyCarrierAccess(req, res);
    if (!carrier) return;

    // Get the latest scraped_at per basic_name
    const details = await knex('fmcsa_basic_details')
      .where({ monitored_carrier_id: carrier.id })
      .distinctOn('basic_name')
      .orderBy('basic_name')
      .orderBy('scraped_at', 'desc')
      .select('*');

    // For each detail, fetch related measures history, violations, and inspections
    const enriched = await Promise.all(
      details.map(async (detail) => {
        const [measuresHistory, violations, inspections] = await Promise.all([
          knex('fmcsa_basic_measures_history')
            .where({ basic_detail_id: detail.id })
            .orderBy('snapshot_date')
            .select('*'),
          knex('fmcsa_violations')
            .where({ basic_detail_id: detail.id })
            .orderBy('violation_count', 'desc')
            .select('*'),
          knex('fmcsa_inspection_history')
            .where({ basic_detail_id: detail.id })
            .orderBy('inspection_date', 'desc')
            .select('*'),
        ]);

        return {
          ...detail,
          measures_history: measuresHistory,
          violations,
          inspections,
        };
      })
    );

    res.json({ basic_details: enriched });
  } catch (err) {
    console.error('[fmcsa-safety] basic-details error', err);
    sendError(res, 500, 'Failed to load BASIC details');
  }
});

/**
 * GET /carriers/:id/basic-details/:basicName
 * Detailed data for a specific BASIC category for a carrier.
 */
router.get('/carriers/:id/basic-details/:basicName', canView, async (req, res) => {
  try {
    const carrier = await verifyCarrierAccess(req, res);
    if (!carrier) return;
    const { basicName } = req.params;

    const detail = await knex('fmcsa_basic_details')
      .where({ monitored_carrier_id: carrier.id, basic_name: basicName })
      .orderBy('scraped_at', 'desc')
      .first();

    if (!detail) {
      return sendError(res, 404, `No data found for BASIC: ${basicName}`);
    }

    const [measuresHistory, violations, inspections] = await Promise.all([
      knex('fmcsa_basic_measures_history')
        .where({ basic_detail_id: detail.id })
        .orderBy('snapshot_date')
        .select('*'),
      knex('fmcsa_violations')
        .where({ basic_detail_id: detail.id })
        .orderBy('violation_count', 'desc')
        .select('*'),
      knex('fmcsa_inspection_history')
        .where({ basic_detail_id: detail.id })
        .orderBy('inspection_date', 'desc')
        .select('*'),
    ]);

    res.json({
      ...detail,
      measures_history: measuresHistory,
      violations,
      inspections,
    });
  } catch (err) {
    console.error('[fmcsa-safety] basic-detail error', err);
    sendError(res, 500, 'Failed to load BASIC detail');
  }
});

/**
 * GET /carriers/:id/inspection-details
 * All detailed inspection reports for a carrier.
 */
router.get('/carriers/:id/inspection-details', canView, async (req, res) => {
  try {
    const carrier = await verifyCarrierAccess(req, res);
    if (!carrier) return;
    const details = await knex('fmcsa_inspection_details')
      .where({ monitored_carrier_id: carrier.id })
      .orderBy('inspection_date', 'desc')
      .select('*');
    res.json({ inspection_details: details });
  } catch (err) {
    console.error('[fmcsa-safety] inspection-details error', err);
    sendError(res, 500, 'Failed to load inspection details');
  }
});

/**
 * GET /carriers/:id/inspection-details/:inspectionId
 * Single detailed inspection report.
 */
router.get('/carriers/:id/inspection-details/:inspectionId', canView, async (req, res) => {
  try {
    const carrier = await verifyCarrierAccess(req, res);
    if (!carrier) return;
    const detail = await knex('fmcsa_inspection_details')
      .where({
        monitored_carrier_id: carrier.id,
        inspection_id: req.params.inspectionId,
      })
      .first();
    if (!detail) {
      return sendError(res, 404, 'Inspection detail not found');
    }
    res.json(detail);
  } catch (err) {
    console.error('[fmcsa-safety] inspection-detail error', err);
    sendError(res, 500, 'Failed to load inspection detail');
  }
});

/**
 * GET /carriers/:id/basic-details/:basicName/history
 * History of BASIC detail records over time for a specific category.
 */
router.get('/carriers/:id/basic-details/:basicName/history', canView, async (req, res) => {
  try {
    const carrier = await verifyCarrierAccess(req, res);
    if (!carrier) return;
    const { basicName } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const offset = parseInt(req.query.offset) || 0;

    const details = await knex('fmcsa_basic_details')
      .where({ monitored_carrier_id: carrier.id, basic_name: basicName })
      .orderBy('scraped_at', 'desc')
      .limit(limit)
      .offset(offset)
      .select('id', 'basic_name', 'measure_value', 'percentile', 'threshold',
              'safety_event_group', 'acute_critical_violations', 'scraped_at');

    const [{ count }] = await knex('fmcsa_basic_details')
      .where({ monitored_carrier_id: carrier.id, basic_name: basicName })
      .count('id as count');

    res.json({ details, total: parseInt(count), limit, offset });
  } catch (err) {
    console.error('[fmcsa-safety] basic-detail history error', err);
    sendError(res, 500, 'Failed to load BASIC detail history');
  }
});

// ─── Internal: Jobs ──────────────────────────────────────────────────────────

router.get('/jobs', canView, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const jobs = await knex('fmcsa_scrape_jobs')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .select('*');
    res.json(jobs);
  } catch (err) {
    console.error('[fmcsa-safety] list jobs error', err);
    sendError(res, 500, 'Failed to list jobs');
  }
});

// ─── Client-facing: My Scores ────────────────────────────────────────────────

router.get('/my-scores', canView, async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) {
      return sendError(res, 401, 'Tenant context required');
    }

    // Get operating entities for this tenant that have DOT numbers
    const entities = await knex('operating_entities')
      .where({ tenant_id: tid })
      .whereNotNull('dot_number')
      .andWhere('dot_number', '!=', '')
      .select('id', 'name', 'legal_name', 'dot_number', 'mc_number');

    if (!entities.length) {
      return res.json({ carriers: [] });
    }

    // FN-1427: read from fmcsa.* via fmcsa-reference instead of legacy
    // fmcsa_monitored_carriers + fmcsa_safety_snapshots tables.
    const carriers = await Promise.all(
      entities.map(async (e) => {
        const carrier = await fmcsaRef.getCarrier(e.dot_number);
        const snap = await buildSnapshotShape(e.dot_number);
        return {
          id: carrier ? `dot-${carrier.dot}` : `entity-${e.id}`,
          dot_number: e.dot_number,
          mc_number: carrier?.mc_number || e.mc_number || null,
          legal_name: carrier?.legal_name || e.legal_name || e.name || null,
          ...(snap || {}),
        };
      })
    );

    carriers.sort((a, b) => (a.legal_name || '').localeCompare(b.legal_name || ''));
    res.json({ carriers });
  } catch (err) {
    console.error('[fmcsa-safety] my-scores error', err);
    sendError(res, 500, 'Failed to load FMCSA scores');
  }
});

router.get('/my-scores/:dotNumber/history', canView, async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) {
      return sendError(res, 401, 'Tenant context required');
    }

    const { dotNumber } = req.params;
    if (!DOT_RE.test(dotNumber)) {
      return sendError(res, 400, 'Invalid DOT number');
    }

    // Verify this DOT belongs to the tenant
    const entity = await knex('operating_entities')
      .where({ tenant_id: tid, dot_number: dotNumber })
      .first();
    if (!entity) {
      return sendError(res, 403, 'DOT number not associated with your tenant');
    }

    // FN-1427: read from fmcsa.basic_scores via fmcsa-reference. Each computed_at
    // becomes one snapshot-shaped row aggregating all BASICs for that timestamp.
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const offset = parseInt(req.query.offset) || 0;

    const allScores = await fmcsaRef.getBasicScores(dotNumber, { latest: false });
    if (!allScores.length) return res.json({ snapshots: [], total: 0, limit, offset });

    // Group scores by computed_at into snapshot-shaped rows.
    const byTs = new Map();
    for (const s of allScores) {
      const tsKey = s.computed_at instanceof Date
        ? s.computed_at.toISOString()
        : String(s.computed_at);
      let snap = byTs.get(tsKey);
      if (!snap) {
        snap = { scraped_at: s.computed_at };
        for (const f of SCORE_FIELDS) snap[f.key] = null;
        byTs.set(tsKey, snap);
      }
      const fieldKey = BASIC_TO_FIELD[String(s.basic).toUpperCase()];
      if (fieldKey) snap[fieldKey] = s.percentile != null ? Number(s.percentile) : null;
    }

    const snapshots = [...byTs.values()].sort((a, b) => {
      const at = a.scraped_at ? new Date(a.scraped_at).getTime() : 0;
      const bt = b.scraped_at ? new Date(b.scraped_at).getTime() : 0;
      return bt - at;
    });

    const total = snapshots.length;
    const page = snapshots.slice(offset, offset + limit);
    res.json({ snapshots: page, total, limit, offset });
  } catch (err) {
    console.error('[fmcsa-safety] my-scores history error', err);
    sendError(res, 500, 'Failed to load score history');
  }
});

// ─── Client-facing: My BASIC Details ────────────────────────────────────────

router.get('/my-scores/:dotNumber/basic-details', canView, async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) {
      return sendError(res, 401, 'Tenant context required');
    }

    const { dotNumber } = req.params;
    if (!DOT_RE.test(dotNumber)) {
      return sendError(res, 400, 'Invalid DOT number');
    }

    // Verify this DOT belongs to the tenant
    const entity = await knex('operating_entities')
      .where({ tenant_id: tid, dot_number: dotNumber })
      .first();
    if (!entity) {
      return sendError(res, 403, 'DOT number not associated with your tenant');
    }

    const carrier = await knex('fmcsa_monitored_carriers')
      .where({ dot_number: dotNumber })
      .first();
    if (!carrier) {
      return res.json({ basic_details: [] });
    }

    // Get latest BASIC details per category
    const details = await knex('fmcsa_basic_details')
      .where({ monitored_carrier_id: carrier.id })
      .distinctOn('basic_name')
      .orderBy('basic_name')
      .orderBy('scraped_at', 'desc')
      .select('*');

    // Enrich with related data
    const enriched = await Promise.all(
      details.map(async (detail) => {
        const [measuresHistory, violations, inspections] = await Promise.all([
          knex('fmcsa_basic_measures_history')
            .where({ basic_detail_id: detail.id })
            .orderBy('snapshot_date')
            .select('*'),
          knex('fmcsa_violations')
            .where({ basic_detail_id: detail.id })
            .orderBy('violation_count', 'desc')
            .select('*'),
          knex('fmcsa_inspection_history')
            .where({ basic_detail_id: detail.id })
            .orderBy('inspection_date', 'desc')
            .select('*'),
        ]);

        return {
          ...detail,
          measures_history: measuresHistory,
          violations,
          inspections,
        };
      })
    );

    res.json({ basic_details: enriched });
  } catch (err) {
    console.error('[fmcsa-safety] my-scores basic-details error', err);
    sendError(res, 500, 'Failed to load BASIC details');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FN-474: Inspection Storage & Fleet Matching endpoints
// ═══════════════════════════════════════════════════════════════════════════════

// Role-based middleware for inspection routes (same pattern as cycle-counts, receiving, etc.)
function requireRole(allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user?.role || 'technician';
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}` });
    }
    next();
  };
}

const { matchInspection, createRiskEvent, rematchInspections } = require('../services/fmcsa-matching-service');

// POST /inspections/ingest — Batch store inspections with dedup by report_number
router.post('/inspections/ingest', requireRole(['admin', 'safety']), async (req, res) => {
  try {
    const { inspections, carrier_id } = req.body || {};
    if (!Array.isArray(inspections) || inspections.length === 0) {
      return sendError(res, 400, 'inspections array is required');
    }
    if (!carrier_id) return sendError(res, 400, 'carrier_id is required');

    let ingested = 0;
    let duplicates = 0;
    let matched = 0;

    for (const insp of inspections) {
      const reportNumber = (insp.report_number || '').toString().trim();
      if (!reportNumber) { duplicates++; continue; }

      // Dedup by report_number
      const existing = await knex('fmcsa_inspection_history')
        .where({ carrier_id, report_number: reportNumber })
        .first('id');
      if (existing) { duplicates++; continue; }

      const [row] = await knex('fmcsa_inspection_history').insert({
        carrier_id,
        inspection_date: insp.inspection_date || null,
        report_number: reportNumber,
        report_state: insp.report_state || null,
        plate_number: insp.plate_number || null,
        vehicle_type: insp.vehicle_type || null,
        driver_name: insp.driver_name || null,
        driver_license_number: insp.driver_license_number || null,
        driver_license_state: insp.driver_license_state || null,
        severity_weight: insp.severity_weight || null,
        time_weight: insp.time_weight || null,
        driver_oos: insp.driver_oos || false,
        vehicle_oos: insp.vehicle_oos || false,
        hazmat_oos: insp.hazmat_oos || false,
        vehicles: JSON.stringify(insp.vehicles || []),
        violations: JSON.stringify(insp.violations || []),
        match_status: 'unmatched'
      }).returning('*');

      // Auto-match using tenant context if available
      const tenantId = req.context?.tenantId;
      if (tenantId) {
        const matchResult = await matchInspection(tenantId, row);
        if (matchResult.matched) {
          await knex('fmcsa_inspection_history').where({ id: row.id }).update({
            match_status: 'matched',
            match_method: matchResult.method,
            match_confidence: matchResult.confidence,
            matched_driver_id: matchResult.driverId,
            matched_vehicle_id: matchResult.vehicleId,
            matched_at: new Date()
          });
          await createRiskEvent(tenantId, row, matchResult);
          matched++;
        }
      }

      ingested++;
    }

    res.json({ success: true, ingested, duplicates, matched });
  } catch (err) {
    dtLogger.error('fmcsa_inspections_ingest_error', err);
    sendError(res, 500, 'Failed to ingest inspections');
  }
});

// GET /inspections — List inspections with filters
// Deduplicates by report_number (same inspection appears per BASIC category)
router.get('/inspections', requireRole(['admin', 'safety', 'dispatcher']), async (req, res) => {
  try {
    const { carrier_id, match_status, date_from, date_to, limit = 50, offset = 0 } = req.query;

    // Build WHERE clause params for dedup query
    const conditions = [];
    const params = [];
    if (carrier_id) { conditions.push('h.carrier_id = ?'); params.push(carrier_id); }
    if (match_status) { conditions.push('h.match_status = ?'); params.push(match_status); }
    if (date_from) { conditions.push('h.inspection_date >= ?'); params.push(date_from); }
    if (date_to) { conditions.push('h.inspection_date <= ?'); params.push(date_to); }
    const whereClause = conditions.length ? 'AND ' + conditions.join(' AND ') : '';

    // Deduplicate: pick one row per report_number using DISTINCT ON
    const paginatedRows = await knex.raw(`
      SELECT * FROM (
        SELECT DISTINCT ON (h.report_number)
          h.*,
          d.level,
          d.vehicles AS detail_vehicles,
          d.violations AS detail_violations
        FROM fmcsa_inspection_history h
        LEFT JOIN fmcsa_inspection_details d ON h.report_number = d.report_number
        WHERE 1=1 ${whereClause}
        ORDER BY h.report_number, h.created_at DESC
      ) AS deduped
      ORDER BY inspection_date DESC
      LIMIT ? OFFSET ?
    `, [...params, Number(limit), Number(offset)]);

    let countQ = knex('fmcsa_inspection_history').countDistinct('report_number as total');
    if (carrier_id) countQ = countQ.where('carrier_id', carrier_id);
    if (match_status) countQ = countQ.where('match_status', match_status);
    if (date_from) countQ = countQ.where('inspection_date', '>=', date_from);
    if (date_to) countQ = countQ.where('inspection_date', '<=', date_to);
    const countResult = await countQ.first();

    const rows = paginatedRows.rows || [];
    const total = Number(countResult?.total || 0);

    // Enrich rows with computed fields from detail data
    const enriched = rows.map(row => {
      const violations = parseJsonSafe(row.detail_violations) || parseJsonSafe(row.violations) || [];
      const vehicles = parseJsonSafe(row.detail_vehicles) || [];
      const truck = vehicles.find(v => /truck/i.test(v.type)) || vehicles[0];

      // Format date as YYYY-MM-DD to avoid timezone shift in the browser
      let dateStr = null;
      if (row.inspection_date) {
        const d = new Date(row.inspection_date);
        dateStr = d.toISOString().split('T')[0];
      }

      return {
        ...row,
        inspection_date: dateStr,
        level: row.level || null,
        violation_count: violations.length,
        vehicle_display: truck
          ? `${truck.plate_number || ''} ${truck.make || ''}`.trim() || null
          : row.plate_number || null,
        vehicle_vin: truck?.vin || null,
        plate_raw: truck?.plate_number || row.plate_number || null,
        vin_raw: truck?.vin || null,
        driver_name_raw: row.driver_name || null,
        oos_vehicle: row.vehicle_oos || violations.some(v => v.oos === 'Y' && /truck|trailer/i.test(v.unit || '')),
        oos_driver: row.driver_oos || violations.some(v => v.oos === 'Y' && /driver/i.test(v.unit || '')),
        // Clean up join artifacts
        detail_vehicles: undefined,
        detail_violations: undefined,
      };
    });

    res.json({ rows: enriched, total });
  } catch (err) {
    dtLogger.error('fmcsa_inspections_list_error', err);
    sendError(res, 500, 'Failed to list inspections');
  }
});

// GET /inspections/:id — Single inspection detail
router.get('/inspections/:id', requireRole(['admin', 'safety', 'dispatcher']), async (req, res) => {
  try {
    const row = await knex('fmcsa_inspection_history').where({ id: req.params.id }).first();
    if (!row) return sendError(res, 404, 'Inspection not found');

    // Also fetch detailed report if available
    const detail = await knex('fmcsa_inspection_details')
      .where({ report_number: row.report_number })
      .first();

    res.json({ inspection: row, detail: detail || null });
  } catch (err) {
    dtLogger.error('fmcsa_inspection_detail_error', err);
    sendError(res, 500, 'Failed to fetch inspection');
  }
});

// PATCH /inspections/:id/match — Manual match
router.patch('/inspections/:id/match', requireRole(['admin', 'safety']), async (req, res) => {
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) return sendError(res, 400, 'Tenant context required');

    const { driver_id, vehicle_id } = req.body || {};
    if (!driver_id && !vehicle_id) return sendError(res, 400, 'driver_id or vehicle_id required');

    const insp = await knex('fmcsa_inspection_history').where({ id: req.params.id }).first();
    if (!insp) return sendError(res, 404, 'Inspection not found');

    await knex('fmcsa_inspection_history').where({ id: insp.id }).update({
      match_status: 'manual',
      match_method: 'manual',
      match_confidence: 1.0,
      matched_driver_id: driver_id || insp.matched_driver_id,
      matched_vehicle_id: vehicle_id || insp.matched_vehicle_id,
      matched_by_user_id: req.user?.id || null,
      matched_at: new Date()
    });

    // Create risk event for manual match
    if (driver_id) {
      await createRiskEvent(tenantId, insp, {
        driverId: driver_id,
        vehicleId: vehicle_id || insp.matched_vehicle_id,
        method: 'manual',
        confidence: 1.0
      });
    }

    res.json({ success: true });
  } catch (err) {
    dtLogger.error('fmcsa_inspection_match_error', err);
    sendError(res, 500, 'Failed to match inspection');
  }
});

// POST /inspections/rematch — Re-run matching for unmatched inspections
router.post('/inspections/rematch', requireRole(['admin', 'safety']), async (req, res) => {
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) return sendError(res, 400, 'Tenant context required');

    const { carrier_id } = req.body || {};
    if (!carrier_id) return sendError(res, 400, 'carrier_id required');

    const result = await rematchInspections(tenantId, carrier_id);
    res.json({ success: true, ...result });
  } catch (err) {
    dtLogger.error('fmcsa_inspections_rematch_error', err);
    sendError(res, 500, 'Failed to rematch inspections');
  }
});

module.exports = router;
