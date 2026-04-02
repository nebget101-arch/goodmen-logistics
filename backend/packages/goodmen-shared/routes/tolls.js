'use strict';

/**
 * Tolls API – Phase 1 scaffold + CSV import pipeline + settlement integration.
 * Mounted at /api/tolls in logistics service.
 *
 * Import endpoints (FN-431):
 *   POST   /api/tolls/import/upload           – upload & parse CSV
 *   POST   /api/tolls/import/commit           – commit mapped rows
 *   GET    /api/tolls/import/mapping-profiles  – list mapping profiles
 *   POST   /api/tolls/import/mapping-profiles  – create mapping profile
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const { recalcAndUpdateSettlement, applyVariableExpenseToSettlement } = require('../services/settlement-service');

// ─── File upload (memory storage – max 10 MB) ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream', 'text/plain'
    ];
    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    if (allowed.includes(file.mimetype) || ['csv', 'xlsx', 'xls', 'txt'].includes(ext)) {
      return cb(null, true);
    }
    cb(new Error('Only CSV and XLSX files are accepted'));
  }
});

const invoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpg|jpeg|png|pdf|webp/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext) || allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG, PDF, and WebP files are allowed'));
  }
});

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

function requireTenant(req, res) {
  const tid = tenantId(req);
  if (!tid) {
    res.status(401).json({ error: 'Tenant context required' });
    return null;
  }
  return tid;
}

/**
 * @openapi
 * /api/tolls:
 *   get:
 *     summary: Tolls API root
 *     description: Returns the Phase 1 scaffold message and a map of available endpoints.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Scaffold info with endpoint list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 endpoints:
 *                   type: object
 *                   properties:
 *                     overview:
 *                       type: string
 *                     accounts:
 *                       type: string
 *                     devices:
 *                       type: string
 *                     importBatches:
 *                       type: string
 */
router.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Tolls API (Phase 1 scaffold)',
    endpoints: {
      overview: '/api/tolls/overview',
      accounts: '/api/tolls/accounts',
      devices: '/api/tolls/devices',
      importBatches: '/api/tolls/import/batches'
    }
  });
});

/**
 * @openapi
 * /api/tolls/overview:
 *   get:
 *     summary: Toll module overview
 *     description: Returns aggregate counts for accounts, devices, transactions, and open exceptions, plus the most recent import batch.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Overview cards and last batch
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 cards:
 *                   type: object
 *                   properties:
 *                     accounts:
 *                       type: integer
 *                     devices:
 *                       type: integer
 *                     transactions:
 *                       type: integer
 *                     openExceptions:
 *                       type: integer
 *                 lastBatch:
 *                   type: object
 *                   nullable: true
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.get('/overview', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const [accounts] = await applyOperatingEntityFilter(knex('toll_accounts').where({ tenant_id: tid }), req).count('* as count');
    const [devices] = await applyOperatingEntityFilter(knex('toll_devices').where({ tenant_id: tid }), req).count('* as count');
    const [transactions] = await applyOperatingEntityFilter(knex('toll_transactions').where({ tenant_id: tid }), req).count('* as count');
    const [openExceptions] = await knex('toll_transaction_exceptions as e')
      .join('toll_transactions as tt', 'tt.id', 'e.toll_transaction_id')
      .where({ 'e.tenant_id': tid, 'e.resolution_status': 'open' })
      .modify((qb) => applyOperatingEntityFilter(qb, req, 'tt.operating_entity_id'))
      .count('* as count');

    const lastBatch = await knex('toll_import_batches')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .orderBy('started_at', 'desc')
      .first(['id', 'provider_name', 'source_file_name', 'import_status', 'started_at', 'total_rows', 'success_rows', 'failed_rows']);

    res.json({
      success: true,
      cards: {
        accounts: Number(accounts?.count || 0),
        devices: Number(devices?.count || 0),
        transactions: Number(transactions?.count || 0),
        openExceptions: Number(openExceptions?.count || 0)
      },
      lastBatch: lastBatch || null
    });
  } catch (error) {
    dtLogger.error('tolls_overview_failed', error);
    res.status(500).json({ error: 'Failed to fetch toll overview' });
  }
});

/**
 * @openapi
 * /api/tolls/accounts:
 *   get:
 *     summary: List toll accounts
 *     description: Returns all toll accounts for the current tenant, ordered by creation date descending.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of toll account objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.get('/accounts', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const rows = await applyOperatingEntityFilter(knex('toll_accounts').where({ tenant_id: tid }), req).orderBy('created_at', 'desc');
    res.json(rows);
  } catch (error) {
    dtLogger.error('tolls_accounts_list_failed', error);
    res.status(500).json({ error: 'Failed to fetch toll accounts' });
  }
});

/**
 * @openapi
 * /api/tolls/accounts:
 *   post:
 *     summary: Create a toll account
 *     description: Creates a new toll account for the current tenant.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider_name, display_name]
 *             properties:
 *               provider_name:
 *                 type: string
 *               display_name:
 *                 type: string
 *               account_number_masked:
 *                 type: string
 *               import_method:
 *                 type: string
 *                 enum: [manual_upload, api]
 *                 default: manual_upload
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created toll account
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.post('/accounts', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { provider_name, display_name, account_number_masked, import_method, notes } = req.body || {};
    if (!provider_name || !display_name) {
      return res.status(400).json({ error: 'provider_name and display_name are required' });
    }

    const [row] = await knex('toll_accounts')
      .insert({
        tenant_id: tid,
        operating_entity_id: operatingEntityId(req),
        provider_name,
        display_name,
        account_number_masked: account_number_masked || null,
        import_method: import_method || 'manual_upload',
        notes: notes || null,
        created_by: req.user?.id || null
      })
      .returning('*');

    res.status(201).json(row);
  } catch (error) {
    dtLogger.error('tolls_account_create_failed', error);
    res.status(500).json({ error: 'Failed to create toll account' });
  }
});

/**
 * @openapi
 * /api/tolls/accounts/{id}:
 *   patch:
 *     summary: Update a toll account
 *     description: Partially updates an existing toll account. Only the provided fields are changed.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Toll account ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               display_name:
 *                 type: string
 *               account_number_masked:
 *                 type: string
 *               import_method:
 *                 type: string
 *               status:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated toll account
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Toll account not found
 *       500:
 *         description: Server error
 */
router.patch('/accounts/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const allowed = ['display_name', 'account_number_masked', 'import_method', 'status', 'notes'];
    const patch = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) patch[key] = req.body[key];
    }
    patch.updated_at = new Date();

    const [row] = await knex('toll_accounts')
      .modify((qb) => {
        qb.where({ id: req.params.id, tenant_id: tid });
        applyOperatingEntityFilter(qb, req);
      })
      .update(patch)
      .returning('*');

    if (!row) return res.status(404).json({ error: 'Toll account not found' });
    res.json(row);
  } catch (error) {
    dtLogger.error('tolls_account_patch_failed', error);
    res.status(500).json({ error: 'Failed to update toll account' });
  }
});

