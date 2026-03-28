'use strict';

/**
 * Tolls API – Phase 1 scaffold + settlement integration.
 * Mounted at /api/tolls in logistics service.
 */

const express = require('express');
const router = express.Router();
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const { recalcAndUpdateSettlement } = require('../services/settlement-service');

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

// ---------------------------------------------------------------------------
// Manual toll-to-settlement posting
// ---------------------------------------------------------------------------

/**
 * POST /api/tolls/:id/post-to-settlement
 * Manually link a single toll transaction to a settlement as a deduction.
 * Body: { settlement_id }
 *
 * Creates a settlement_adjustment_item and updates the toll transaction's
 * settlement_link_status to 'linked'.
 */
router.post('/transactions/:id/post-to-settlement', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { settlement_id } = req.body || {};
    if (!settlement_id) {
      return res.status(400).json({ error: 'settlement_id is required' });
    }

    // Fetch the toll transaction
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

    // Verify the settlement exists and belongs to the same tenant
    const settlement = await knex('settlements')
      .where({ id: settlement_id, tenant_id: tid })
      .first();

    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    if (settlement.settlement_status === 'void') {
      return res.status(409).json({ error: 'Cannot post to a voided settlement' });
    }

    // Determine toll responsibility from expense_responsibility_profiles
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
      // Manual override: allow posting even if company responsibility,
      // but mark as company charge so it shows on statement without deduction
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

    // Create the settlement adjustment item
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

    // Link the toll transaction to this settlement
    await knex('toll_transactions')
      .where({ id: toll.id })
      .update({
        settlement_id,
        settlement_adjustment_item_id: adj.id,
        settlement_link_status: 'linked',
        updated_at: knex.fn.now()
      });

    // Recalculate settlement totals
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
 * Unlink a toll transaction from its settlement (reverses post-to-settlement).
 * Removes the settlement_adjustment_item and resets the toll's settlement fields.
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

    // Check settlement is not approved/void
    const settlement = await knex('settlements')
      .where({ id: settlementId, tenant_id: tid })
      .first();

    if (settlement && (settlement.settlement_status === 'approved' || settlement.settlement_status === 'void')) {
      return res.status(409).json({ error: `Cannot unlink from a ${settlement.settlement_status} settlement` });
    }

    // Remove the adjustment item if it exists
    if (toll.settlement_adjustment_item_id) {
      await knex('settlement_adjustment_items')
        .where({ id: toll.settlement_adjustment_item_id })
        .delete();
    }

    // Reset toll transaction settlement fields
    await knex('toll_transactions')
      .where({ id: toll.id })
      .update({
        settlement_id: null,
        settlement_adjustment_item_id: null,
        settlement_link_status: 'none',
        updated_at: knex.fn.now()
      });

    // Recalculate settlement totals
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

module.exports = router;
