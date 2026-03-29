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
