'use strict';

/**
 * Safety Claims & Accidents Module – Express router.
 * Mounted at /api/safety in the drivers-compliance service.
 *
 * Endpoints:
 *   GET    /api/safety/overview
 *   GET    /api/safety/incidents
 *   POST   /api/safety/incidents
 *   GET    /api/safety/incidents/:id
 *   PATCH  /api/safety/incidents/:id
 *   DELETE /api/safety/incidents/:id
 *   GET    /api/safety/incidents/:id/parties
 *   POST   /api/safety/incidents/:id/parties
 *   DELETE /api/safety/incidents/:id/parties/:partyId
 *   GET    /api/safety/incidents/:id/witnesses
 *   POST   /api/safety/incidents/:id/witnesses
 *   DELETE /api/safety/incidents/:id/witnesses/:witnessId
 *   GET    /api/safety/incidents/:id/notes
 *   POST   /api/safety/incidents/:id/notes
 *   GET    /api/safety/incidents/:id/documents
 *   POST   /api/safety/incidents/:id/documents
 *   DELETE /api/safety/incidents/:id/documents/:docId
 *   GET    /api/safety/incidents/:id/tasks
 *   POST   /api/safety/incidents/:id/tasks
 *   PATCH  /api/safety/incidents/:id/tasks/:taskId
 *   DELETE /api/safety/incidents/:id/tasks/:taskId
 *   GET    /api/safety/incidents/:id/claims
 *   POST   /api/safety/incidents/:id/claims
 *   GET    /api/safety/incidents/:id/audit-log
 *   GET    /api/safety/claims
 *   GET    /api/safety/claims/:id
 *   PATCH  /api/safety/claims/:id
 *   GET    /api/safety/tasks
 *   GET    /api/safety/reports
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const { uploadBuffer } = require('../storage/r2-storage');
const { loadUserRbac, requireAnyPermission } = require('../middleware/rbac-middleware');

// FN-479: Fire-and-forget risk score recalculation after incident changes
const { triggerRecalculation: triggerRiskRecalc } = require('./safety-risk-engine');

const SAFETY_ANY_PERMISSION = [
  'safety.incidents.view',
  'safety.incidents.create',
  'safety.incidents.edit',
  'safety.incidents.close',
  'safety.claims.view',
  'safety.claims.create',
  'safety.claims.edit',
  'safety.claims.financials.view',
  'safety.claims.financials.edit',
  'safety.documents.upload',
  'safety.reports.view',
];

const canViewIncidents = requireAnyPermission(['safety.incidents.view', 'safety.incidents.create', 'safety.incidents.edit', 'safety.incidents.close']);
const canCreateIncidents = requireAnyPermission(['safety.incidents.create', 'safety.incidents.edit']);
const canEditIncidents = requireAnyPermission(['safety.incidents.edit', 'safety.incidents.close']);
const canViewClaims = requireAnyPermission(['safety.claims.view', 'safety.claims.create', 'safety.claims.edit', 'safety.claims.financials.view', 'safety.claims.financials.edit']);
const canCreateClaims = requireAnyPermission(['safety.claims.create', 'safety.claims.edit']);
const canEditClaims = requireAnyPermission(['safety.claims.edit', 'safety.claims.financials.edit']);
const canUploadDocuments = requireAnyPermission(['safety.documents.upload', 'safety.incidents.edit']);
const canViewReports = requireAnyPermission(['safety.reports.view', 'safety.claims.view', 'safety.incidents.view']);

router.use(loadUserRbac);
router.use(requireAnyPermission(SAFETY_ANY_PERMISSION));

// ─── File upload (memory storage – max 20 MB) ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || null;
}

function operatingEntityId(req) {
  return req.context?.operatingEntityId || null;
}

function applyOperatingEntityFilter(query, req, column = 'operating_entity_id') {
  const oeId = operatingEntityId(req);
  if (oeId) query.where(column, oeId);
  return query;
}

function userId(req) {
  return req.user?.id || null;
}

function userName(req) {
  return req.user?.username || req.user?.firstName || 'System';
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireTenant(req, res) {
  const tid = tenantId(req);
  if (!tid) { sendError(res, 401, 'Tenant context required'); return null; }
  return tid;
}

/** Generate next sequential incident number: INC-YYYY-NNNN */
async function nextIncidentNumber(tid) {
  const year = new Date().getFullYear();
  const prefix = `INC-${year}-`;
  const rows = await knex('safety_incidents')
    .where('tenant_id', tid)
    .where('incident_number', 'like', `${prefix}%`)
    .count('id as cnt');
  const count = parseInt(String((rows[0] || {}).cnt || 0), 10) + 1;
  return `${prefix}${String(count).padStart(4, '0')}`;
}

/** Write a safety audit log entry */
async function logAudit(incidentId, claimId, actorId, actorName, action, field, oldVal, newVal) {
  try {
    await knex('safety_incident_audit_log').insert({
      incident_id: incidentId,
      claim_id: claimId || null,
      actor_id: actorId || null,
      actor_name: actorName || null,
      action,
      field_name: field || null,
      old_value: oldVal != null ? String(oldVal) : null,
      new_value: newVal != null ? String(newVal) : null,
    });
  } catch (e) {
    // Non-fatal
    dtLogger.error('safety_audit_log_error', e);
  }
}

async function findScopedIncident(req, incidentId, columns = ['*']) {
  const tid = tenantId(req);
  if (!tid) return null;
  return applyOperatingEntityFilter(
    knex('safety_incidents').where({ id: incidentId, tenant_id: tid }),
    req
  ).first(columns);
}

async function requireScopedIncident(req, res, incidentId, columns = ['*']) {
  const incident = await findScopedIncident(req, incidentId, columns);
  if (!incident) {
    sendError(res, 404, 'Incident not found');
    return null;
  }
  return incident;
}