/**
 * @openapi
 * /api/tolls/devices:
 *   get:
 *     summary: List toll devices
 *     description: Returns all toll devices (transponders) for the current tenant, ordered by creation date descending.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of toll device objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.get('/devices', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const rows = await applyOperatingEntityFilter(knex('toll_devices').where({ tenant_id: tid }), req).orderBy('created_at', 'desc');
    res.json(rows);
  } catch (error) {
    dtLogger.error('tolls_devices_list_failed', error);
    res.status(500).json({ error: 'Failed to fetch toll devices' });
  }
});

// FN-451: Validate truck_id / driver_id references exist for the tenant
async function validateDeviceRefs(tid, body) {
  const errors = [];
  if (body.truck_id) {
    const truck = await knex('vehicles').where({ id: body.truck_id, tenant_id: tid }).first('id');
    if (!truck) errors.push(`truck_id "${body.truck_id}" does not exist for this tenant`);
  }
  if (body.driver_id) {
    const driver = await knex('drivers').where({ id: body.driver_id, tenant_id: tid }).first('id');
    if (!driver) errors.push(`driver_id "${body.driver_id}" does not exist for this tenant`);
  }
  return errors;
}

function resolveDeviceNumber(body = {}) {
  return body.device_number_masked ?? body.device_number ?? null;
}

/**
 * @openapi
 * /api/tolls/devices:
 *   post:
 *     summary: Create a toll device
 *     description: Creates a new toll device (transponder) linked to a toll account. Validates truck_id and driver_id references.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [toll_account_id]
 *             properties:
 *               toll_account_id:
 *                 type: string
 *                 format: uuid
 *               device_number_masked:
 *                 type: string
 *               plate_number:
 *                 type: string
 *               truck_id:
 *                 type: string
 *                 format: uuid
 *               trailer_id:
 *                 type: string
 *                 format: uuid
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *               effective_start_date:
 *                 type: string
 *                 format: date
 *               effective_end_date:
 *                 type: string
 *                 format: date
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created toll device
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing required fields or invalid references
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Toll account not found
 *       500:
 *         description: Server error
 */
router.post('/devices', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const {
      toll_account_id,
      plate_number,
      truck_id,
      trailer_id,
      driver_id,
      effective_start_date,
      effective_end_date,
      notes
    } = req.body || {};
    const deviceNumber = resolveDeviceNumber(req.body);
    if (!toll_account_id) return res.status(400).json({ error: 'toll_account_id is required' });

    // Validate truck_id / driver_id references
    const refErrors = await validateDeviceRefs(tid, req.body);
    if (refErrors.length > 0) return res.status(400).json({ error: refErrors.join('; ') });

    const account = await applyOperatingEntityFilter(
      knex('toll_accounts').where({ id: toll_account_id, tenant_id: tid }),
      req
    ).first(['id']);
    if (!account) return res.status(404).json({ error: 'Toll account not found' });

    const [row] = await knex('toll_devices')
      .insert({
        tenant_id: tid,
        operating_entity_id: operatingEntityId(req),
        toll_account_id,
        device_number_masked: deviceNumber,
        plate_number: plate_number || null,
        truck_id: truck_id || null,
        trailer_id: trailer_id || null,
        driver_id: driver_id || null,
        effective_start_date: effective_start_date || null,
        effective_end_date: effective_end_date || null,
        notes: notes || null
      })
      .returning('*');

    res.status(201).json(row);
  } catch (error) {
    dtLogger.error('tolls_device_create_failed', error);
    res.status(500).json({ error: 'Failed to create toll device' });
  }
});

/**
 * @openapi
 * /api/tolls/devices/{id}:
 *   patch:
 *     summary: Update a toll device
 *     description: Partially updates an existing toll device. Validates truck_id and driver_id references if provided.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Toll device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               device_number_masked:
 *                 type: string
 *               plate_number:
 *                 type: string
 *               truck_id:
 *                 type: string
 *                 format: uuid
 *               trailer_id:
 *                 type: string
 *                 format: uuid
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *               effective_start_date:
 *                 type: string
 *                 format: date
 *               effective_end_date:
 *                 type: string
 *                 format: date
 *               status:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated toll device
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Invalid references
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Toll device not found
 *       500:
 *         description: Server error
 */
router.patch('/devices/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    // Validate truck_id / driver_id references if provided
    const refErrors = await validateDeviceRefs(tid, req.body || {});
    if (refErrors.length > 0) return res.status(400).json({ error: refErrors.join('; ') });

    const allowed = [
      'device_number_masked', 'plate_number', 'truck_id', 'trailer_id', 'driver_id',
      'effective_start_date', 'effective_end_date', 'status', 'notes'
    ];
    const patch = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) patch[key] = req.body[key];
    }
    if (req.body?.device_number !== undefined && req.body?.device_number_masked === undefined) {
      patch.device_number_masked = req.body.device_number;
    }
    patch.updated_at = new Date();

    const [row] = await knex('toll_devices')
      .modify((qb) => {
        qb.where({ id: req.params.id, tenant_id: tid });
        applyOperatingEntityFilter(qb, req);
      })
      .update(patch)
      .returning('*');

    if (!row) return res.status(404).json({ error: 'Toll device not found' });
    res.json(row);
  } catch (error) {
    dtLogger.error('tolls_device_patch_failed', error);
    res.status(500).json({ error: 'Failed to update toll device' });
  }
});

async function listImportBatches(req, res) {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const rows = await knex('toll_import_batches')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .orderBy('started_at', 'desc')
      .limit(limit)
      .offset(offset);

    const [{ total }] = await applyOperatingEntityFilter(knex('toll_import_batches').where({ tenant_id: tid }), req).count('* as total');
    res.json({ rows, total: Number(total || 0) });
  } catch (error) {
    dtLogger.error('tolls_batches_list_failed', error);
    res.status(500).json({ error: 'Failed to fetch toll import batches' });
  }
}

/**
 * @openapi
 * /api/tolls/import/batches:
 *   get:
 *     summary: List import batches
 *     description: Returns paginated toll import batches for the current tenant, ordered by start date descending. Also available at /api/tolls/import and /api/tolls/history.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *         description: Maximum number of batches to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of batches to skip
 *     responses:
 *       200:
 *         description: Paginated list of import batches
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.get('/import', listImportBatches);
router.get('/history', listImportBatches);
router.get('/import/batches', listImportBatches);

/**
 * @openapi
 * /api/tolls/transactions:
 *   get:
 *     summary: List toll transactions
 *     description: Returns paginated toll transactions with optional filters for date range, driver, truck, batch, and validation status.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of transactions to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of transactions to skip
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions on or after this date
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter transactions on or before this date
 *       - in: query
 *         name: driver_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by driver ID
 *       - in: query
 *         name: truck_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by truck ID
 *       - in: query
 *         name: batch_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by import batch ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [valid, exception]
 *         description: Filter by validation status
 *     responses:
 *       200:
 *         description: Paginated list of toll transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.get('/transactions', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const { limit = 50, offset = 0, date_from, date_to, driver_id, truck_id, batch_id, status } = req.query;

    let q = applyOperatingEntityFilter(
      knex('toll_transactions as tt')
        .leftJoin('vehicles as v', 'v.id', 'tt.truck_id')
        .leftJoin('drivers as d', 'd.id', 'tt.driver_id')
        .where('tt.tenant_id', tid),
      req,
      'tt.operating_entity_id'
    )
      .select(
        'tt.*',
        knex.raw("COALESCE(v.unit_number, v.license_plate, tt.unit_number_raw) AS truck_display"),
        knex.raw("COALESCE(d.first_name || ' ' || d.last_name, tt.driver_name_raw) AS driver_display")
      )
      .orderBy('tt.transaction_date', 'desc');

    if (date_from) q = q.where('tt.transaction_date', '>=', date_from);
    if (date_to) q = q.where('tt.transaction_date', '<=', date_to);
    if (driver_id) q = q.where('tt.driver_id', driver_id);
    if (truck_id) q = q.where('tt.truck_id', truck_id);
    if (batch_id) q = q.where('tt.source_batch_id', batch_id);
    if (status) q = q.where('tt.validation_status', status);

    const total = await applyOperatingEntityFilter(
      knex('toll_transactions').where('tenant_id', tid),
      req
    )
      .modify((qb) => {
        if (date_from) qb.where('transaction_date', '>=', date_from);
        if (date_to) qb.where('transaction_date', '<=', date_to);
        if (driver_id) qb.where('driver_id', driver_id);
        if (truck_id) qb.where('truck_id', truck_id);
        if (batch_id) qb.where('source_batch_id', batch_id);
        if (status) qb.where('validation_status', status);
      })
      .count('* as total')
      .first();

    const rows = await q.limit(Number(limit)).offset(Number(offset));
    res.json({ rows, total: Number(total?.total || 0) });
  } catch (error) {
    dtLogger.error('tolls_transactions_list_failed', error);
    res.status(500).json({ error: 'Failed to fetch toll transactions' });
  }
});

// ─── Manual Toll Transaction Entry (FN-427) ──────────────────────────────────
function buildDedupeHash(tenantId, provider, externalId, date, amount) {
  const raw = [tenantId, provider || '', externalId || '', date || '', String(amount || 0)].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * @openapi
 * /api/tolls/transactions:
 *   post:
 *     summary: Create a manual toll transaction
 *     description: Creates a single toll transaction with deduplication. Validates truck_id and driver_id references. Returns 409 if a duplicate is detected.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transaction_date, provider_name, amount]
 *             properties:
 *               transaction_date:
 *                 type: string
 *                 format: date
 *               provider_name:
 *                 type: string
 *               plaza_name:
 *                 type: string
 *               entry_location:
 *                 type: string
 *               exit_location:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *                 maxLength: 2
 *               amount:
 *                 type: number
 *               truck_id:
 *                 type: string
 *                 format: uuid
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *               load_id:
 *                 type: string
 *                 format: uuid
 *               notes:
 *                 type: string
 *               external_transaction_id:
 *                 type: string
 *               device_number_masked:
 *                 type: string
 *               plate_number_raw:
 *                 type: string
 *               unit_number_raw:
 *                 type: string
 *               driver_name_raw:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created toll transaction
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing required fields or invalid references
 *       401:
 *         description: Tenant context required
 *       409:
 *         description: Duplicate transaction detected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 existingId:
 *                   type: string
 *       500:
 *         description: Server error
 */
