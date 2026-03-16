'use strict';

/**
 * Tolls API – Phase 1 scaffold.
 * Mounted at /api/tolls in logistics service.
 */

const express = require('express');
const router = express.Router();
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || null;
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

    const [accounts] = await knex('toll_accounts').where({ tenant_id: tid }).count('* as count');
    const [devices] = await knex('toll_devices').where({ tenant_id: tid }).count('* as count');
    const [transactions] = await knex('toll_transactions').where({ tenant_id: tid }).count('* as count');
    const [openExceptions] = await knex('toll_transaction_exceptions').where({ tenant_id: tid, resolution_status: 'open' }).count('* as count');

    const lastBatch = await knex('toll_import_batches')
      .where({ tenant_id: tid })
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
    const rows = await knex('toll_accounts').where({ tenant_id: tid }).orderBy('created_at', 'desc');
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

    const { provider_name, display_name, account_number_masked, import_method, operating_entity_id, notes } = req.body || {};
    if (!provider_name || !display_name) {
      return res.status(400).json({ error: 'provider_name and display_name are required' });
    }

    const [row] = await knex('toll_accounts')
      .insert({
        tenant_id: tid,
        operating_entity_id: operating_entity_id || null,
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
      .where({ id: req.params.id, tenant_id: tid })
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
    const rows = await knex('toll_devices').where({ tenant_id: tid }).orderBy('created_at', 'desc');
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

    const [row] = await knex('toll_devices')
      .insert({
        tenant_id: tid,
        operating_entity_id: req.body?.operating_entity_id || null,
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
      .where({ id: req.params.id, tenant_id: tid })
      .update(patch)
      .returning('*');

    if (!row) return res.status(404).json({ error: 'Toll device not found' });
    res.json(row);
  } catch (error) {
    dtLogger.error('tolls_device_patch_failed', error);
    res.status(500).json({ error: 'Failed to update toll device' });
  }
});

router.get('/import/batches', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const rows = await knex('toll_import_batches')
      .where({ tenant_id: tid })
      .orderBy('started_at', 'desc')
      .limit(limit)
      .offset(offset);

    const [{ total }] = await knex('toll_import_batches').where({ tenant_id: tid }).count('* as total');
    res.json({ rows, total: Number(total || 0) });
  } catch (error) {
    dtLogger.error('tolls_batches_list_failed', error);
    res.status(500).json({ error: 'Failed to fetch toll import batches' });
  }
});

module.exports = router;