async function findScopedClaim(req, claimId, columns = ['sc.*']) {
  const tid = tenantId(req);
  if (!tid) return null;
  return knex('safety_claims as sc')
    .join('safety_incidents as si', 'si.id', 'sc.incident_id')
    .where('sc.id', claimId)
    .where('sc.tenant_id', tid)
    .modify((qb) => applyOperatingEntityFilter(qb, req, 'si.operating_entity_id'))
    .select(columns)
    .first();
}

async function requireScopedClaim(req, res, claimId, columns = ['sc.*']) {
  const claim = await findScopedClaim(req, claimId, columns);
  if (!claim) {
    sendError(res, 404, 'Claim not found');
    return null;
  }
  return claim;
}

// ─── OVERVIEW ─────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/overview:
 *   get:
 *     summary: Get safety module overview dashboard
 *     description: Returns aggregate safety KPIs including open incidents, open claims, total estimated loss, total paid, overdue follow-ups, and breakdowns by operating entity. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Safety overview KPIs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 openIncidents:
 *                   type: integer
 *                 openClaims:
 *                   type: integer
 *                 totalEstimatedLoss:
 *                   type: number
 *                 totalPaid:
 *                   type: number
 *                 overdueFollowUps:
 *                   type: integer
 *                 openIncidentsByOperatingEntity:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       operating_entity_id:
 *                         type: string
 *                       operating_entity_name:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 openClaimsByOperatingEntity:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       operating_entity_id:
 *                         type: string
 *                       operating_entity_name:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 degraded:
 *                   type: boolean
 *                   description: Present and true when the response is a fallback due to a server error
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       500:
 *         description: Server error
 */
router.get('/overview', canViewIncidents, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const operatingEntityId = req.context?.operatingEntityId || null;

    const openIncidentsQuery = knex('safety_incidents').where({ tenant_id: tid }).whereNot({ status: 'closed' });
    const openClaimsQuery = knex('safety_claims').where({ tenant_id: tid }).whereNot({ status: 'closed' });
    const totalLossQuery = knex('safety_incidents').where({ tenant_id: tid });
    const paidAmountQuery = knex('safety_claims').where({ tenant_id: tid });
    const overdueTasksQuery = knex('safety_incident_tasks')
      .join('safety_incidents', 'safety_incident_tasks.incident_id', 'safety_incidents.id')
      .where('safety_incidents.tenant_id', tid)
      .whereNot('safety_incident_tasks.status', 'completed')
      .where('safety_incident_tasks.due_date', '<', new Date());

    if (operatingEntityId) {
      openIncidentsQuery.andWhere('operating_entity_id', operatingEntityId);
      openClaimsQuery.andWhere('operating_entity_id', operatingEntityId);
      totalLossQuery.andWhere('operating_entity_id', operatingEntityId);
      paidAmountQuery.andWhere('operating_entity_id', operatingEntityId);
      overdueTasksQuery.andWhere('safety_incidents.operating_entity_id', operatingEntityId);
    }

    const [openIncidents, openClaims, totalLoss, paidAmount, overdueTasks, openIncidentsByOperatingEntity, openClaimsByOperatingEntity] = await Promise.all([
      openIncidentsQuery.clone().count('id as cnt').first(),
      openClaimsQuery.clone().count('id as cnt').first(),
      totalLossQuery.clone().sum('estimated_loss_amount as total').first(),
      paidAmountQuery.clone().sum('paid_amount as total').first(),
      overdueTasksQuery.clone().count('safety_incident_tasks.id as cnt').first(),
      openIncidentsQuery
        .clone()
        .leftJoin('operating_entities as oe', 'oe.id', 'safety_incidents.operating_entity_id')
        .select(
          'safety_incidents.operating_entity_id',
          knex.raw("COALESCE(oe.name, 'Unassigned') as operating_entity_name"),
          knex.raw('COUNT(safety_incidents.id)::int as count')
        )
        .groupBy('safety_incidents.operating_entity_id', 'oe.name')
        .orderBy('count', 'desc'),
      openClaimsQuery
        .clone()
        .leftJoin('operating_entities as oe', 'oe.id', 'safety_claims.operating_entity_id')
        .select(
          'safety_claims.operating_entity_id',
          knex.raw("COALESCE(oe.name, 'Unassigned') as operating_entity_name"),
          knex.raw('COUNT(safety_claims.id)::int as count')
        )
        .groupBy('safety_claims.operating_entity_id', 'oe.name')
        .orderBy('count', 'desc'),
    ]);

    res.json({
      openIncidents: parseInt(openIncidents?.cnt || '0', 10),
      openClaims: parseInt(openClaims?.cnt || '0', 10),
      totalEstimatedLoss: parseFloat(totalLoss?.total || '0'),
      totalPaid: parseFloat(paidAmount?.total || '0'),
      overdueFollowUps: parseInt(overdueTasks?.cnt || '0', 10),
      openIncidentsByOperatingEntity,
      openClaimsByOperatingEntity,
    });
  } catch (err) {
    dtLogger.error('safety_overview_error', err);
    res.json({
      openIncidents: 0,
      openClaims: 0,
      totalEstimatedLoss: 0,
      totalPaid: 0,
      overdueFollowUps: 0,
      openIncidentsByOperatingEntity: [],
      openClaimsByOperatingEntity: [],
      degraded: true
    });
  }
});