router.post('/transactions', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const {
      transaction_date, provider_name, plaza_name, entry_location, exit_location,
      city, state, amount, truck_id, driver_id, load_id, notes,
      external_transaction_id, device_number_masked, plate_number_raw,
      unit_number_raw, driver_name_raw
    } = req.body || {};

    if (!transaction_date) return res.status(400).json({ error: 'transaction_date is required' });
    if (!provider_name) return res.status(400).json({ error: 'provider_name is required' });
    if (amount === undefined || amount === null) return res.status(400).json({ error: 'amount is required' });

    // Validate truck_id / driver_id references
    if (truck_id) {
      const truck = await knex('vehicles').where({ id: truck_id, tenant_id: tid }).first('id');
      if (!truck) return res.status(400).json({ error: `truck_id "${truck_id}" does not exist for this tenant` });
    }
    if (driver_id) {
      const driver = await knex('drivers').where({ id: driver_id, tenant_id: tid }).first('id');
      if (!driver) return res.status(400).json({ error: `driver_id "${driver_id}" does not exist for this tenant` });
    }

    // Generate dedup hash
    const dedupeHash = buildDedupeHash(tid, provider_name, external_transaction_id, transaction_date, amount);

    // Check for duplicate
    const existing = await knex('toll_transactions')
      .where({ tenant_id: tid, dedupe_hash: dedupeHash })
      .first('id');
    if (existing) {
      return res.status(409).json({ error: 'Duplicate transaction detected', existingId: existing.id });
    }

    const userId = req.user?.id || null;

    const [row] = await knex('toll_transactions')
      .insert({
        tenant_id: tid,
        operating_entity_id: operatingEntityId(req),
        provider_name,
        external_transaction_id: external_transaction_id || null,
        transaction_date,
        truck_id: truck_id || null,
        driver_id: driver_id || null,
        load_id: load_id || null,
        unit_number_raw: unit_number_raw || null,
        driver_name_raw: driver_name_raw || null,
        device_number_masked: device_number_masked || null,
        plate_number_raw: plate_number_raw || null,
        plaza_name: plaza_name || null,
        entry_location: entry_location || null,
        exit_location: exit_location || null,
        city: city || null,
        state: state ? state.toUpperCase().slice(0, 2) : null,
        amount: parseFloat(amount) || 0,
        currency: 'USD',
        matched_status: truck_id && driver_id ? 'matched' : (truck_id || driver_id ? 'partial' : 'unmatched'),
        validation_status: 'valid',
        settlement_link_status: 'none',
        is_manual: true,
        dedupe_hash: dedupeHash,
        created_by: userId,
      })
      .returning('*');

    res.status(201).json(row);
  } catch (error) {
    dtLogger.error('tolls_transaction_create_failed', error);
    res.status(500).json({ error: 'Failed to create toll transaction' });
  }
});

