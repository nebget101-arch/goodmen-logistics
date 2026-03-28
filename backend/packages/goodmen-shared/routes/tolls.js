'use strict';

/**
 * Tolls API – Phase 1 scaffold.
 * Mounted at /api/tolls in logistics service.
 */

const express = require('express');
const router = express.Router();
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const multer = require('multer');
const crypto = require('crypto');
const { parseFileBuffer } = require('../services/fuel-parser');

// ─── File upload (memory storage – max 10 MB) ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    const allowed = ['text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'];
    if (allowed.includes(file.mimetype) || ['csv', 'xlsx', 'xls', 'txt'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are accepted'));
    }
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

// ─── Import – Upload CSV (FN-431) ─────────────────────────────────────────────
// Accepts CSV file, creates toll_import_batch, parses rows, returns headers + sample rows + batch_id
router.post('/import/upload', upload.single('file'), async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const providerName = req.body.provider_name || 'generic';
    const tollAccountId = req.body.toll_account_id || null;
    const oeId = operatingEntityId(req);

    // Parse the CSV
    const { headers, rows } = parseFileBuffer(req.file.buffer, req.file.originalname);
    if (!headers || headers.length === 0) {
      return res.status(400).json({ error: 'Could not parse headers from file' });
    }

    // Create batch record
    const [batch] = await knex('toll_import_batches')
      .insert({
        tenant_id: tid,
        operating_entity_id: oeId,
        toll_account_id: tollAccountId,
        provider_name: providerName,
        source_file_name: req.file.originalname,
        import_status: 'pending',
        total_rows: rows.length,
        started_at: knex.fn.now()
      })
      .returning('*');

    // Build sample rows as objects
    const sampleRows = rows.slice(0, 10).map((row, idx) => {
      const obj = { rowNumber: idx + 1 };
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });

    res.json({
      batchId: batch.id,
      fileName: req.file.originalname,
      headers,
      sampleRows,
      totalRows: rows.length
    });
  } catch (error) {
    dtLogger.error('tolls_import_upload_failed', error);
    res.status(500).json({ error: 'Import upload failed' });
  }
});