// ─── INCIDENTS LIST ────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents:
 *   get:
 *     summary: List safety incidents
 *     description: Returns a paginated list of safety incidents with optional filters. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 25
 *         description: Number of records per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by incident status
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *         description: Filter by severity level
 *       - in: query
 *         name: incident_type
 *         schema:
 *           type: string
 *         description: Filter by incident type
 *       - in: query
 *         name: preventability
 *         schema:
 *           type: string
 *         description: Filter by preventability classification
 *       - in: query
 *         name: driver_id
 *         schema:
 *           type: string
 *         description: Filter by driver ID
 *       - in: query
 *         name: vehicle_id
 *         schema:
 *           type: string
 *         description: Filter by vehicle ID
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter incidents on or after this date
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter incidents on or before this date
 *       - in: query
 *         name: operating_entity_id
 *         schema:
 *           type: string
 *         description: Filter by operating entity ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Free-text search across incident number, city, and narrative
 *     responses:
 *       200:
 *         description: Paginated list of incidents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       incident_number:
 *                         type: string
 *                       incident_date:
 *                         type: string
 *                         format: date
 *                       status:
 *                         type: string
 *                       severity:
 *                         type: string
 *                       incident_type:
 *                         type: string
 *                       driver_name:
 *                         type: string
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 pageSize:
 *                   type: integer
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       500:
 *         description: Server error
 */
router.get('/incidents', canViewIncidents, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;

    const {
      page = 1, pageSize = 25,
      status, severity, incident_type, preventability,
      driver_id, vehicle_id,
      dateFrom, dateTo,
      operating_entity_id, search,
    } = req.query;

    let q = knex('safety_incidents as si')
      .where('si.tenant_id', tid)
      .leftJoin('drivers as drv', 'si.driver_id', 'drv.id')
      .select(
        'si.*',
        knex.raw("CONCAT(drv.first_name, ' ', drv.last_name) as driver_name"),
      )
      .orderBy('si.incident_date', 'desc');

    const activeOperatingEntityId = operatingEntityId(req);
    if (activeOperatingEntityId) {
      q = q.where('si.operating_entity_id', activeOperatingEntityId);
    }

    if (status) q = q.where('si.status', status);
    if (severity) q = q.where('si.severity', severity);
    if (incident_type) q = q.where('si.incident_type', incident_type);
    if (preventability) q = q.where('si.preventability', preventability);
    if (driver_id) q = q.where('si.driver_id', driver_id);
    if (vehicle_id) q = q.where('si.vehicle_id', vehicle_id);
    if (!activeOperatingEntityId && operating_entity_id) q = q.where('si.operating_entity_id', operating_entity_id);
    if (dateFrom) q = q.where('si.incident_date', '>=', dateFrom);
    if (dateTo) q = q.where('si.incident_date', '<=', dateTo);
    if (search) {
      q = q.where((qb) => {
        qb.whereILike('si.incident_number', `%${search}%`)
          .orWhereILike('si.location_city', `%${search}%`)
          .orWhereILike('si.narrative', `%${search}%`);
      });
    }

    const offset = (parseInt(String(page), 10) - 1) * parseInt(String(pageSize), 10);
    const [{ total }] = await q.clone().clearSelect().clearOrder().count('si.id as total');
    const rows = await q.limit(parseInt(String(pageSize), 10)).offset(offset);

    res.json({ data: rows, total: parseInt(String(total), 10), page: parseInt(String(page), 10), pageSize: parseInt(String(pageSize), 10) });
  } catch (err) {
    dtLogger.error('safety_incidents_list_error', err);
    sendError(res, 500, 'Failed to fetch incidents');
  }
});

// ─── CREATE INCIDENT ──────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents:
 *   post:
 *     summary: Create a new safety incident
 *     description: Creates a new safety incident record with an auto-generated incident number (INC-YYYY-NNNN). Triggers driver risk score recalculation. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               incident_date:
 *                 type: string
 *                 format: date
 *               incident_type:
 *                 type: string
 *               severity:
 *                 type: string
 *               status:
 *                 type: string
 *               preventability:
 *                 type: string
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *               vehicle_id:
 *                 type: string
 *                 format: uuid
 *               location_city:
 *                 type: string
 *               location_state:
 *                 type: string
 *               narrative:
 *                 type: string
 *               estimated_loss_amount:
 *                 type: number
 *               dot_recordable:
 *                 type: boolean
 *               hazmat_involved:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Incident created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 incident_number:
 *                   type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       500:
 *         description: Server error
 */
router.post('/incidents', canCreateIncidents, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const uid = userId(req);

    const incidentNumber = await nextIncidentNumber(tid);
    const payload = {
      ...req.body,
      id: knex.raw('gen_random_uuid()'),
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      incident_number: incidentNumber,
      created_by: uid,
    };

    // Sanitise – remove frontend-only fields
    delete payload.driver_name;

    const [row] = await knex('safety_incidents').insert(payload).returning('*');
    await logAudit(row.id, null, uid, userName(req), 'created', null, null, incidentNumber);

    // FN-479: fire-and-forget risk score recalculation
    if (row.driver_id) triggerRiskRecalc(tid, row.driver_id).catch(() => {});

    res.status(201).json(row);
  } catch (err) {
    dtLogger.error('safety_incident_create_error', err);
    sendError(res, 500, 'Failed to create incident');
  }
});

// ─── GET INCIDENT ─────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents/{id}:
 *   get:
 *     summary: Get a single safety incident
 *     description: Retrieves the full details of a specific safety incident by ID. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     responses:
 *       200:
 *         description: Incident details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 incident_number:
 *                   type: string
 *                 incident_date:
 *                   type: string
 *                   format: date
 *                 status:
 *                   type: string
 *                 severity:
 *                   type: string
 *                 incident_type:
 *                   type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.get('/incidents/:id', canViewIncidents, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const row = await requireScopedIncident(req, res, req.params.id);
    if (!row) return sendError(res, 404, 'Incident not found');
    res.json(row);
  } catch (err) {
    dtLogger.error('safety_incident_get_error', err);
    sendError(res, 500, 'Failed to fetch incident');
  }
});

