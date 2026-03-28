'use strict';

/**
 * Fuel Import Module – Express router.
 * Mounted at /api/fuel in the logistics service.
 *
 * Endpoints:
 *   GET    /api/fuel/providers/templates
 *   GET    /api/fuel/cards
 *   POST   /api/fuel/cards
 *   PATCH  /api/fuel/cards/:id
 *   GET    /api/fuel/mapping-profiles
 *   POST   /api/fuel/mapping-profiles
 *   DELETE /api/fuel/mapping-profiles/:id
 *   POST   /api/fuel/import/preview
 *   POST   /api/fuel/import/ai-preprocess
 *   POST   /api/fuel/import/stage
 *   POST   /api/fuel/import/commit/:batchId
 *   GET    /api/fuel/import/batches
 *   GET    /api/fuel/import/batches/:id
 *   GET    /api/fuel/transactions
 *   GET    /api/fuel/transactions/:id
 *   PATCH  /api/fuel/transactions/:id
 *   DELETE /api/fuel/transactions/:id
 *   GET    /api/fuel/exceptions
 *   PATCH  /api/fuel/exceptions/:id/resolve
 *   POST   /api/fuel/exceptions/bulk-resolve
 *   POST   /api/fuel/reprocess-unmatched
 *   GET    /api/fuel/overview
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const { uploadBuffer } = require('../storage/r2-storage');
const { getProviderTemplates, buildAutoMapping, parseFileBuffer } = require('../services/fuel-parser');
const {
  previewImport,
  stageBatch,
  commitBatch,
  resolveException,
  bulkResolveExceptions,
  reprocessUnmatched
} = require('../services/fuel-service');

// ─── File upload (memory storage – max 10 MB) ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream', 'text/plain'];
    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    if (allowed.includes(file.mimetype) || ['csv', 'xlsx', 'xls', 'txt'].includes(ext)) {
      return cb(null, true);
    }
    cb(new Error('Only CSV and XLSX files are accepted'));
  }
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

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireTenant(req, res) {
  const tid = tenantId(req);
  if (!tid) { sendError(res, 401, 'Tenant context required'); return null; }
  return tid;
}

// ─── Provider templates ───────────────────────────────────────────────────────
router.get('/providers/templates', (_req, res) => {
  res.json(getProviderTemplates());
});

// ─── Fuel Card Accounts ───────────────────────────────────────────────────────
router.get('/cards', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const rows = await applyOperatingEntityFilter(
      knex('fuel_card_accounts').where({ tenant_id: tid }),
      req
    )
      .orderBy('created_at', 'desc');
    res.json(rows);
  } catch (err) {
    dtLogger.error('fuel_cards_list_error', err);
    sendError(res, 500, 'Failed to fetch fuel card accounts');
  }
});

router.post('/cards', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { provider_name, display_name, account_number_masked, import_method, default_matching_rules, status, notes } = req.body;
    if (!provider_name || !display_name) return sendError(res, 400, 'provider_name and display_name are required');

    const [row] = await knex('fuel_card_accounts').insert({
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      provider_name,
      display_name,
      account_number_masked: account_number_masked || null,
      import_method: import_method || 'manual_upload',
      default_matching_rules: default_matching_rules ? JSON.stringify(default_matching_rules) : null,
      status: status || 'active',
      notes: notes || null,
      created_by: userId(req)
    }).returning('*');

    res.status(201).json(row);
  } catch (err) {
    dtLogger.error('fuel_card_create_error', err);
    sendError(res, 500, 'Failed to create fuel card account');
  }
});

router.patch('/cards/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const allowed = ['display_name', 'account_number_masked', 'import_method', 'default_matching_rules', 'status', 'notes'];
    const patch = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) patch[f] = req.body[f];
    }
    patch.updated_at = new Date();

    const [row] = await knex('fuel_card_accounts')
      .modify((qb) => {
        qb.where({ id: req.params.id, tenant_id: tid });
        applyOperatingEntityFilter(qb, req);
      })
      .update(patch)
      .returning('*');
    if (!row) return sendError(res, 404, 'Fuel card account not found');
    res.json(row);
  } catch (err) {
    dtLogger.error('fuel_card_patch_error', err);
    sendError(res, 500, 'Failed to update fuel card account');
  }
});

// ─── Mapping Profiles ─────────────────────────────────────────────────────────
router.get('/mapping-profiles', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const rows = await knex('fuel_import_mapping_profiles')
      .where({ tenant_id: tid })
      .orderBy('created_at', 'desc');
    res.json(rows);
  } catch (err) {
    dtLogger.error('fuel_mapping_list_error', err);
    sendError(res, 500, 'Failed to fetch mapping profiles');
  }
});

router.post('/mapping-profiles', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { profile_name, provider_name, column_map, is_default } = req.body;
    if (!profile_name || !column_map) return sendError(res, 400, 'profile_name and column_map are required');

    if (is_default) {
      // Un-set previous defaults for this provider
      await knex('fuel_import_mapping_profiles')
        .where({ tenant_id: tid, provider_name: provider_name || null, is_default: true })
        .update({ is_default: false });
    }

    const [row] = await knex('fuel_import_mapping_profiles').insert({
      tenant_id: tid,
      profile_name,
      provider_name: provider_name || null,
      column_map: JSON.stringify(column_map),
      is_default: !!is_default,
      created_by: userId(req)
    }).returning('*');

    res.status(201).json(row);
  } catch (err) {
    dtLogger.error('fuel_mapping_create_error', err);
    sendError(res, 500, 'Failed to create mapping profile');
  }
});

router.delete('/mapping-profiles/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const deleted = await knex('fuel_import_mapping_profiles')
      .where({ id: req.params.id, tenant_id: tid })
      .del();
    if (!deleted) return sendError(res, 404, 'Mapping profile not found');
    res.json({ deleted: true });
  } catch (err) {
    dtLogger.error('fuel_mapping_delete_error', err);
    sendError(res, 500, 'Failed to delete mapping profile');
  }
});

// ─── Import – Preview (no persist) ───────────────────────────────────────────
router.post('/import/preview', upload.single('file'), async (req, res) => {
  try {
    requireTenant(req, res);
    if (!req.file) return sendError(res, 400, 'No file uploaded');
    const providerKey = req.body.provider_key || 'generic';
    const result = await previewImport({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      providerKey
    });
    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_import_preview_error', err);
    sendError(res, 400, err.message || 'Preview failed');
  }
});

// ─── Import – AI Preprocess (FN-406) ─────────────────────────────────────────
// Accepts file + provider, parses headers/sample rows, sends to AI service for
// column mapping inference, product type detection, and row split proposals.
router.post('/import/ai-preprocess', upload.single('file'), async (req, res) => {
  try {
    requireTenant(req, res);
    if (!req.file) return sendError(res, 400, 'No file uploaded');

    const providerKey = req.body.provider_key || 'generic';
    const providerName = req.body.provider_name || providerKey;

    // Parse file to get headers + all rows
    const { headers, rows } = parseFileBuffer(req.file.buffer, req.file.originalname);
    if (!headers || headers.length === 0) {
      return sendError(res, 400, 'Could not parse headers from file');
    }

    // Build sample rows as objects (header → value)
    const sampleRows = rows.slice(0, 20).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });

    // Call AI service
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:4100';
    const response = await fetch(`${aiServiceUrl}/api/ai/fuel/preprocess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headers,
        sampleRows,
        totalRows: rows.length,
        providerName,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      dtLogger.error('fuel_ai_preprocess_error', {
        status: response.status,
        body: errorBody,
      });
      return sendError(res, response.status === 400 ? 400 : 502,
        errorBody.error || 'AI preprocessing failed');
    }

    const aiResult = await response.json();
    res.json(aiResult);
  } catch (err) {
    dtLogger.error('fuel_ai_preprocess_error', err);
    sendError(res, 500, err.message || 'AI preprocessing failed');
  }
});

// ─── Import – Stage (validate & persist batch rows) ──────────────────────────
router.post('/import/stage', upload.single('file'), async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    if (!req.file) return sendError(res, 400, 'No file uploaded');

    const { provider_name, card_account_id, column_map } = req.body;
    if (!provider_name) return sendError(res, 400, 'provider_name is required');

    let parsedMap;
    try {
      parsedMap = typeof column_map === 'string' ? JSON.parse(column_map) : column_map;
    } catch {
      // Fall back to auto-mapping if JSON is broken
      const { headers } = parseFileBuffer(req.file.buffer, req.file.originalname);
      parsedMap = buildAutoMapping(headers, 'generic');
    }

    if (!parsedMap || Object.keys(parsedMap).length === 0) {
      const { headers } = parseFileBuffer(req.file.buffer, req.file.originalname);
      parsedMap = buildAutoMapping(headers, 'generic');
    }

    // Optionally upload file to R2
    let fileStorageKey = null;
    try {
      const uploaded = await uploadBuffer({
        buffer: req.file.buffer,
        contentType: req.file.mimetype || 'text/csv',
        prefix: `fuel-imports/${tid}`,
        fileName: req.file.originalname
      });
      fileStorageKey = uploaded.key;
    } catch (uploadErr) {
      dtLogger.warn('fuel_file_upload_skipped', { reason: uploadErr.message });
    }

    const result = await stageBatch({
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      cardAccountId: card_account_id || null,
      providerName: provider_name,
      fileName: req.file.originalname,
      fileStorageKey,
      buffer: req.file.buffer,
      columnMap: parsedMap,
      importedByUserId: userId(req)
    });

    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_import_stage_error', err);
    sendError(res, err.status || 500, err.message || 'Stage failed');
  }
});

// ─── Import – Commit (insert fuel_transactions) ───────────────────────────────
router.post('/import/commit/:batchId', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { import_warnings } = req.body;
    const result = await commitBatch({
      batchId: req.params.batchId,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      importedByUserId: userId(req),
      importWarnings: !!import_warnings
    });
    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_import_commit_error', err);
    sendError(res, err.status || 500, err.message || 'Commit failed');
  }
});

// ─── Import Batches ───────────────────────────────────────────────────────────
router.get('/import/batches', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { limit = 50, offset = 0 } = req.query;
    const rows = await applyOperatingEntityFilter(
      knex('fuel_import_batches').where({ tenant_id: tid }),
      req
    )
      .orderBy('started_at', 'desc')
      .limit(Number(limit))
      .offset(Number(offset));
    const [{ total }] = await applyOperatingEntityFilter(
      knex('fuel_import_batches').where({ tenant_id: tid }),
      req
    ).count('* as total');
    res.json({ rows, total: Number(total) });
  } catch (err) {
    dtLogger.error('fuel_batches_list_error', err);
    sendError(res, 500, 'Failed to fetch import batches');
  }
});

router.get('/import/batches/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const batch = await applyOperatingEntityFilter(
      knex('fuel_import_batches').where({ id: req.params.id, tenant_id: tid }),
      req
    ).first();
    if (!batch) return sendError(res, 404, 'Batch not found');

    let batchRowsQuery = knex('fuel_import_batch_rows')
      .where({ batch_id: batch.id })
      .orderBy('row_number', 'asc');

    // Optional filter by resolution_status (e.g., ?resolution_status=skipped)
    if (req.query.resolution_status) {
      batchRowsQuery = batchRowsQuery.where('resolution_status', req.query.resolution_status);
    }

    const batchRows = await batchRowsQuery;

    res.json({ batch, rows: batchRows });
  } catch (err) {
    dtLogger.error('fuel_batch_detail_error', err);
    sendError(res, 500, 'Failed to fetch batch detail');
  }
});

// ─── Fuel Transactions ────────────────────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const {
      limit = 50, offset = 0,
      date_from, date_to,
      provider, truck_id, driver_id,
      matched_status, settlement_link_status,
      batch_id, product_type, category
    } = req.query;

    let q = knex('fuel_transactions as ft')
      .leftJoin('vehicles as v', 'v.id', 'ft.truck_id')
      .leftJoin('drivers as d', 'd.id', 'ft.driver_id')
      .where('ft.tenant_id', tid)
      .select(
        'ft.*',
        knex.raw("COALESCE(v.unit_number, ft.unit_number_raw) AS truck_display"),
        knex.raw("COALESCE(d.first_name || ' ' || d.last_name, ft.driver_name_raw) AS driver_display")
      )
      .orderBy('ft.transaction_date', 'desc');

    applyOperatingEntityFilter(q, req, 'ft.operating_entity_id');

    if (date_from) q = q.where('ft.transaction_date', '>=', date_from);
    if (date_to) q = q.where('ft.transaction_date', '<=', date_to);
    if (provider) q = q.whereRaw('LOWER(ft.provider_name) = LOWER(?)', [provider]);
    if (truck_id) q = q.where('ft.truck_id', truck_id);
    if (driver_id) q = q.where('ft.driver_id', driver_id);
    if (matched_status) q = q.where('ft.matched_status', matched_status);
    if (settlement_link_status) q = q.where('ft.settlement_link_status', settlement_link_status);
    if (batch_id) q = q.where('ft.source_batch_id', batch_id);
    if (product_type) q = q.where('ft.product_type', product_type);
    if (category) q = q.where('ft.category', category);

    const total = await applyOperatingEntityFilter(
      knex('fuel_transactions').where('tenant_id', tid),
      req
    )
      .modify((qb) => {
        if (date_from) qb.where('transaction_date', '>=', date_from);
        if (date_to) qb.where('transaction_date', '<=', date_to);
        if (provider) qb.whereRaw('LOWER(provider_name) = LOWER(?)', [provider]);
        if (truck_id) qb.where('truck_id', truck_id);
        if (driver_id) qb.where('driver_id', driver_id);
        if (matched_status) qb.where('matched_status', matched_status);
        if (batch_id) qb.where('source_batch_id', batch_id);
        if (product_type) qb.where('product_type', product_type);
        if (category) qb.where('category', category);
      })
      .count('* as n').then(([r]) => Number(r.n));

    const rows = await q.limit(Number(limit)).offset(Number(offset));
    res.json({ rows, total });
  } catch (err) {
    dtLogger.error('fuel_transactions_list_error', err);
    sendError(res, 500, 'Failed to fetch transactions');
  }
});

router.get('/transactions/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const txn = await applyOperatingEntityFilter(
      knex('fuel_transactions').where({ id: req.params.id, tenant_id: tid }),
      req
    ).first();
    if (!txn) return sendError(res, 404, 'Transaction not found');

    const exceptions = await knex('fuel_transaction_exceptions').where({ fuel_transaction_id: txn.id });
    res.json({ transaction: txn, exceptions });
  } catch (err) {
    dtLogger.error('fuel_transaction_detail_error', err);
    sendError(res, 500, 'Failed to fetch transaction');
  }
});

router.patch('/transactions/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const allowed = ['truck_id', 'driver_id', 'load_id', 'settlement_id', 'settlement_link_status',
      'matched_status', 'notes', 'vendor_name', 'city', 'state'];
    const patch = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) patch[f] = req.body[f];
    }
    patch.updated_at = new Date();

    const [row] = await knex('fuel_transactions')
      .modify((qb) => {
        qb.where({ id: req.params.id, tenant_id: tid });
        applyOperatingEntityFilter(qb, req);
      })
      .update(patch)
      .returning('*');
    if (!row) return sendError(res, 404, 'Transaction not found');
    res.json(row);
  } catch (err) {
    dtLogger.error('fuel_transaction_patch_error', err);
    sendError(res, 500, 'Failed to update transaction');
  }
});

// Manual transaction creation
router.post('/transactions', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const required = ['transaction_date', 'provider_name', 'gallons', 'amount'];
    for (const f of required) {
      if (!req.body[f] && req.body[f] !== 0) return sendError(res, 400, `${f} is required`);
    }

    const [row] = await knex('fuel_transactions').insert({
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req),
      provider_name: req.body.provider_name,
      external_transaction_id: req.body.external_transaction_id || null,
      transaction_date: req.body.transaction_date,
      posted_date: req.body.posted_date || null,
      truck_id: req.body.truck_id || null,
      driver_id: req.body.driver_id || null,
      unit_number_raw: req.body.unit_number_raw || null,
      driver_name_raw: req.body.driver_name_raw || null,
      card_number_masked: req.body.card_number_masked || null,
      vendor_name: req.body.vendor_name || null,
      city: req.body.city || null,
      state: req.body.state || null,
      gallons: parseFloat(req.body.gallons) || 0,
      amount: parseFloat(req.body.amount) || 0,
      price_per_gallon: req.body.price_per_gallon ? parseFloat(req.body.price_per_gallon) : null,
      product_type: req.body.product_type || null,
      odometer: req.body.odometer ? parseInt(req.body.odometer, 10) : null,
      matched_status: req.body.truck_id ? 'manual' : 'unmatched',
      validation_status: 'valid',
      settlement_link_status: 'none',
      is_manual: true,
      created_by: userId(req)
    }).returning('*');

    res.status(201).json(row);
  } catch (err) {
    dtLogger.error('fuel_transaction_create_error', err);
    sendError(res, 500, 'Failed to create transaction');
  }
});

router.delete('/transactions/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const deleted = await applyOperatingEntityFilter(
      knex('fuel_transactions').where({ id: req.params.id, tenant_id: tid }),
      req
    ).del();
    if (!deleted) return sendError(res, 404, 'Transaction not found');
    res.json({ deleted: true });
  } catch (err) {
    dtLogger.error('fuel_transaction_delete_error', err);
    sendError(res, 500, 'Failed to delete transaction');
  }
});

// ─── Exceptions ───────────────────────────────────────────────────────────────
router.get('/exceptions', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { limit = 50, offset = 0, status, exception_type } = req.query;

    let q = knex('fuel_transaction_exceptions as e')
      .join('fuel_transactions as ft', 'ft.id', 'e.fuel_transaction_id')
      .where('e.tenant_id', tid)
      .select('e.*',
        'ft.transaction_date', 'ft.provider_name', 'ft.vendor_name',
        'ft.unit_number_raw', 'ft.driver_name_raw', 'ft.card_number_masked',
        'ft.gallons', 'ft.amount', 'ft.city', 'ft.state'
      )
      .orderBy('e.created_at', 'desc');

    applyOperatingEntityFilter(q, req, 'ft.operating_entity_id');

    if (status) q = q.where('e.resolution_status', status);
    if (exception_type) q = q.where('e.exception_type', exception_type);

    const rows = await q.limit(Number(limit)).offset(Number(offset));
    const [{ total }] = await knex('fuel_transaction_exceptions as e')
      .join('fuel_transactions as ft', 'ft.id', 'e.fuel_transaction_id')
      .where('e.tenant_id', tid)
      .modify((qb) => {
        applyOperatingEntityFilter(qb, req, 'ft.operating_entity_id');
      })
      .modify((qb) => { if (status) qb.where('resolution_status', status); })
      .modify((qb) => { if (exception_type) qb.where('exception_type', exception_type); })
      .count('* as total');

    res.json({ rows, total: Number(total) });
  } catch (err) {
    dtLogger.error('fuel_exceptions_list_error', err);
    sendError(res, 500, 'Failed to fetch exceptions');
  }
});

router.patch('/exceptions/:id/resolve', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { truck_id, driver_id, resolution_notes, ignore } = req.body;
    const result = await resolveException({
      exceptionId: req.params.id,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      resolvedBy: userId(req),
      truckId: truck_id || null,
      driverId: driver_id || null,
      resolutionNotes: resolution_notes || null,
      ignore: !!ignore
    });
    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_exception_resolve_error', err);
    sendError(res, err.status || 500, err.message || 'Resolve failed');
  }
});

router.post('/exceptions/bulk-resolve', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const { exception_ids, action, resolution_notes } = req.body;
    if (!Array.isArray(exception_ids) || !action) return sendError(res, 400, 'exception_ids (array) and action are required');
    const result = await bulkResolveExceptions({
      exceptionIds: exception_ids,
      tenantId: tid,
      operatingEntityId: operatingEntityId(req),
      resolvedBy: userId(req),
      action,
      resolutionNotes: resolution_notes || null
    });
    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_bulk_resolve_error', err);
    sendError(res, 500, 'Bulk resolve failed');
  }
});

// ─── Reprocess unmatched ──────────────────────────────────────────────────────
router.post('/reprocess-unmatched', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const result = await reprocessUnmatched(tid, operatingEntityId(req));
    res.json(result);
  } catch (err) {
    dtLogger.error('fuel_reprocess_error', err);
    sendError(res, 500, 'Reprocess failed');
  }
});

// ─── Overview / dashboard widgets ─────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;

    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
    const monthAgo = new Date(now); monthAgo.setDate(now.getDate() - 30);

    const [weekStats] = await knex('fuel_transactions')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .where('transaction_date', '>=', weekAgo.toISOString().slice(0, 10))
      .select(
        knex.raw('COALESCE(SUM(amount), 0) as total_amount'),
        knex.raw('COALESCE(SUM(gallons), 0) as total_gallons'),
        knex.raw('COUNT(*) as count')
      );

    const [monthStats] = await knex('fuel_transactions')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .where('transaction_date', '>=', monthAgo.toISOString().slice(0, 10))
      .select(
        knex.raw('COALESCE(SUM(amount), 0) as total_amount'),
        knex.raw('COALESCE(SUM(gallons), 0) as total_gallons'),
        knex.raw('COUNT(*) as count')
      );

    const totalGallons = parseFloat(monthStats.total_gallons) || 0;
    const totalAmount = parseFloat(monthStats.total_amount) || 0;
    const avgPpg = totalGallons > 0 ? totalAmount / totalGallons : 0;

    const topVendors = await knex('fuel_transactions')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .where('transaction_date', '>=', monthAgo.toISOString().slice(0, 10))
      .whereNotNull('vendor_name')
      .groupBy('vendor_name')
      .select('vendor_name')
      .sum('amount as total')
      .count('* as count')
      .orderBy('total', 'desc')
      .limit(5);

    const byState = await knex('fuel_transactions')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .where('transaction_date', '>=', monthAgo.toISOString().slice(0, 10))
      .whereNotNull('state')
      .groupBy('state')
      .select('state')
      .sum('gallons as gallons')
      .sum('amount as amount')
      .orderBy('gallons', 'desc')
      .limit(10);

    const [unmatchedCount] = await knex('fuel_transactions')
      .where({ tenant_id: tid, matched_status: 'unmatched' })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .count('* as count');

    const [exceptionsOpen] = await knex('fuel_transaction_exceptions as e')
      .join('fuel_transactions as ft', 'ft.id', 'e.fuel_transaction_id')
      .where({ 'e.tenant_id': tid, 'e.resolution_status': 'open' })
      .modify((qb) => applyOperatingEntityFilter(qb, req, 'ft.operating_entity_id'))
      .count('* as count');

    const lastBatch = await knex('fuel_import_batches')
      .where({ tenant_id: tid })
      .modify((qb) => applyOperatingEntityFilter(qb, req))
      .orderBy('started_at', 'desc')
      .first(['id', 'import_status', 'source_file_name', 'started_at', 'total_rows', 'success_rows', 'failed_rows']);

    res.json({
      week: {
        totalAmount: parseFloat(weekStats.total_amount) || 0,
        totalGallons: parseFloat(weekStats.total_gallons) || 0,
        count: Number(weekStats.count) || 0
      },
      month: {
        totalAmount,
        totalGallons,
        avgPpg: parseFloat(avgPpg.toFixed(4)),
        count: Number(monthStats.count) || 0
      },
      topVendors: topVendors.map((v) => ({ name: v.vendor_name, total: parseFloat(v.total), count: Number(v.count) })),
      byState: byState.map((s) => ({ state: s.state, gallons: parseFloat(s.gallons), amount: parseFloat(s.amount) })),
      unmatchedTransactions: Number(unmatchedCount.count) || 0,
      openExceptions: Number(exceptionsOpen.count) || 0,
      lastBatch: lastBatch || null
    });
  } catch (err) {
    dtLogger.error('fuel_overview_error', err);
    sendError(res, 500, 'Failed to fetch fuel overview');
  }
});

module.exports = router;