// ─── Import – Commit (FN-431) ──────────────────────────────────────────────────
// Accepts batch_id + column_map + validated rows, writes to toll_transactions
router.post('/import/commit', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const { batch_id, rows: inputRows, column_map } = req.body;

    if (!batch_id) return res.status(400).json({ error: 'batch_id is required' });
    if (!inputRows || !Array.isArray(inputRows) || inputRows.length === 0) {
      return res.status(400).json({ error: 'rows array is required' });
    }

    // Validate batch exists and belongs to tenant
    const batch = await knex('toll_import_batches')
      .where({ id: batch_id, tenant_id: tid })
      .first();
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const oeId = operatingEntityId(req);
    let parsedMap;
    try {
      parsedMap = typeof column_map === 'string' ? JSON.parse(column_map) : (column_map || {});
    } catch {
      parsedMap = {};
    }

    // Load toll_devices for auto-matching
    const devices = await knex('toll_devices').where({ tenant_id: tid }).select('id', 'device_number', 'plate_number', 'truck_id', 'driver_id');

    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    const exceptions = [];

    await knex.transaction(async (trx) => {
      for (let i = 0; i < inputRows.length; i++) {
        const raw = inputRows[i];
        const rowNum = i + 1;

        try {
          // Apply column mapping to get normalized fields
          const normalized = {};
          for (const [normalizedKey, rawKey] of Object.entries(parsedMap)) {
            if (rawKey && raw[rawKey] !== undefined) {
              normalized[normalizedKey] = raw[rawKey];
            }
          }

          // Generate dedupe hash
          const hashInput = [
            tid,
            normalized.transaction_date || '',
            normalized.amount || '',
            normalized.plaza_name || '',
            normalized.device_number_masked || '',
            normalized.entry_location || '',
            normalized.exit_location || ''
          ].join('|');
          const dedupeHash = crypto.createHash('sha256').update(hashInput).digest('hex');

          // Check for duplicate
          const existing = await trx('toll_transactions')
            .where({ tenant_id: tid, dedupe_hash: dedupeHash })
            .first('id');

          // Save batch row for audit
          await trx('toll_import_batch_rows').insert({
            batch_id,
            row_number: rowNum,
            raw_payload: JSON.stringify(raw),
            normalized_payload: JSON.stringify(normalized),
            dedupe_hash: dedupeHash,
            resolution_status: existing ? 'duplicate' : 'valid'
          });

          if (existing) {
            duplicateCount++;
            continue;
          }

          // Auto-match: lookup device_number or plate_number
          let matchedTruckId = null;
          let matchedDriverId = null;
          let matchedDeviceId = null;
          const deviceNum = normalized.device_number_masked || '';
          const plateNum = normalized.plate_number_raw || '';

          if (deviceNum || plateNum) {
            const device = devices.find(d =>
              (deviceNum && d.device_number && d.device_number.toLowerCase() === deviceNum.toLowerCase()) ||
              (plateNum && d.plate_number && d.plate_number.toLowerCase() === plateNum.toLowerCase())
            );
            if (device) {
              matchedTruckId = device.truck_id;
              matchedDriverId = device.driver_id;
              matchedDeviceId = device.id;
            }
          }

          // Parse amount
          const amount = parseFloat(String(normalized.amount || '0').replace(/[^0-9.\-]/g, '')) || 0;

          // Insert toll_transaction
          const [txn] = await trx('toll_transactions')
            .insert({
              tenant_id: tid,
              operating_entity_id: oeId,
              provider_name: batch.provider_name,
              toll_account_id: batch.toll_account_id,
              toll_device_id: matchedDeviceId,
              external_transaction_id: normalized.external_transaction_id || null,
              transaction_date: normalized.transaction_date || new Date().toISOString().slice(0, 10),
              posted_date: normalized.posted_date || null,
              truck_id: matchedTruckId,
              driver_id: matchedDriverId,
              unit_number_raw: normalized.unit_number_raw || null,
              driver_name_raw: normalized.driver_name_raw || null,
              device_number_masked: deviceNum || null,
              plate_number_raw: plateNum || null,
              plaza_name: normalized.plaza_name || null,
              entry_location: normalized.entry_location || null,
              exit_location: normalized.exit_location || null,
              city: normalized.city || null,
              state: normalized.state || null,
              amount,
              matched_status: matchedTruckId ? 'matched' : 'unmatched',
              validation_status: 'valid',
              is_manual: false,
              source_batch_id: batch_id,
              source_row_number: rowNum,
              dedupe_hash: dedupeHash
            })
            .returning('*');

          // Create exception for unmatched rows
          if (!matchedTruckId && (deviceNum || plateNum)) {
            exceptions.push({
              toll_transaction_id: txn.id,
              tenant_id: tid,
              exception_type: 'match_failed',
              exception_message: `No matching device found for ${deviceNum || plateNum}`,
              resolution_status: 'open'
            });
          }

          successCount++;
        } catch (rowErr) {
          errorCount++;
          dtLogger.warn('tolls_import_row_error', { rowNum, error: rowErr.message });
        }
      }

      // Insert exceptions
      if (exceptions.length > 0) {
        await trx('toll_transaction_exceptions').insert(exceptions);
      }

      // Update batch counters
      await trx('toll_import_batches')
        .where({ id: batch_id })
        .update({
          import_status: 'completed',
          success_rows: successCount,
          failed_rows: errorCount,
          total_rows: inputRows.length,
          updated_at: knex.fn.now()
        });
    });

    res.json({
      batchId: batch_id,
      totalRows: inputRows.length,
      successCount,
      duplicateCount,
      errorCount,
      exceptionsCreated: exceptions.length
    });
  } catch (error) {
    dtLogger.error('tolls_import_commit_failed', error);
    res.status(500).json({ error: 'Import commit failed' });
  }
});

// ─── Mapping Profiles – List (FN-431) ──────────────────────────────────────────
router.get('/import/mapping-profiles', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const rows = await knex('toll_import_mapping_profiles')
      .where({ tenant_id: tid })
      .orderBy('created_at', 'desc');
    res.json({ rows });
  } catch (error) {
    dtLogger.error('tolls_mapping_profiles_list_failed', error);
    res.status(500).json({ error: 'Failed to fetch mapping profiles' });
  }
});

// ─── Mapping Profiles – Save (FN-431) ──────────────────────────────────────────
router.post('/import/mapping-profiles', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const { profile_name, provider_name, column_map, is_default } = req.body;

    if (!profile_name) return res.status(400).json({ error: 'profile_name is required' });
    if (!column_map || typeof column_map !== 'object') {
      return res.status(400).json({ error: 'column_map object is required' });
    }

    // If setting as default, unset existing defaults for this tenant
    if (is_default) {
      await knex('toll_import_mapping_profiles')
        .where({ tenant_id: tid, is_default: true })
        .update({ is_default: false });
    }

    const [profile] = await knex('toll_import_mapping_profiles')
      .insert({
        tenant_id: tid,
        profile_name,
        provider_name: provider_name || null,
        column_map: JSON.stringify(column_map),
        is_default: !!is_default
      })
      .returning('*');

    res.status(201).json(profile);
  } catch (error) {
    dtLogger.error('tolls_mapping_profile_save_failed', error);
    res.status(500).json({ error: 'Failed to save mapping profile' });
  }
});

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

module.exports = router;