// ─── UPDATE INCIDENT ──────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents/{id}:
 *   patch:
 *     summary: Update a safety incident
 *     description: Updates fields on an existing safety incident. Tracks changes to key fields in the audit log and triggers driver risk score recalculation. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               severity:
 *                 type: string
 *               preventability:
 *                 type: string
 *               dot_recordable:
 *                 type: boolean
 *               hazmat_involved:
 *                 type: boolean
 *               litigation_risk:
 *                 type: string
 *               root_cause:
 *                 type: string
 *               corrective_action:
 *                 type: string
 *               estimated_loss_amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Updated incident
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 incident_number:
 *                   type: string
 *                 status:
 *                   type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.patch('/incidents/:id', canEditIncidents, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const uid = userId(req);
    const existing = await requireScopedIncident(req, res, req.params.id);
    if (!existing) return;

    const updates = { ...req.body, updated_at: new Date() };
    delete updates.id; delete updates.tenant_id; delete updates.incident_number; delete updates.created_by;

    const [updated] = await applyOperatingEntityFilter(
      knex('safety_incidents').where({ id: req.params.id, tenant_id: tid }),
      req
    ).update(updates).returning('*');

    // Log changed fields
    const tracked = ['status', 'severity', 'preventability', 'dot_recordable', 'hazmat_involved', 'litigation_risk', 'root_cause', 'corrective_action', 'estimated_loss_amount'];
    for (const field of tracked) {
      if (updates[field] !== undefined && String(updates[field]) !== String(existing[field])) {
        await logAudit(req.params.id, null, uid, userName(req), 'updated', field, existing[field], updates[field]);
      }
    }

    // FN-479: fire-and-forget risk score recalculation
    const dId = updated.driver_id || existing.driver_id;
    if (dId) triggerRiskRecalc(tid, dId).catch(() => {});

    res.json(updated);
  } catch (err) {
    dtLogger.error('safety_incident_update_error', err);
    sendError(res, 500, 'Failed to update incident');
  }
});

// ─── DELETE / CLOSE INCIDENT ─────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents/{id}:
 *   delete:
 *     summary: Close (soft-delete) a safety incident
 *     description: Soft-closes an incident by setting status to closed. Preserves audit history rather than performing a hard delete. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     responses:
 *       200:
 *         description: Incident closed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.delete('/incidents/:id', canEditIncidents, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const uid = userId(req);
    const existing = await requireScopedIncident(req, res, req.params.id);
    if (!existing) return;
    // Soft-close instead of hard delete to preserve audit history
    await applyOperatingEntityFilter(
      knex('safety_incidents').where({ id: req.params.id, tenant_id: tid }),
      req
    ).update({
      status: 'closed', close_date: new Date(), closed_by: uid, updated_at: new Date(),
    });
    await logAudit(req.params.id, null, uid, userName(req), 'status_changed', 'status', existing.status, 'closed');
    res.json({ success: true });
  } catch (err) {
    dtLogger.error('safety_incident_delete_error', err);
    sendError(res, 500, 'Failed to close incident');
  }
});

