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
const { recalcAndUpdateSettlement } = require('../services/settlement-service');

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

router.post('/devices', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { toll_account_id, device_number_masked, plate_number, truck_id, trailer_id, driver_id, effective_start_date, effective_end_date, notes } = req.body || {};
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
        device_number_masked: device_number_masked || null,
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

router.get('/import', listImportBatches);
router.get('/history', listImportBatches);
router.get('/import/batches', listImportBatches);

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

// POST /import/upload – accept CSV, parse headers + sample rows
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
        source_file_name: req.file.originalname,
        import_status: 'uploaded',
        total_rows: rows.length,
        started_at: new Date(),
        created_by: req.user?.id || null
      })
      .returning('*');

    const sampleRows = rows.slice(0, 5);

    res.status(201).json({
      batchId: batch.id,
      headers,
      sampleRows,
      totalRows: rows.length
    });
  } catch (error) {
    dtLogger.error('tolls_import_upload_failed', error);
    res.status(500).json({ error: 'Failed to upload and parse toll file' });
  }
});

// POST /import/commit – commit mapped rows into toll_transactions
router.post('/import/commit', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { batchId, rows } = req.body || {};
    if (!batchId || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'batchId and a non-empty rows array are required' });
    }

    // Verify batch belongs to tenant
    const batch = await knex('toll_import_batches')
      .where({ id: batchId, tenant_id: tid })
      .first();
    if (!batch) {
      return res.status(404).json({ error: 'Import batch not found' });
    }

    let imported = 0;
    let duplicates = 0;
    let errors = 0;
    let exceptions = 0;

    for (const row of rows) {
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
            source_batch_id: batchId,
            toll_account_id: batch.toll_account_id || null,
            provider_name: row.provider_name || row.provider || null,
            transaction_date: row.transaction_date || null,
            posted_date: row.posted_date || null,
            plaza_name: row.plaza_name || null,
            plaza_state: row.plaza_state || row.state || null,
            entry_plaza: row.entry_plaza || null,
            exit_plaza: row.exit_plaza || null,
            amount: parseFloat(row.amount) || 0,
            discount_amount: parseFloat(row.discount_amount) || 0,
            truck_id: truckId,
            driver_id: driverId,
            unit_number_raw: row.unit_number || row.device_number || null,
            driver_name_raw: row.driver_name || null,
            dedupe_hash: dedupeHash,
            validation_status: matchFailed ? 'exception' : 'valid',
            created_by: req.user?.id || null
          })
          .returning('*');

        // Create audit row
        await knex('toll_import_batch_rows').insert({
          batch_id: batchId,
          tenant_id: tid,
          row_number: imported + duplicates + errors + 1,
          raw_data: JSON.stringify(row),
          toll_transaction_id: txn.id,
          status: matchFailed ? 'exception' : 'success'
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
        dtLogger.error('tolls_import_row_error', { batchId, row, error: rowError.message });
        errors++;

        // Still create audit row for failed rows
        await knex('toll_import_batch_rows').insert({
          batch_id: batchId,
          tenant_id: tid,
          row_number: imported + duplicates + errors,
          raw_data: JSON.stringify(row),
          status: 'error',
          error_message: rowError.message
        }).catch(() => { /* best effort audit */ });
      }
    }

    // Update batch counters and status
    await knex('toll_import_batches')
      .where({ id: batchId })
      .update({
        import_status: 'completed',
        total_rows: rows.length,
        success_rows: imported,
        failed_rows: errors,
        duplicate_rows: duplicates,
        completed_at: new Date(),
        updated_at: new Date()
      });

    res.json({ imported, duplicates, errors, exceptions });
  } catch (error) {
    dtLogger.error('tolls_import_commit_failed', error);
    res.status(500).json({ error: 'Failed to commit toll import' });
  }
});

// GET /import/mapping-profiles – list profiles for tenant
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

// POST /import/mapping-profiles – create a new profile
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
 * POST /api/tolls/transactions/:id/post-to-settlement
 * Manually link a single toll transaction to a settlement as a deduction.
 * Body: { settlement_id }
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

    const asOf = settlement.date || new Date().toISOString().slice(0, 10);
    const expenseProfile = await knex('expense_responsibility_profiles')
      .where({ driver_id: settlement.driver_id })
      .whereRaw('effective_start_date <= ?', [asOf])
      .where(function () {
        this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [asOf]);
      })
      .orderBy('effective_start_date', 'desc')
      .first();

    const tollResponsibility = expenseProfile?.toll_responsibility || 'company';

    let driverSharePct = 1.0;
    let chargeParty = 'driver';

    if (tollResponsibility === 'company') {
      driverSharePct = 0;
      chargeParty = 'company';
    } else if (tollResponsibility === 'shared') {
      chargeParty = 'shared';
      const customRules = expenseProfile?.custom_rules || {};
      const splitPct = Number(customRules.toll_split_percentage);
      driverSharePct = (!Number.isNaN(splitPct) && splitPct >= 0 && splitPct <= 100)
        ? splitPct / 100
        : 0.5;
    }

    const tollAmount = Number(toll.amount) || 0;
    const deductionAmount = Math.round(tollAmount * driverSharePct * 100) / 100;

    const description = [
      'Toll',
      toll.plaza_name || toll.provider_name || '',
      toll.transaction_date ? `(${String(toll.transaction_date).slice(0, 10)})` : ''
    ].filter(Boolean).join(' — ');

    const [adj] = await knex('settlement_adjustment_items')
      .insert({
        settlement_id,
        item_type: 'deduction',
        source_type: 'imported_toll',
        description,
        amount: deductionAmount,
        charge_party: chargeParty,
        apply_to: 'primary_payee',
        source_reference_id: toll.id,
        source_reference_type: 'toll_transaction',
        occurrence_date: toll.transaction_date,
        status: 'applied',
        created_by: req.user?.id ?? null
      })
      .returning('*');

    await knex('toll_transactions')
      .where({ id: toll.id })
      .update({
        settlement_id,
        settlement_adjustment_item_id: adj.id,
        settlement_link_status: 'linked',
        updated_at: knex.fn.now()
      });

    await recalcAndUpdateSettlement(knex, settlement_id);

    res.json({
      success: true,
      adjustment: adj,
      toll_transaction_id: toll.id,
      settlement_id
    });
  } catch (error) {
    dtLogger.error('toll_post_to_settlement_failed', error);
    res.status(500).json({ error: 'Failed to post toll to settlement' });
  }
});

/**
 * POST /api/tolls/transactions/:id/unlink-from-settlement
 * Unlink a toll transaction from its settlement.
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

// ─── Invoice Image Upload + AI Extraction ────────────────────────────────────
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

// ─── CSV AI Normalization ─────────────────────────────────────────────────────
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

module.exports = router;