/**
 * @openapi
 * /api/tolls/transactions/batch:
 *   post:
 *     summary: Batch-create toll transactions
 *     description: Creates multiple toll transactions at once (used by the invoice upload flow). Skips duplicates and reports per-row errors.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactions]
 *             properties:
 *               transactions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [transaction_date, provider_name, amount]
 *                   properties:
 *                     transaction_date:
 *                       type: string
 *                       format: date
 *                     provider_name:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     plaza_name:
 *                       type: string
 *                     truck_id:
 *                       type: string
 *                       format: uuid
 *                     driver_id:
 *                       type: string
 *                       format: uuid
 *     responses:
 *       201:
 *         description: Batch creation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 created:
 *                   type: integer
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       index:
 *                         type: integer
 *                       error:
 *                         type: string
 *       400:
 *         description: Invalid or empty transactions array
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.post('/transactions/batch', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { transactions } = req.body || {};
    if (!Array.isArray(transactions) || !transactions.length) {
      return res.status(400).json({ error: 'transactions array is required' });
    }

    const userId = req.user?.id || null;
    const created = [];
    const errors = [];

    for (let i = 0; i < transactions.length; i++) {
      const txn = transactions[i];
      if (!txn.transaction_date || !txn.provider_name || txn.amount === undefined) {
        errors.push({ index: i, error: 'Missing required fields (transaction_date, provider_name, amount)' });
        continue;
      }

      const dedupeHash = buildDedupeHash(tid, txn.provider_name, txn.external_transaction_id, txn.transaction_date, txn.amount);

      // Skip duplicates
      const existing = await knex('toll_transactions')
        .where({ tenant_id: tid, dedupe_hash: dedupeHash })
        .first('id');
      if (existing) {
        errors.push({ index: i, error: 'Duplicate transaction', existingId: existing.id });
        continue;
      }

      const [row] = await knex('toll_transactions')
        .insert({
          tenant_id: tid,
          operating_entity_id: operatingEntityId(req),
          provider_name: txn.provider_name,
          external_transaction_id: txn.external_transaction_id || null,
          transaction_date: txn.transaction_date,
          truck_id: txn.truck_id || null,
          driver_id: txn.driver_id || null,
          load_id: txn.load_id || null,
          unit_number_raw: txn.unit_number_raw || null,
          driver_name_raw: txn.driver_name_raw || null,
          device_number_masked: txn.device_number_masked || null,
          plate_number_raw: txn.plate_number_raw || null,
          plaza_name: txn.plaza_name || null,
          entry_location: txn.entry_location || txn.entry_point || null,
          exit_location: txn.exit_location || txn.exit_point || null,
          city: txn.city || null,
          state: txn.state ? txn.state.toUpperCase().slice(0, 2) : null,
          amount: parseFloat(txn.amount) || 0,
          currency: 'USD',
          matched_status: txn.matched_status || (txn.truck_id ? 'matched' : 'unmatched'),
          validation_status: 'valid',
          settlement_link_status: 'none',
          is_manual: txn.source === 'invoice_upload' ? false : true,
          dedupe_hash: dedupeHash,
          created_by: userId,
        })
        .returning('*');
      created.push(row);
    }

    res.status(201).json({ success: true, created: created.length, errors });
  } catch (error) {
    dtLogger.error('tolls_transaction_batch_create_failed', error);
    res.status(500).json({ error: 'Failed to create toll transactions' });
  }
});

/**
 * @openapi
 * /api/tolls/exceptions:
 *   get:
 *     summary: List toll transaction exceptions
 *     description: Returns paginated toll transaction exceptions (e.g. match failures) with optional status filter.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of exceptions to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of exceptions to skip
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, resolved]
 *         description: Filter by resolution status
 *     responses:
 *       200:
 *         description: Paginated list of exceptions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.get('/exceptions', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const { limit = 50, offset = 0, status } = req.query;

    let q = knex('toll_transaction_exceptions as e')
      .join('toll_transactions as tt', 'tt.id', 'e.toll_transaction_id')
      .where('e.tenant_id', tid)
      .modify((qb) => applyOperatingEntityFilter(qb, req, 'tt.operating_entity_id'))
      .select('e.*', 'tt.transaction_date', 'tt.provider_name', 'tt.plaza_name', 'tt.amount', 'tt.unit_number_raw', 'tt.driver_name_raw')
      .orderBy('e.created_at', 'desc');

    if (status) q = q.where('e.resolution_status', status);

    const total = await knex('toll_transaction_exceptions as e')
      .join('toll_transactions as tt', 'tt.id', 'e.toll_transaction_id')
      .where('e.tenant_id', tid)
      .modify((qb) => applyOperatingEntityFilter(qb, req, 'tt.operating_entity_id'))
      .modify((qb) => {
        if (status) qb.where('e.resolution_status', status);
      })
      .count('* as total')
      .first();

    const rows = await q.limit(Number(limit)).offset(Number(offset));
    res.json({ rows, total: Number(total?.total || 0) });
  } catch (error) {
    dtLogger.error('tolls_exceptions_list_failed', error);
    res.status(500).json({ error: 'Failed to fetch toll exceptions' });
  }
});

// ─── CSV / XLSX parsing (same pattern as fuel-parser.js) ──────────────────────
function parseFileBuffer(buffer, originalFileName) {
  const ext = (originalFileName || '').toLowerCase().split('.').pop();
  let workbook;
  if (ext === 'xlsx' || ext === 'xls') {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } else {
    workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: true });
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (!rawRows || rawRows.length < 2) return { headers: [], rows: [] };

  const headerRow = rawRows[0].map((h) => String(h || '').trim());
  const dataRows = rawRows.slice(1);

  const rows = dataRows
    .map((row) => {
      const obj = {};
      headerRow.forEach((header, idx) => {
        let val = String(row[idx] ?? '').trim();
        if (/^[=+\-@\t\r]/.test(val)) val = "'" + val;
        obj[header] = val;
      });
      return obj;
    })
    .filter((row) => Object.values(row).some((v) => v !== ''));

  return { headers: headerRow, rows };
}

// ─── Dedupe hash helper ───────────────────────────────────────────────────────
function computeDedupeHash(tenantId, provider, transactionDate, amount, plazaName) {
  const raw = [tenantId, provider, transactionDate, amount, plazaName]
    .map((v) => String(v || '').trim().toLowerCase())
    .join('|');
  return crypto.createHash('md5').update(raw).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Import endpoints (FN-431)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/tolls/import/upload:
 *   post:
 *     summary: Upload a toll CSV/XLSX file
 *     description: Accepts a CSV or XLSX file, parses headers and rows, creates an import batch record, and returns headers plus sample rows for column mapping.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV or XLSX file (max 10 MB)
 *               accountId:
 *                 type: string
 *                 format: uuid
 *                 description: Optional toll account to associate with the batch
 *     responses:
 *       201:
 *         description: Upload parsed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 batchId:
 *                   type: string
 *                   format: uuid
 *                 headers:
 *                   type: array
 *                   items:
 *                     type: string
 *                 sampleRows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 allRows:
 *                   type: array
 *                   items:
 *                     type: object
 *                 totalRows:
 *                   type: integer
 *       400:
 *         description: No file uploaded or unparseable file
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.post('/import/upload', upload.single('file'), async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const accountId = req.body.accountId || null;

    // Parse the uploaded file
    const { headers, rows } = parseFileBuffer(req.file.buffer, req.file.originalname);
    if (!headers.length) {
      return res.status(400).json({ error: 'Could not parse file – no headers found' });
    }

    // Create toll_import_batches record
    const [batch] = await knex('toll_import_batches')
      .insert({
        tenant_id: tid,
        operating_entity_id: operatingEntityId(req),
        toll_account_id: accountId,
        provider_name: 'Unknown',
        source_file_name: req.file.originalname,
        import_status: 'uploaded',
        total_rows: rows.length,
        started_at: new Date(),
        imported_by_user_id: req.user?.id || null
      })
      .returning('*');

    const sampleRows = rows.slice(0, 5);

    res.status(201).json({
      batchId: batch.id,
      headers,
      sampleRows,
      allRows: rows,
      totalRows: rows.length
    });
  } catch (error) {
    dtLogger.error('tolls_import_upload_failed', error);
    res.status(500).json({ error: 'Failed to upload and parse toll file' });
  }
});

// ─── Date parsing helper ──────────────────────────────────────────────────────
function parseDate(val) {
  if (!val) return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  // Try parsing as Date
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * @openapi
 * /api/tolls/import/commit:
 *   post:
 *     summary: Commit imported toll rows
 *     description: Takes mapped rows from a previously uploaded batch and inserts them as toll transactions. Performs deduplication, auto-matches devices, and creates exceptions for unmatched rows.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [batchId, rows]
 *             properties:
 *               batchId:
 *                 type: string
 *                 format: uuid
 *                 description: Import batch ID from the upload step
 *               batch_id:
 *                 type: string
 *                 format: uuid
 *                 description: Alias for batchId
 *               rows:
 *                 type: array
 *                 items:
 *                   type: object
 *                 description: Array of row objects (raw or pre-mapped)
 *               column_map:
 *                 type: object
 *                 additionalProperties:
 *                   type: string
 *                 description: Mapping of normalized field names to raw CSV headers
 *               columnMap:
 *                 type: object
 *                 additionalProperties:
 *                   type: string
 *                 description: Alias for column_map
 *     responses:
 *       200:
 *         description: Commit result with counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 imported:
 *                   type: integer
 *                 duplicates:
 *                   type: integer
 *                 errors:
 *                   type: integer
 *                 exceptions:
 *                   type: integer
 *       400:
 *         description: Missing batchId or empty rows array
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Import batch not found
 *       500:
 *         description: Server error
 */