// ─── PARTIES ──────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents/{id}/parties:
 *   get:
 *     summary: List parties involved in an incident
 *     description: Retrieves all third-party records associated with a safety incident. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     responses:
 *       200:
 *         description: List of parties
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   incident_id:
 *                     type: string
 *                     format: uuid
 *                   name:
 *                     type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.get('/incidents/:id/parties', canViewIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const rows = await knex('safety_incident_parties').where({ incident_id: req.params.id }).orderBy('created_at');
    res.json(rows);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch parties');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/parties:
 *   post:
 *     summary: Add a party to an incident
 *     description: Creates a new involved-party record for a safety incident. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               role:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               insurance_company:
 *                 type: string
 *               insurance_policy_number:
 *                 type: string
 *     responses:
 *       201:
 *         description: Party added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 incident_id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.post('/incidents/:id/parties', canEditIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const [row] = await knex('safety_incident_parties').insert({ ...req.body, incident_id: req.params.id }).returning('*');
    await logAudit(req.params.id, null, userId(req), userName(req), 'note_added', 'parties', null, row.name);
    res.status(201).json(row);
  } catch (err) {
    sendError(res, 500, 'Failed to add party');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/parties/{partyId}:
 *   delete:
 *     summary: Remove a party from an incident
 *     description: Deletes an involved-party record from a safety incident. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Party record ID
 *     responses:
 *       200:
 *         description: Party removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.delete('/incidents/:id/parties/:partyId', canEditIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    await knex('safety_incident_parties').where({ id: req.params.partyId, incident_id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, 'Failed to delete party');
  }
});

// ─── WITNESSES ────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents/{id}/witnesses:
 *   get:
 *     summary: List witnesses for an incident
 *     description: Retrieves all witness records associated with a safety incident. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     responses:
 *       200:
 *         description: List of witnesses
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   incident_id:
 *                     type: string
 *                     format: uuid
 *                   name:
 *                     type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.get('/incidents/:id/witnesses', canViewIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const rows = await knex('safety_incident_witnesses').where({ incident_id: req.params.id }).orderBy('created_at');
    res.json(rows);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch witnesses');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/witnesses:
 *   post:
 *     summary: Add a witness to an incident
 *     description: Creates a new witness record for a safety incident. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               statement:
 *                 type: string
 *     responses:
 *       201:
 *         description: Witness added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 incident_id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.post('/incidents/:id/witnesses', canEditIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const [row] = await knex('safety_incident_witnesses').insert({ ...req.body, incident_id: req.params.id }).returning('*');
    res.status(201).json(row);
  } catch (err) {
    sendError(res, 500, 'Failed to add witness');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/witnesses/{witnessId}:
 *   delete:
 *     summary: Remove a witness from an incident
 *     description: Deletes a witness record from a safety incident. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *       - in: path
 *         name: witnessId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Witness record ID
 *     responses:
 *       200:
 *         description: Witness removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.delete('/incidents/:id/witnesses/:witnessId', canEditIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    await knex('safety_incident_witnesses').where({ id: req.params.witnessId, incident_id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, 'Failed to delete witness');
  }
});

// ─── NOTES ────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents/{id}/notes:
 *   get:
 *     summary: List notes for an incident
 *     description: Retrieves all notes associated with a safety incident, ordered by most recent first. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     responses:
 *       200:
 *         description: List of notes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   incident_id:
 *                     type: string
 *                     format: uuid
 *                   author_id:
 *                     type: string
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.get('/incidents/:id/notes', canViewIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const rows = await knex('safety_incident_notes').where({ incident_id: req.params.id }).orderBy('created_at', 'desc');
    res.json(rows);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch notes');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/notes:
 *   post:
 *     summary: Add a note to an incident
 *     description: Creates a new note on a safety incident. The current user is recorded as the author. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               body:
 *                 type: string
 *                 description: Note content
 *               note_type:
 *                 type: string
 *     responses:
 *       201:
 *         description: Note added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 incident_id:
 *                   type: string
 *                   format: uuid
 *                 author_id:
 *                   type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.post('/incidents/:id/notes', canEditIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const uid = userId(req);
    const [row] = await knex('safety_incident_notes').insert({
      ...req.body, incident_id: req.params.id, author_id: uid,
    }).returning('*');
    await logAudit(req.params.id, null, uid, userName(req), 'note_added', 'notes', null, row.id);
    res.status(201).json(row);
  } catch (err) {
    sendError(res, 500, 'Failed to add note');
  }
});

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents/{id}/documents:
 *   get:
 *     summary: List documents for an incident
 *     description: Retrieves all uploaded documents associated with a safety incident, ordered by most recent first. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     responses:
 *       200:
 *         description: List of documents
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   incident_id:
 *                     type: string
 *                     format: uuid
 *                   document_type:
 *                     type: string
 *                   file_name:
 *                     type: string
 *                   storage_key:
 *                     type: string
 *                   file_size:
 *                     type: integer
 *                   mime_type:
 *                     type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.get('/incidents/:id/documents', canViewIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const rows = await knex('safety_incident_documents').where({ incident_id: req.params.id }).orderBy('created_at', 'desc');
    res.json(rows);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch documents');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/documents:
 *   post:
 *     summary: Upload a document to an incident
 *     description: Uploads a file (max 20 MB) to R2 storage and creates a document record linked to the incident. Optionally associates the document with a claim. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: File to upload (max 20 MB)
 *               document_type:
 *                 type: string
 *                 description: Document category (defaults to "other")
 *               claim_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional claim ID to associate the document with
 *     responses:
 *       201:
 *         description: Document uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 incident_id:
 *                   type: string
 *                   format: uuid
 *                 file_name:
 *                   type: string
 *                 storage_key:
 *                   type: string
 *                 file_size:
 *                   type: integer
 *                 mime_type:
 *                   type: string
 *       400:
 *         description: No file provided
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident or claim not found
 *       500:
 *         description: Server error
 */
router.post('/incidents/:id/documents', canUploadDocuments, upload.single('file'), async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const uid = userId(req);
    if (!req.file) return sendError(res, 400, 'No file provided');

    const claimId = req.body.claim_id || null;
    if (claimId) {
      const claim = await requireScopedClaim(req, res, claimId, ['sc.id', 'sc.incident_id']);
      if (!claim) return;
      if (String(claim.incident_id) !== String(req.params.id)) {
        return sendError(res, 404, 'Claim not found');
      }
    }
    const storageKey = claimId
      ? `safety/claims/${claimId}/${Date.now()}_${req.file.originalname}`
      : `safety/incidents/${req.params.id}/${Date.now()}_${req.file.originalname}`;
    await uploadBuffer(req.file.buffer, storageKey, req.file.mimetype);

    const [row] = await knex('safety_incident_documents').insert({
      incident_id: req.params.id,
      claim_id: claimId,
      document_type: req.body.document_type || 'other',
      file_name: req.file.originalname,
      storage_key: storageKey,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_by: uid,
    }).returning('*');

    await logAudit(req.params.id, claimId, uid, userName(req), 'doc_uploaded', 'documents', null, req.file.originalname);
    res.status(201).json(row);
  } catch (err) {
    dtLogger.error('safety_doc_upload_error', err);
    sendError(res, 500, 'Failed to upload document');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/documents/{docId}:
 *   delete:
 *     summary: Delete a document from an incident
 *     description: Removes a document record from a safety incident. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *       - in: path
 *         name: docId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document record ID
 *     responses:
 *       200:
 *         description: Document deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.delete('/incidents/:id/documents/:docId', canUploadDocuments, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    await knex('safety_incident_documents').where({ id: req.params.docId, incident_id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, 'Failed to delete document');
  }
});

// ─── TASKS ────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents/{id}/tasks:
 *   get:
 *     summary: List tasks for an incident
 *     description: Retrieves all follow-up tasks associated with a safety incident, ordered by due date. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     responses:
 *       200:
 *         description: List of tasks
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   incident_id:
 *                     type: string
 *                     format: uuid
 *                   status:
 *                     type: string
 *                   due_date:
 *                     type: string
 *                     format: date
 *                   assigned_to:
 *                     type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.get('/incidents/:id/tasks', canViewIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const rows = await knex('safety_incident_tasks').where({ incident_id: req.params.id }).orderBy('due_date');
    res.json(rows);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch tasks');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/tasks:
 *   post:
 *     summary: Create a task for an incident
 *     description: Creates a new follow-up task on a safety incident. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *               due_date:
 *                 type: string
 *                 format: date
 *               assigned_to:
 *                 type: string
 *     responses:
 *       201:
 *         description: Task created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 incident_id:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                 due_date:
 *                   type: string
 *                   format: date
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.post('/incidents/:id/tasks', canEditIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const uid = userId(req);
    const [row] = await knex('safety_incident_tasks').insert({
      ...req.body, incident_id: req.params.id, created_by: uid,
    }).returning('*');
    res.status(201).json(row);
  } catch (err) {
    sendError(res, 500, 'Failed to create task');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/tasks/{taskId}:
 *   patch:
 *     summary: Update an incident task
 *     description: Updates fields on a follow-up task. Automatically sets completed_at and completed_by when status transitions to completed. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *               due_date:
 *                 type: string
 *                 format: date
 *               assigned_to:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated task
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 status:
 *                   type: string
 *                 completed_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.patch('/incidents/:id/tasks/:taskId', canEditIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const uid = userId(req);
    const updates = { ...req.body, updated_at: new Date() };
    if (updates.status === 'completed' && !updates.completed_at) {
      updates.completed_at = new Date();
      updates.completed_by = uid;
    }
    delete updates.id; delete updates.incident_id;
    const [row] = await knex('safety_incident_tasks').where({ id: req.params.taskId, incident_id: req.params.id }).update(updates).returning('*');
    res.json(row);
  } catch (err) {
    sendError(res, 500, 'Failed to update task');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/tasks/{taskId}:
 *   delete:
 *     summary: Delete an incident task
 *     description: Removes a follow-up task from a safety incident. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Task ID
 *     responses:
 *       200:
 *         description: Task deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.delete('/incidents/:id/tasks/:taskId', canEditIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    await knex('safety_incident_tasks').where({ id: req.params.taskId, incident_id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, 'Failed to delete task');
  }
});

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents/{id}/audit-log:
 *   get:
 *     summary: Get audit log for an incident
 *     description: Retrieves the full change history for a safety incident, including status transitions, field updates, document uploads, and claim linkages. Per 49 CFR Part 390.15 — Accident Register.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     responses:
 *       200:
 *         description: Audit log entries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   incident_id:
 *                     type: string
 *                     format: uuid
 *                   claim_id:
 *                     type: string
 *                     format: uuid
 *                     nullable: true
 *                   actor_id:
 *                     type: string
 *                   actor_name:
 *                     type: string
 *                   action:
 *                     type: string
 *                   field_name:
 *                     type: string
 *                     nullable: true
 *                   old_value:
 *                     type: string
 *                     nullable: true
 *                   new_value:
 *                     type: string
 *                     nullable: true
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.get('/incidents/:id/audit-log', canViewIncidents, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const rows = await knex('safety_incident_audit_log').where({ incident_id: req.params.id }).orderBy('created_at', 'desc');
    res.json(rows);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch audit log');
  }
});

// ─── CLAIMS (per incident) ────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/incidents/{id}/claims:
 *   get:
 *     summary: List claims for an incident
 *     description: Retrieves all insurance claims linked to a specific safety incident. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     responses:
 *       200:
 *         description: List of claims for the incident
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   incident_id:
 *                     type: string
 *                     format: uuid
 *                   internal_claim_number:
 *                     type: string
 *                   status:
 *                     type: string
 *                   claim_type:
 *                     type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.get('/incidents/:id/claims', canViewClaims, async (req, res) => {
  try {
    const incident = await requireScopedIncident(req, res, req.params.id, ['id']);
    if (!incident) return;
    const rows = await knex('safety_claims').where({ incident_id: req.params.id }).orderBy('created_at');
    res.json(rows);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch claims');
  }
});

/**
 * @openapi
 * /api/safety/incidents/{id}/claims:
 *   post:
 *     summary: Create a claim for an incident
 *     description: Creates a new insurance claim linked to a safety incident with an auto-generated claim number (CLM-YYYY-NNNN). Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Incident ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               claim_type:
 *                 type: string
 *               status:
 *                 type: string
 *               insurance_carrier:
 *                 type: string
 *               external_claim_number:
 *                 type: string
 *               opened_date:
 *                 type: string
 *                 format: date
 *               paid_amount:
 *                 type: number
 *               reserve_amount:
 *                 type: number
 *               net_loss_amount:
 *                 type: number
 *     responses:
 *       201:
 *         description: Claim created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 internal_claim_number:
 *                   type: string
 *                 incident_id:
 *                   type: string
 *                   format: uuid
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Incident not found
 *       500:
 *         description: Server error
 */
router.post('/incidents/:id/claims', canCreateClaims, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const uid = userId(req);
    const incident = await requireScopedIncident(req, res, req.params.id, ['id', 'operating_entity_id']);
    if (!incident) return;

    // Auto-generate internal claim number: CLM-YYYY-NNNN
    const year = new Date().getFullYear();
    const prefix = `CLM-${year}-`;
    const [{ cnt }] = await knex('safety_claims').where('tenant_id', tid).where('internal_claim_number', 'like', `${prefix}%`).count('id as cnt');
    const num = parseInt(String(cnt || 0), 10) + 1;
    const internalClaimNumber = `${prefix}${String(num).padStart(4, '0')}`;

    const [row] = await knex('safety_claims').insert({
      ...req.body,
      id: knex.raw('gen_random_uuid()'),
      incident_id: req.params.id,
      tenant_id: tid,
      operating_entity_id: incident.operating_entity_id || null,
      internal_claim_number: internalClaimNumber,
      created_by: uid,
    }).returning('*');

    await logAudit(req.params.id, row.id, uid, userName(req), 'claim_linked', 'claims', null, internalClaimNumber);
    res.status(201).json(row);
  } catch (err) {
    dtLogger.error('safety_claim_create_error', err);
    sendError(res, 500, 'Failed to create claim');
  }
});

