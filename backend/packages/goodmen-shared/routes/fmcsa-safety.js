'use strict';

/**
 * FMCSA Safety Module – Express router.
 * Mounted at /api/fmcsa/safety in the integrations service.
 *
 * Internal routes (FleetNeuron safety team):
 *   GET    /api/fmcsa/safety/dashboard
 *   GET    /api/fmcsa/safety/carriers
 *   POST   /api/fmcsa/safety/carriers
 *   DELETE /api/fmcsa/safety/carriers/:id
 *   GET    /api/fmcsa/safety/carriers/:id/history
 *   GET    /api/fmcsa/safety/carriers/:id/basic-details
 *   GET    /api/fmcsa/safety/carriers/:id/basic-details/:basicName
 *   GET    /api/fmcsa/safety/carriers/:id/basic-details/:basicName/history
 *   POST   /api/fmcsa/safety/scrape
 *   POST   /api/fmcsa/safety/scrape/basic-details
 *   POST   /api/fmcsa/safety/scrape/:carrierId
 *   POST   /api/fmcsa/safety/scrape/:carrierId/basic-details
 *   GET    /api/fmcsa/safety/jobs
 *
 * Client-facing routes (tenant-scoped):
 *   GET    /api/fmcsa/safety/my-scores
 *   GET    /api/fmcsa/safety/my-scores/:dotNumber/history
 *   GET    /api/fmcsa/safety/my-scores/:dotNumber/basic-details
 */

const express = require('express');
const router = express.Router();
const knex = require('../config/knex');
const { loadUserRbac, requirePermission, requireAnyPermission } = require('../middleware/rbac-middleware');

// RBAC middleware applied to all routes
router.use(loadUserRbac);
router.use(requireAnyPermission([
  'fmcsa_safety.view',
  'fmcsa_safety.manage',
  'fmcsa_safety.scrape',
]));

const canView = requirePermission('fmcsa_safety.view');
const canManage = requirePermission('fmcsa_safety.manage');
const canScrape = requirePermission('fmcsa_safety.scrape');

// ─── Queue reference (set by initQueue) ──────────────────────────────────────
let scrapeQueue = null;

/**
 * Called by integrations-service on startup to inject the Bull queue instance.
 */
function initQueue(queue) {
  scrapeQueue = queue;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || null;
}

function userId(req) {
  return req.user?.id || null;
}

/**
 * Check if the user belongs to the platform default tenant (FleetNeuron Default).
 * The default tenant is the global admin — they can see and scrape ALL carriers.
 * Uses req.context.isGlobalAdmin set by tenant-context-middleware.
 */
function isPlatformAdmin(req) {
  return !!req.context?.isGlobalAdmin;
}

/**
 * Get the DOT numbers belonging to the user's tenant via operating_entities.
 * Returns null for platform admin / default tenant (meaning "show all").
 * Returns an array of DOT numbers for regular tenant users.
 */
async function getTenantDotNumbers(req) {
  if (isPlatformAdmin(req)) return null; // default tenant sees all

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
  if (isPlatformAdmin(req)) return carrier;

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

// ─── Internal: Trigger Scrape ────────────────────────────────────────────────

router.post('/scrape', canScrape, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) {
      return sendError(res, 403, 'Only platform admin can trigger full scrape');
    }
    if (!scrapeQueue) {
      return sendError(res, 503, 'Scrape queue not initialized');
    }
    const job = await scrapeQueue.enqueueFullScrape(userId(req));
    res.status(202).json({ message: 'Scrape started', job });
  } catch (err) {
    console.error('[fmcsa-safety] trigger scrape error', err);
    sendError(res, 500, 'Failed to trigger scrape');
  }
});

// NOTE: /scrape/basic-details must be defined BEFORE /scrape/:carrierId
// to prevent Express from matching "basic-details" as a carrierId param.
router.post('/scrape/basic-details', canScrape, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) {
      return sendError(res, 403, 'Only platform admin can trigger full BASIC detail scrape');
    }
    if (!scrapeQueue) {
      return sendError(res, 503, 'Scrape queue not initialized');
    }

    const job = await scrapeQueue.enqueueFullBasicDetailScrape(userId(req));
    res.status(202).json({ message: 'Full BASIC detail scrape started', job });
  } catch (err) {
    console.error('[fmcsa-safety] trigger full basic detail scrape error', err);
    sendError(res, 500, 'Failed to trigger full BASIC detail scrape');
  }
});

router.post('/scrape/:carrierId', canScrape, async (req, res) => {
  try {
    if (!scrapeQueue) {
      return sendError(res, 503, 'Scrape queue not initialized');
    }

    // Verify carrier exists
    const carrier = await knex('fmcsa_monitored_carriers')
      .where({ id: req.params.carrierId })
      .first();
    if (!carrier) {
      return sendError(res, 404, 'Carrier not found');
    }

    const job = await scrapeQueue.enqueueSingleScrape(req.params.carrierId, userId(req));
    res.status(202).json({ message: 'Single carrier scrape started', job });
  } catch (err) {
    console.error('[fmcsa-safety] trigger single scrape error', err);
    sendError(res, 500, 'Failed to trigger scrape');
  }
});

router.post('/scrape/:carrierId/basic-details', canScrape, async (req, res) => {
  try {
    if (!scrapeQueue) {
      return sendError(res, 503, 'Scrape queue not initialized');
    }

    const carrier = await knex('fmcsa_monitored_carriers')
      .where({ id: req.params.carrierId })
      .first();
    if (!carrier) {
      return sendError(res, 404, 'Carrier not found');
    }

    const job = await scrapeQueue.enqueueBasicDetailScrape(
      req.params.carrierId,
      userId(req)
    );
    res.status(202).json({ message: 'BASIC detail scrape started', job });
  } catch (err) {
    console.error('[fmcsa-safety] trigger basic detail scrape error', err);
    sendError(res, 500, 'Failed to trigger BASIC detail scrape');
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

    const dotNumbers = entities.map((e) => e.dot_number);

    // Get latest snapshots for these DOT numbers
    const carriers = await knex('fmcsa_monitored_carriers as mc')
      .leftJoin(
        knex('fmcsa_safety_snapshots')
          .distinctOn('monitored_carrier_id')
          .orderBy('monitored_carrier_id')
          .orderBy('scraped_at', 'desc')
          .as('s'),
        'mc.id', 's.monitored_carrier_id'
      )
      .whereIn('mc.dot_number', dotNumbers)
      .select(
        'mc.id', 'mc.dot_number', 'mc.mc_number', 'mc.legal_name',
        's.scraped_at', 's.unsafe_driving_score', 's.hos_compliance_score',
        's.vehicle_maintenance_score', 's.controlled_substances_score',
        's.driver_fitness_score', 's.crash_indicator_score', 's.hazmat_score',
        's.operating_status', 's.safety_rating', 's.total_drivers', 's.total_power_units',
        's.bipd_insurance_required', 's.bipd_insurance_on_file',
        's.cargo_insurance_required', 's.cargo_insurance_on_file',
        's.bond_insurance_required', 's.bond_insurance_on_file',
        's.authority_common', 's.authority_contract', 's.authority_broker',
        's.safety_rating_date', 's.out_of_service_date'
      )
      .orderBy('mc.legal_name');

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

    const carrier = await knex('fmcsa_monitored_carriers')
      .where({ dot_number: dotNumber })
      .first();
    if (!carrier) {
      return res.json({ snapshots: [], total: 0 });
    }

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

// Export router and initQueue
router.initQueue = initQueue;
module.exports = router;