router.post('/import/commit', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { batchId, batch_id, rows, column_map, columnMap } = req.body || {};
    const resolvedBatchId = batchId || batch_id;
    const colMap = column_map || columnMap || null;
    if (!resolvedBatchId || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'batchId and a non-empty rows array are required' });
    }

    // Apply column mapping if provided (raw CSV rows → normalized field names)
    const mappedRows = colMap
      ? rows.map(raw => {
          const mapped = {};
          for (const [normalizedKey, rawHeader] of Object.entries(colMap)) {
            if (rawHeader && raw[rawHeader] !== undefined) {
              mapped[normalizedKey] = raw[rawHeader];
            }
          }
          // Carry forward unmapped raw values for auto-detection
          // (plate numbers, transponder IDs, driver names, etc.)
          if (!mapped.plate_number_raw) {
            mapped.plate_number_raw = raw.PlateNumber || raw.plate_number || raw.Plate || raw.LicensePlate || raw.plate || null;
          }
          if (!mapped.device_number_masked) {
            mapped.device_number_masked = raw.TransponderID || raw.transponder_id || raw.Transponder || raw.TagID || raw.tag_id || null;
          }
          if (!mapped.driver_name_raw) {
            mapped.driver_name_raw = raw.DriverName || raw.driver_name || raw.Driver || null;
          }
          if (!mapped.unit_number_raw) {
            mapped.unit_number_raw = raw.UnitNumber || raw.unit_number || raw.VehicleID || raw.vehicle_id || null;
          }
          return mapped;
        })
      : rows;

    // Verify batch belongs to tenant
    const batch = await knex('toll_import_batches')
      .where({ id: resolvedBatchId, tenant_id: tid })
      .first();
    if (!batch) {
      return res.status(404).json({ error: 'Import batch not found' });
    }

    let imported = 0;
    let duplicates = 0;
    let errors = 0;
    let exceptions = 0;

    for (const row of mappedRows) {
      try {
        // Generate dedupe hash
        const dedupeHash = computeDedupeHash(
          tid,
          row.provider_name || row.provider || '',
          row.transaction_date || '',
          row.amount || '',
          row.plaza_name || ''
        );

        // Check for duplicates
        const existing = await knex('toll_transactions')
          .where({ tenant_id: tid, dedupe_hash: dedupeHash })
          .first('id');
        if (existing) {
          duplicates++;
          continue;
        }

        // Auto-match: lookup device_number or plate_number in toll_devices
        let truckId = row.truck_id || null;
        let driverId = row.driver_id || null;
        let matchFailed = false;

        if (!truckId || !driverId) {
          const deviceLookup = row.device_number || row.transponder_number || null;
          const plateLookup = row.plate_number || row.license_plate || null;

          let device = null;
          if (deviceLookup) {
            device = await knex('toll_devices')
              .where({ tenant_id: tid, device_number_masked: deviceLookup, status: 'active' })
              .first();
          }
          if (!device && plateLookup) {
            device = await knex('toll_devices')
              .where({ tenant_id: tid, plate_number: plateLookup, status: 'active' })
              .first();
          }

          if (device) {
            truckId = truckId || device.truck_id || null;
            driverId = driverId || device.driver_id || null;
          } else if (deviceLookup || plateLookup) {
            matchFailed = true;
          }
        }

        // Insert toll_transactions
        const [txn] = await knex('toll_transactions')
          .insert({
            tenant_id: tid,
            operating_entity_id: operatingEntityId(req) || null,
            source_batch_id: resolvedBatchId,
            toll_account_id: batch.toll_account_id || null,
            provider_name: row.provider_name || row.provider || 'Unknown',
            transaction_date: parseDate(row.transaction_date) || new Date().toISOString().slice(0, 10),
            posted_date: parseDate(row.posted_date),
            plaza_name: row.plaza_name || null,
            entry_location: row.entry_location || null,
            exit_location: row.exit_location || null,
            city: row.city || null,
            state: row.state ? String(row.state).toUpperCase().slice(0, 2) : null,
            amount: parseFloat(row.amount) || 0,
            currency: 'USD',
            truck_id: truckId,
            driver_id: driverId,
            unit_number_raw: row.unit_number_raw || row.unit_number || row.device_number || null,
            driver_name_raw: row.driver_name_raw || row.driver_name || null,
            device_number_masked: row.device_number_masked || null,
            plate_number_raw: row.plate_number_raw || row.plate_number || null,
            matched_status: truckId && driverId ? 'matched' : (truckId || driverId ? 'partial' : 'unmatched'),
            validation_status: matchFailed ? 'exception' : 'valid',
            settlement_link_status: 'none',
            is_manual: false,
            dedupe_hash: dedupeHash,
            created_by: req.user?.id || null
          })
          .returning('*');

        // Create audit row
        await knex('toll_import_batch_rows').insert({
          batch_id: resolvedBatchId,
          row_number: imported + duplicates + errors + 1,
          raw_payload: JSON.stringify(row),
          resolution_status: matchFailed ? 'exception' : 'imported'
        });

        // If matching failed, create exception
        if (matchFailed) {
          await knex('toll_transaction_exceptions').insert({
            tenant_id: tid,
            toll_transaction_id: txn.id,
            exception_type: 'match_failed',
            resolution_status: 'open',
            details: JSON.stringify({
              device_number: row.device_number || null,
              plate_number: row.plate_number || null,
              reason: 'Could not match device or plate to a toll device record'
            })
          });
          exceptions++;
        }

        imported++;
      } catch (rowError) {
        dtLogger.error('tolls_import_row_error', { batchId: resolvedBatchId, row, error: rowError.message });
        errors++;

        // Still create audit row for failed rows
        await knex('toll_import_batch_rows').insert({
          batch_id: resolvedBatchId,
          row_number: imported + duplicates + errors,
          raw_payload: JSON.stringify(row),
          validation_errors: JSON.stringify([rowError.message]),
          resolution_status: 'error'
        }).catch(() => { /* best effort audit */ });
      }
    }

    // Update batch counters and status
    await knex('toll_import_batches')
      .where({ id: resolvedBatchId })
      .update({
        import_status: 'completed',
        total_rows: mappedRows.length,
        success_rows: imported,
        failed_rows: errors,
        warning_rows: duplicates,
        completed_at: new Date(),
        updated_at: new Date()
      });

    res.json({ imported, duplicates, errors, exceptions });
  } catch (error) {
    dtLogger.error('tolls_import_commit_failed', error);
    res.status(500).json({ error: 'Failed to commit toll import' });
  }
});

/**
 * @openapi
 * /api/tolls/import/mapping-profiles:
 *   get:
 *     summary: List import mapping profiles
 *     description: Returns all toll import column-mapping profiles for the current tenant, ordered by creation date descending.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of mapping profile objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.get('/import/mapping-profiles', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const rows = await knex('toll_import_mapping_profiles')
      .where({ tenant_id: tid })
      .orderBy('created_at', 'desc');
    res.json(rows);
  } catch (error) {
    dtLogger.error('tolls_mapping_profiles_list_failed', error);
    res.status(500).json({ error: 'Failed to fetch toll mapping profiles' });
  }
});

/**
 * @openapi
 * /api/tolls/import/mapping-profiles:
 *   post:
 *     summary: Create an import mapping profile
 *     description: Saves a reusable column-mapping profile so future CSV imports from the same provider can auto-map columns.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, columnMappings]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Human-readable profile name
 *               columnMappings:
 *                 type: object
 *                 additionalProperties:
 *                   type: string
 *                 description: Map of normalized field names to raw CSV header names
 *     responses:
 *       201:
 *         description: Created mapping profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.post('/import/mapping-profiles', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { name, columnMappings } = req.body || {};
    if (!name || !columnMappings) {
      return res.status(400).json({ error: 'name and columnMappings are required' });
    }

    const [row] = await knex('toll_import_mapping_profiles')
      .insert({
        tenant_id: tid,
        profile_name: name,
        column_mappings: JSON.stringify(columnMappings),
        created_by: req.user?.id || null
      })
      .returning('*');

    res.status(201).json(row);
  } catch (error) {
    dtLogger.error('tolls_mapping_profile_create_failed', error);
    res.status(500).json({ error: 'Failed to create toll mapping profile' });
  }
});

// ---------------------------------------------------------------------------
// Manual toll-to-settlement posting
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/tolls/transactions/{id}/post-to-settlement:
 *   post:
 *     summary: Post toll to settlement
 *     description: Manually links a single toll transaction to a settlement as a variable expense deduction. Uses the responsibility profile to determine billing. Returns 409 if already linked or settlement is voided.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Toll transaction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [settlement_id]
 *             properties:
 *               settlement_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Toll linked to settlement
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 adjustment:
 *                   type: object
 *                   nullable: true
 *                 toll_transaction_id:
 *                   type: string
 *                   format: uuid
 *                 settlement_id:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: Missing settlement_id
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Toll transaction or settlement not found
 *       409:
 *         description: Already linked, voided settlement, or not billable
 *       500:
 *         description: Server error
 */