// ─── CLAIMS (global list) ─────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/claims:
 *   get:
 *     summary: List all claims across incidents
 *     description: Returns a paginated list of all insurance claims with related incident data. Supports filtering by status, claim type, and overdue follow-ups. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 25
 *         description: Number of records per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by claim status
 *       - in: query
 *         name: claim_type
 *         schema:
 *           type: string
 *         description: Filter by claim type
 *       - in: query
 *         name: overdue_only
 *         schema:
 *           type: string
 *           enum:
 *             - "true"
 *             - "false"
 *         description: When "true", returns only non-closed claims past their next follow-up date
 *     responses:
 *       200:
 *         description: Paginated list of claims
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       internal_claim_number:
 *                         type: string
 *                       status:
 *                         type: string
 *                       claim_type:
 *                         type: string
 *                       incident_number:
 *                         type: string
 *                       incident_date:
 *                         type: string
 *                         format: date
 *                       incident_type:
 *                         type: string
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 pageSize:
 *                   type: integer
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       500:
 *         description: Server error
 */
router.get('/claims', canViewClaims, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { page = 1, pageSize = 25, status, claim_type, overdue_only } = req.query;

    let q = knex('safety_claims as sc')
      .where('sc.tenant_id', tid)
      .join('safety_incidents as si', 'sc.incident_id', 'si.id')
      .select('sc.*', 'si.incident_number', 'si.incident_date', 'si.incident_type')
      .orderBy('sc.created_at', 'desc');

    q = q.modify((qb) => applyOperatingEntityFilter(qb, req, 'si.operating_entity_id'));

    if (status) q = q.where('sc.status', status);
    if (claim_type) q = q.where('sc.claim_type', claim_type);
    if (overdue_only === 'true') q = q.where('sc.next_followup_date', '<', new Date()).whereNot('sc.status', 'closed');

    const offset = (parseInt(String(page), 10) - 1) * parseInt(String(pageSize), 10);
    const [{ total }] = await q.clone().clearSelect().clearOrder().count('sc.id as total');
    const rows = await q.limit(parseInt(String(pageSize), 10)).offset(offset);

    res.json({ data: rows, total: parseInt(String(total), 10), page: parseInt(String(page), 10), pageSize: parseInt(String(pageSize), 10) });
  } catch (err) {
    dtLogger.error('safety_claims_list_error', err);
    sendError(res, 500, 'Failed to fetch claims');
  }
});

