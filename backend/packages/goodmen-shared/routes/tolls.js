'use strict';

/**
 * Tolls API – Phase 1 scaffold + CSV import pipeline.
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
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');

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

router.post('/devices', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { toll_account_id, device_number_masked, plate_number, truck_id, trailer_id, driver_id, effective_start_date, effective_end_date, notes } = req.body || {};
    if (!toll_account_id) return res.status(400).json({ error: 'toll_account_id is required' });

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

module.exports = router;