router.post('/transactions/:id/post-to-settlement', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { settlement_id } = req.body || {};
    if (!settlement_id) {
      return res.status(400).json({ error: 'settlement_id is required' });
    }

    const toll = await knex('toll_transactions')
      .where({ id: req.params.id, tenant_id: tid })
      .first();

    if (!toll) {
      return res.status(404).json({ error: 'Toll transaction not found' });
    }

    if (toll.settlement_link_status === 'linked') {
      return res.status(409).json({
        error: 'Toll transaction already linked to a settlement',
        settlement_id: toll.settlement_id
      });
    }

    const settlement = await knex('settlements')
      .where({ id: settlement_id, tenant_id: tid })
      .first();

    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    if (settlement.settlement_status === 'void') {
      return res.status(409).json({ error: 'Cannot post to a voided settlement' });
    }

    const description = [
      'Toll',
      toll.plaza_name || toll.provider_name || '',
      toll.transaction_date ? `(${String(toll.transaction_date).slice(0, 10)})` : ''
    ].filter(Boolean).join(' — ');

    const result = await applyVariableExpenseToSettlement(knex, settlement_id, {
      expenseType: 'toll',
      amount: Number(toll.amount) || 0,
      description,
      occurrenceDate: toll.transaction_date,
      userId: req.user?.id ?? null,
      sourceType: 'imported_toll',
      sourceReferenceId: toll.id,
      sourceReferenceType: 'toll_transaction'
    });

    if (!result.primaryAdjustment && !result.mirroredAdjustment) {
      return res.status(409).json({ error: 'Toll transaction is not billable to the driver or equipment owner under the current responsibility profile' });
    }

    await knex('toll_transactions')
      .where({ id: toll.id })
      .update({
        settlement_id: result.primarySettlementId,
        settlement_adjustment_item_id: result.primaryAdjustment?.id || null,
        settlement_link_status: 'linked',
        updated_at: knex.fn.now()
      });

    await recalcAndUpdateSettlement(knex, result.primarySettlementId);
    if (result.mirroredAdjustment?.settlement_id && result.mirroredAdjustment.settlement_id !== result.primarySettlementId) {
      await recalcAndUpdateSettlement(knex, result.mirroredAdjustment.settlement_id);
    }

    res.json({
      success: true,
      adjustment: result.primaryAdjustment || result.mirroredAdjustment || null,
      toll_transaction_id: toll.id,
      settlement_id: result.primarySettlementId
    });
  } catch (error) {
    dtLogger.error('toll_post_to_settlement_failed', error);
    res.status(500).json({ error: 'Failed to post toll to settlement' });
  }
});

/**
 * @openapi
 * /api/tolls/transactions/{id}/unlink-from-settlement:
 *   post:
 *     summary: Unlink toll from settlement
 *     description: Removes the link between a toll transaction and its settlement, deleting the corresponding adjustment items. Cannot unlink from approved or voided settlements.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Toll transaction ID
 *     responses:
 *       200:
 *         description: Toll unlinked from settlement
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 toll_transaction_id:
 *                   type: string
 *                   format: uuid
 *                 unlinked_from_settlement:
 *                   type: string
 *                   format: uuid
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Toll transaction not found
 *       409:
 *         description: Not linked or settlement is approved/voided
 *       500:
 *         description: Server error
 */
router.post('/transactions/:id/unlink-from-settlement', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const toll = await knex('toll_transactions')
      .where({ id: req.params.id, tenant_id: tid })
      .first();

    if (!toll) {
      return res.status(404).json({ error: 'Toll transaction not found' });
    }

    if (toll.settlement_link_status !== 'linked' || !toll.settlement_id) {
      return res.status(409).json({ error: 'Toll transaction is not linked to any settlement' });
    }

    const settlementId = toll.settlement_id;

    const settlement = await knex('settlements')
      .where({ id: settlementId, tenant_id: tid })
      .first();

    if (settlement && (settlement.settlement_status === 'approved' || settlement.settlement_status === 'void')) {
      return res.status(409).json({ error: `Cannot unlink from a ${settlement.settlement_status} settlement` });
    }

    if (toll.settlement_adjustment_item_id) {
      await knex('settlement_adjustment_items')
        .where({ id: toll.settlement_adjustment_item_id })
        .delete();
    }

    const linkedSettlement = settlementId
      ? await knex('settlements').where({ id: settlementId }).first()
      : null;
    if (linkedSettlement?.paired_settlement_id) {
      await knex('settlement_adjustment_items')
        .where({
          settlement_id: linkedSettlement.paired_settlement_id,
          source_type: 'imported_toll',
          source_reference_id: toll.id,
          source_reference_type: 'toll_transaction'
        })
        .delete();
    }

    await knex('toll_transactions')
      .where({ id: toll.id })
      .update({
        settlement_id: null,
        settlement_adjustment_item_id: null,
        settlement_link_status: 'none',
        updated_at: knex.fn.now()
      });

    if (settlement) {
      await recalcAndUpdateSettlement(knex, settlementId);
      if (linkedSettlement?.paired_settlement_id) {
        await recalcAndUpdateSettlement(knex, linkedSettlement.paired_settlement_id);
      }
    }

    res.json({
      success: true,
      toll_transaction_id: toll.id,
      unlinked_from_settlement: settlementId
    });
  } catch (error) {
    dtLogger.error('toll_unlink_from_settlement_failed', error);
    res.status(500).json({ error: 'Failed to unlink toll from settlement' });
  }
});