/**
 * @openapi
 * /api/safety/claims/{id}:
 *   get:
 *     summary: Get a single claim
 *     description: Retrieves the full details of a specific insurance claim by ID. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Claim ID
 *     responses:
 *       200:
 *         description: Claim details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 internal_claim_number:
 *                   type: string
 *                 status:
 *                   type: string
 *                 claim_type:
 *                   type: string
 *                 incident_id:
 *                   type: string
 *                   format: uuid
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Claim not found
 *       500:
 *         description: Server error
 */
router.get('/claims/:id', canViewClaims, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const row = await requireScopedClaim(req, res, req.params.id);
    if (!row) return;
    res.json(row);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch claim');
  }
});

/**
 * @openapi
 * /api/safety/claims/{id}:
 *   patch:
 *     summary: Update a claim
 *     description: Updates fields on an existing insurance claim. Status changes are recorded in the incident audit log. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Claim ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               claim_type:
 *                 type: string
 *               insurance_carrier:
 *                 type: string
 *               external_claim_number:
 *                 type: string
 *               paid_amount:
 *                 type: number
 *               reserve_amount:
 *                 type: number
 *               net_loss_amount:
 *                 type: number
 *               next_followup_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Updated claim
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 internal_claim_number:
 *                   type: string
 *                 status:
 *                   type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       404:
 *         description: Claim not found
 *       500:
 *         description: Server error
 */
router.patch('/claims/:id', canEditClaims, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const uid = userId(req);
    const existing = await requireScopedClaim(req, res, req.params.id, ['sc.*', 'si.operating_entity_id as incident_operating_entity_id']);
    if (!existing) return;

    const updates = { ...req.body, updated_at: new Date() };
    delete updates.id; delete updates.tenant_id; delete updates.incident_id; delete updates.created_by;

    const [updated] = await knex('safety_claims as sc')
      .join('safety_incidents as si', 'si.id', 'sc.incident_id')
      .where('sc.id', req.params.id)
      .where('sc.tenant_id', tid)
      .modify((qb) => applyOperatingEntityFilter(qb, req, 'si.operating_entity_id'))
      .update(updates)
      .returning('sc.*');

    if (updates.status && updates.status !== existing.status) {
      await logAudit(existing.incident_id, req.params.id, uid, userName(req), 'status_changed', 'status', existing.status, updates.status);
    }
    res.json(updated);
  } catch (err) {
    dtLogger.error('safety_claim_update_error', err);
    sendError(res, 500, 'Failed to update claim');
  }
});

// ─── ALL TASKS (global view for overdue dashboard) ────────────────────────────

/**
 * @openapi
 * /api/safety/tasks:
 *   get:
 *     summary: List all safety tasks across incidents
 *     description: Returns a global view of follow-up tasks across all safety incidents, used for the overdue tasks dashboard. Supports filtering by status, assignee, and overdue flag. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by task status
 *       - in: query
 *         name: assigned_to
 *         schema:
 *           type: string
 *         description: Filter by assigned user ID
 *       - in: query
 *         name: overdue_only
 *         schema:
 *           type: string
 *           enum:
 *             - "true"
 *             - "false"
 *         description: When "true", returns only non-completed tasks past their due date
 *     responses:
 *       200:
 *         description: List of tasks (max 200)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   incident_id:
 *                     type: string
 *                     format: uuid
 *                   status:
 *                     type: string
 *                   due_date:
 *                     type: string
 *                     format: date
 *                   assigned_to:
 *                     type: string
 *                   incident_number:
 *                     type: string
 *                   incident_type:
 *                     type: string
 *                   incident_status:
 *                     type: string
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       500:
 *         description: Server error
 */
router.get('/tasks', canViewIncidents, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { overdue_only, assigned_to, status } = req.query;

    let q = knex('safety_incident_tasks as t')
      .join('safety_incidents as si', 't.incident_id', 'si.id')
      .where('si.tenant_id', tid)
      .select('t.*', 'si.incident_number', 'si.incident_type', 'si.status as incident_status')
      .orderBy('t.due_date');

    q = q.modify((qb) => applyOperatingEntityFilter(qb, req, 'si.operating_entity_id'));

    if (status) q = q.where('t.status', status);
    if (assigned_to) q = q.where('t.assigned_to', assigned_to);
    if (overdue_only === 'true') {
      q = q.whereNot('t.status', 'completed').where('t.due_date', '<', new Date());
    }

    const rows = await q.limit(200);
    res.json(rows);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch tasks');
  }
});

// ─── REPORTS ──────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/safety/reports:
 *   get:
 *     summary: Get safety analytics and reports
 *     description: Returns aggregated safety analytics including incidents by month, claims by status, preventability breakdown, loss by claim type, severity distribution, top-cost incidents, and claim aging. Per 49 CFR Part 385 — Safety Fitness Procedures.
 *     tags:
 *       - Safety
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter incidents on or after this date
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter incidents on or before this date
 *     responses:
 *       200:
 *         description: Safety report aggregations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 incidentsByMonth:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       month:
 *                         type: string
 *                         example: "2026-03"
 *                       count:
 *                         type: integer
 *                 claimsByStatus:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       status:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 preventability:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       preventability:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 lossByClaimType:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       claim_type:
 *                         type: string
 *                       total_paid:
 *                         type: number
 *                       total_loss:
 *                         type: number
 *                 bySeverity:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       severity:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 topCostIncidents:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       incident_number:
 *                         type: string
 *                       incident_date:
 *                         type: string
 *                         format: date
 *                       incident_type:
 *                         type: string
 *                       estimated_loss_amount:
 *                         type: number
 *                 claimAging:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       internal_claim_number:
 *                         type: string
 *                       status:
 *                         type: string
 *                       claim_type:
 *                         type: string
 *                       opened_date:
 *                         type: string
 *                         format: date
 *                       insurance_carrier:
 *                         type: string
 *                 degraded:
 *                   type: boolean
 *                   description: Present and true when the response is a fallback due to a server error
 *       401:
 *         description: Unauthorized — invalid or missing JWT
 *       500:
 *         description: Server error
 */
router.get('/reports', canViewReports, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { dateFrom, dateTo } = req.query;

    const dateFilter = (q, alias = 'si') => {
      if (dateFrom) q = q.where(`${alias}.incident_date`, '>=', dateFrom);
      if (dateTo) q = q.where(`${alias}.incident_date`, '<=', dateTo);
      q = applyOperatingEntityFilter(q, req, `${alias}.operating_entity_id`);
      return q;
    };

    // Incidents by month
    const byMonthRaw = await dateFilter(
      knex('safety_incidents').where({ tenant_id: tid })
    ).select(
      knex.raw("to_char(incident_date, 'YYYY-MM') as month"),
      knex.raw('COUNT(*) as count'),
    ).groupByRaw("to_char(incident_date, 'YYYY-MM')").orderByRaw("1");

    // Claims by status
    const claimsByStatus = await knex('safety_claims')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .select('status')
      .count('id as count')
      .groupBy('status');

    // Preventable vs non-preventable
    const preventability = await dateFilter(
      knex('safety_incidents').where({ tenant_id: tid })
    ).select('preventability').count('id as count').groupBy('preventability');

    // Loss by claim type
    const lossByType = await knex('safety_claims')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .select('claim_type')
      .sum('paid_amount as total_paid')
      .sum('net_loss_amount as total_loss')
      .groupBy('claim_type');

    // Severity distribution
    const bySeverity = await dateFilter(
      knex('safety_incidents').where({ tenant_id: tid })
    ).select('severity').count('id as count').groupBy('severity');

    // Top cost incidents (top 10)
    const topCost = await dateFilter(
      knex('safety_incidents').where({ tenant_id: tid })
    ).select('id', 'incident_number', 'incident_date', 'incident_type', 'estimated_loss_amount')
      .orderBy('estimated_loss_amount', 'desc').limit(10);

    // Claim aging (days since opened)
    const claimAging = await knex('safety_claims')
      .where({ tenant_id: tid }).whereNot({ status: 'closed' })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .select('id', 'internal_claim_number', 'status', 'claim_type', 'opened_date', 'insurance_carrier')
      .orderBy('opened_date');

    res.json({
      incidentsByMonth: byMonthRaw,
      claimsByStatus,
      preventability,
      lossByClaimType: lossByType,
      bySeverity,
      topCostIncidents: topCost,
      claimAging,
    });
  } catch (err) {
    dtLogger.error('safety_reports_error', err);
    res.json({
      incidentsByMonth: [],
      claimsByStatus: [],
      preventability: [],
      lossByClaimType: [],
      bySeverity: [],
      topCostIncidents: [],
      claimAging: [],
      degraded: true
    });
  }
});

module.exports = router;