/**
 * @openapi
 * /api/tolls/import/invoice-image:
 *   post:
 *     summary: Upload toll invoice images for AI extraction
 *     description: Accepts up to 10 invoice images (JPG, PNG, PDF, WebP), sends each to the AI service for OCR/vision extraction, auto-matches plates to toll devices, and flags duplicates.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [images]
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 maxItems: 10
 *                 description: Invoice image files (JPG, PNG, PDF, WebP; max 10 MB each)
 *     responses:
 *       200:
 *         description: Extraction results per file
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       file:
 *                         type: string
 *                       invoiceMeta:
 *                         type: object
 *                       confidence:
 *                         type: number
 *                       warnings:
 *                         type: array
 *                         items:
 *                           type: string
 *                       transactions:
 *                         type: array
 *                         items:
 *                           type: object
 *       400:
 *         description: No image files provided
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
router.post('/import/invoice-image', invoiceUpload.array('images', 10), async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'At least one image file is required' });
    }

    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:4100';
    const results = [];

    for (const file of files) {
      const imageBase64 = file.buffer.toString('base64');
      const mediaType = file.mimetype || 'image/jpeg';

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      let aiResponse;
      try {
        aiResponse = await fetch(`${aiServiceUrl}/api/ai/tolls/invoice-vision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64, mediaType }),
          signal: controller.signal,
        });
      } catch (fetchErr) {
        clearTimeout(timeout);
        if (fetchErr.name === 'AbortError') {
          dtLogger.error('toll_invoice_ai_timeout', { file: file.originalname });
          results.push({ file: file.originalname, error: 'AI service timeout', transactions: [] });
          continue;
        }
        dtLogger.error('toll_invoice_ai_unreachable', { file: file.originalname, err: fetchErr.message });
        results.push({ file: file.originalname, error: 'AI service unreachable', transactions: [] });
        continue;
      }
      clearTimeout(timeout);

      if (!aiResponse.ok) {
        const errBody = await aiResponse.json().catch(() => ({}));
        results.push({ file: file.originalname, error: errBody.error || 'AI extraction failed', transactions: [] });
        continue;
      }

      const aiResult = await aiResponse.json();
      const extraction = aiResult.data || {};
      const transactions = extraction.transactions || [];

      const plate = (extraction.invoiceMeta?.licensePlate || '').toString().trim().toUpperCase();
      let matchedTruckId = null;
      let matchedDriverId = null;
      let matchFailed = false;

      if (plate) {
        const device = await knex('toll_devices')
          .where({ tenant_id: tid })
          .whereRaw('UPPER(TRIM(plate_number)) = ?', [plate])
          .first('truck_id', 'driver_id');
        if (device) {
          matchedTruckId = device.truck_id || null;
          matchedDriverId = device.driver_id || null;
        } else {
          matchFailed = true;
        }
      }

      const enriched = [];
      for (const txn of transactions) {
        let isDuplicate = false;
        if (txn.transaction_date && txn.amount && plate) {
          const existing = await knex('toll_transactions')
            .where({ tenant_id: tid })
            .whereRaw('transaction_date = ?', [txn.transaction_date])
            .whereRaw('ABS(amount::numeric - ?) < 0.01', [txn.amount])
            .whereRaw('UPPER(TRIM(plate_number_raw)) = ?', [plate])
            .first('id');
          isDuplicate = !!existing;
        }

        enriched.push({
          ...txn,
          plate_number_raw: plate || null,
          truck_id: matchedTruckId,
          driver_id: matchedDriverId,
          matched_status: matchedTruckId ? 'matched' : 'unmatched',
          is_duplicate: isDuplicate,
          match_failed: matchFailed,
        });
      }

      // Add late fees as a separate line item if present
      const meta = extraction.invoiceMeta || {};
      if (meta.hasLateFees && meta.lateFees > 0) {
        enriched.push({
          transaction_date: meta.invoiceDate || meta.dueDate || null,
          provider_name: meta.providerName || 'Unknown',
          plaza_name: null,
          entry_location: null,
          exit_location: null,
          city: null,
          state: null,
          amount: meta.lateFees,
          external_transaction_id: null,
          notes: 'Late fee / penalty',
          plate_number_raw: plate || null,
          truck_id: matchedTruckId,
          driver_id: matchedDriverId,
          matched_status: matchedTruckId ? 'matched' : 'unmatched',
          is_duplicate: false,
          match_failed: matchFailed,
        });
      }

      results.push({
        file: file.originalname,
        invoiceMeta: extraction.invoiceMeta || {},
        confidence: extraction.confidence || 0,
        warnings: extraction.warnings || [],
        transactions: enriched,
      });
    }

    res.json({ success: true, results });
  } catch (error) {
    dtLogger.error('toll_invoice_image_upload_failed', error);
    res.status(500).json({ error: 'Failed to process toll invoice images' });
  }
});

/**
 * @openapi
 * /api/tolls/import/ai-normalize:
 *   post:
 *     summary: AI-normalize CSV column mapping
 *     description: Sends CSV headers and sample rows to the AI service for automatic column-mapping suggestions. Auto-saves a mapping profile when confidence is >= 0.8.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [batchId, headers, sampleRows]
 *             properties:
 *               batchId:
 *                 type: string
 *                 format: uuid
 *               headers:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Raw CSV column headers
 *               sampleRows:
 *                 type: array
 *                 items:
 *                   type: object
 *                 description: First few data rows for AI analysis
 *     responses:
 *       200:
 *         description: AI normalization result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 batchId:
 *                   type: string
 *                   format: uuid
 *                 overallConfidence:
 *                   type: number
 *                 columnMapping:
 *                   type: object
 *                   additionalProperties:
 *                     type: string
 *                 confidenceScores:
 *                   type: object
 *                   additionalProperties:
 *                     type: number
 *                 normalizedSample:
 *                   type: array
 *                   items:
 *                     type: object
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 *                 mappingProfileSaved:
 *                   type: boolean
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Tenant context required
 *       502:
 *         description: AI service unreachable or returned an error
 *       504:
 *         description: AI service timeout
 *       500:
 *         description: Server error
 */
router.post('/import/ai-normalize', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { batchId, headers, sampleRows } = req.body || {};
    if (!batchId || !Array.isArray(headers) || !headers.length) {
      return res.status(400).json({ error: 'batchId and headers[] are required' });
    }
    if (!Array.isArray(sampleRows) || !sampleRows.length) {
      return res.status(400).json({ error: 'sampleRows[] must contain at least one row' });
    }

    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:4100';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let aiResponse;
    try {
      aiResponse = await fetch(`${aiServiceUrl}/api/ai/tolls/csv-normalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers, sampleRows }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        dtLogger.error('toll_csv_ai_timeout', { batchId });
        return res.status(504).json({ error: 'AI service timeout' });
      }
      dtLogger.error('toll_csv_ai_unreachable', { batchId, err: fetchErr.message });
      return res.status(502).json({ error: 'AI service unreachable' });
    }
    clearTimeout(timeout);

    if (!aiResponse.ok) {
      const errBody = await aiResponse.json().catch(() => ({}));
      dtLogger.error('toll_csv_ai_error', { batchId, status: aiResponse.status, errBody });
      return res.status(aiResponse.status >= 500 ? 502 : aiResponse.status).json({
        error: errBody.error || 'AI normalization failed',
      });
    }

    const aiResult = await aiResponse.json();
    const data = aiResult.data || aiResult;
    const overallConfidence = data.overallConfidence ?? data.confidence ?? 0;

    // Auto-save mapping profile when AI confidence is high enough
    if (overallConfidence >= 0.8 && data.columnMapping) {
      try {
        await knex('toll_import_mapping_profiles')
          .insert({
            tenant_id: tid,
            batch_id: batchId,
            source_headers: JSON.stringify(headers),
            column_mapping: JSON.stringify(data.columnMapping),
            confidence_scores: JSON.stringify(data.confidenceScores || {}),
            overall_confidence: overallConfidence,
            created_by: req.user?.id || null,
          })
          .onConflict(['tenant_id', 'batch_id'])
          .merge({
            source_headers: JSON.stringify(headers),
            column_mapping: JSON.stringify(data.columnMapping),
            confidence_scores: JSON.stringify(data.confidenceScores || {}),
            overall_confidence: overallConfidence,
            updated_at: new Date(),
          });
      } catch (saveErr) {
        // Non-fatal: log but still return the AI result to the frontend
        dtLogger.error('toll_mapping_profile_save_failed', { batchId, err: saveErr.message });
      }
    }

    res.json({
      success: true,
      batchId,
      overallConfidence,
      columnMapping: data.columnMapping || {},
      confidenceScores: data.confidenceScores || {},
      normalizedSample: data.normalizedSample || [],
      warnings: data.warnings || [],
      mappingProfileSaved: overallConfidence >= 0.8 && !!data.columnMapping,
    });
  } catch (error) {
    dtLogger.error('toll_csv_ai_normalize_failed', error);
    res.status(500).json({ error: 'Failed to normalize CSV data' });
  }
});

// ─── FN-468: Device assignment endpoints ─────────────────────────────────────

/**
 * @openapi
 * /api/tolls/devices/{deviceId}/assignments:
 *   get:
 *     summary: List device vehicle assignments
 *     description: Returns all vehicle assignment records (active and historical) for a specific toll device, ordered by assigned date descending.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Toll device ID
 *     responses:
 *       200:
 *         description: Array of assignment records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Toll device not found
 *       500:
 *         description: Server error
 */
router.get('/devices/:deviceId/assignments', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { deviceId } = req.params;

    // Verify device exists and belongs to tenant
    const device = await applyOperatingEntityFilter(
      knex('toll_devices').where({ id: deviceId, tenant_id: tid }),
      req
    ).first('id');
    if (!device) return res.status(404).json({ error: 'Toll device not found' });

    const rows = await knex('toll_device_vehicle_assignments')
      .where({ tenant_id: tid, toll_device_id: deviceId })
      .orderBy('assigned_date', 'desc');

    res.json(rows);
  } catch (error) {
    dtLogger.error('tolls_device_assignments_list_failed', error);
    res.status(500).json({ error: 'Failed to fetch device assignments' });
  }
});

/**
 * @openapi
 * /api/tolls/devices/{deviceId}/assign-vehicle:
 *   post:
 *     summary: Assign vehicle to toll device
 *     description: Assigns a vehicle (truck) to a toll device (transponder). Automatically removes the previous active assignment and auto-resolves the driver from the truck's active driver.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Toll device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [truck_id]
 *             properties:
 *               truck_id:
 *                 type: string
 *                 format: uuid
 *               plate_number:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Vehicle assigned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 device:
 *                   type: object
 *       400:
 *         description: Missing truck_id or invalid reference
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Toll device not found
 *       500:
 *         description: Server error
 */
router.post('/devices/:deviceId/assign-vehicle', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { deviceId } = req.params;
    const { truck_id, plate_number, notes } = req.body || {};

    if (!truck_id) return res.status(400).json({ error: 'truck_id is required' });

    // Verify device exists and belongs to tenant
    const device = await applyOperatingEntityFilter(
      knex('toll_devices').where({ id: deviceId, tenant_id: tid }),
      req
    ).first('id');
    if (!device) return res.status(404).json({ error: 'Toll device not found' });

    // Verify truck exists for tenant
    const truck = await knex('vehicles').where({ id: truck_id, tenant_id: tid }).first('id');
    if (!truck) return res.status(400).json({ error: `truck_id "${truck_id}" does not exist for this tenant` });

    const now = new Date();

    await knex.transaction(async (trx) => {
      // Auto-remove any current active assignment
      await trx('toll_device_vehicle_assignments')
        .where({ tenant_id: tid, toll_device_id: deviceId, status: 'active' })
        .update({
          status: 'removed',
          removed_date: now,
          removed_by: req.user?.id || null,
          updated_at: now
        });

      // Create new assignment
      await trx('toll_device_vehicle_assignments').insert({
        tenant_id: tid,
        toll_device_id: deviceId,
        truck_id,
        plate_number: plate_number || null,
        assigned_date: now,
        status: 'active',
        assigned_by: req.user?.id || null,
        notes: notes || null
      });

      // Auto-resolve driver from truck (active driver assigned to this truck)
      const activeDriver = await trx('drivers')
        .where({ truck_id, tenant_id: tid, status: 'active' })
        .first('id');

      // Update toll_devices.truck_id + auto-resolved driver + clear override flag
      await trx('toll_devices')
        .where({ id: deviceId, tenant_id: tid })
        .update({
          truck_id,
          driver_id: activeDriver ? activeDriver.id : null,
          is_driver_override: false,
          updated_at: now
        });
    });

    const updatedDevice = await knex('toll_devices').where({ id: deviceId }).first();
    res.json({ success: true, device: updatedDevice });
  } catch (error) {
    dtLogger.error('tolls_device_assign_vehicle_failed', error);
    res.status(500).json({ error: 'Failed to assign vehicle to device' });
  }
});

/**
 * @openapi
 * /api/tolls/devices/{deviceId}/remove-vehicle:
 *   post:
 *     summary: Remove vehicle from toll device
 *     description: Removes the current vehicle assignment from a toll device. Clears truck_id and (unless a manual driver override is set) also clears driver_id.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Toll device ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Vehicle removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 device:
 *                   type: object
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Toll device not found
 *       500:
 *         description: Server error
 */
router.post('/devices/:deviceId/remove-vehicle', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { deviceId } = req.params;
    const { notes } = req.body || {};

    // Verify device exists and belongs to tenant
    const device = await applyOperatingEntityFilter(
      knex('toll_devices').where({ id: deviceId, tenant_id: tid }),
      req
    ).first('id');
    if (!device) return res.status(404).json({ error: 'Toll device not found' });

    const now = new Date();

    await knex.transaction(async (trx) => {
      // Remove active assignment(s)
      const updated = await trx('toll_device_vehicle_assignments')
        .where({ tenant_id: tid, toll_device_id: deviceId, status: 'active' })
        .update({
          status: 'removed',
          removed_date: now,
          removed_by: req.user?.id || null,
          notes: notes ? trx.raw("COALESCE(notes || ' | ', '') || ?", [notes]) : undefined,
          updated_at: now
        });

      // Clear toll_devices.truck_id; clear driver_id only if not manually overridden
      const deviceRow = await trx('toll_devices')
        .where({ id: deviceId, tenant_id: tid })
        .first('is_driver_override');

      const driverUpdate = (deviceRow && deviceRow.is_driver_override)
        ? {} // keep manual driver override
        : { driver_id: null, is_driver_override: false };

      await trx('toll_devices')
        .where({ id: deviceId, tenant_id: tid })
        .update({ truck_id: null, ...driverUpdate, updated_at: now });
    });

    const updatedDevice = await knex('toll_devices').where({ id: deviceId }).first();
    res.json({ success: true, device: updatedDevice });
  } catch (error) {
    dtLogger.error('tolls_device_remove_vehicle_failed', error);
    res.status(500).json({ error: 'Failed to remove vehicle from device' });
  }
});

/**
 * @openapi
 * /api/tolls/devices/{deviceId}/assign-driver:
 *   post:
 *     summary: Override driver on toll device
 *     description: Directly assigns a driver to a toll device, bypassing the vehicle-to-driver chain. Sets the is_driver_override flag so the driver is not cleared when the vehicle assignment changes.
 *     tags: [Tolls]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Toll device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [driver_id]
 *             properties:
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Driver assigned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 device:
 *                   type: object
 *       400:
 *         description: Missing driver_id or invalid reference
 *       401:
 *         description: Tenant context required
 *       404:
 *         description: Toll device not found
 *       500:
 *         description: Server error
 */
router.post('/devices/:deviceId/assign-driver', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { deviceId } = req.params;
    const { driver_id, notes } = req.body || {};

    if (!driver_id) return res.status(400).json({ error: 'driver_id is required' });

    // Verify device exists and belongs to tenant
    const device = await applyOperatingEntityFilter(
      knex('toll_devices').where({ id: deviceId, tenant_id: tid }),
      req
    ).first('id');
    if (!device) return res.status(404).json({ error: 'Toll device not found' });

    // Verify driver exists for tenant
    const driver = await knex('drivers').where({ id: driver_id, tenant_id: tid }).first('id');
    if (!driver) return res.status(400).json({ error: `driver_id "${driver_id}" does not exist for this tenant` });

    const now = new Date();
    await knex('toll_devices')
      .where({ id: deviceId, tenant_id: tid })
      .update({ driver_id, is_driver_override: true, notes: notes || undefined, updated_at: now });

    const updatedDevice = await knex('toll_devices').where({ id: deviceId }).first();
    res.json({ success: true, device: updatedDevice });
  } catch (error) {
    dtLogger.error('tolls_device_assign_driver_failed', error);
    res.status(500).json({ error: 'Failed to assign driver to device' });
  }
});

module.exports = router;
