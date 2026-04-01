/**
 * Payroll / Settlement APIs: payees, compensation profiles, payee assignments,
 * expense responsibility, recurring deductions, payroll periods, settlements,
 * settlement load items, adjustment items, PDF payload, email.
 */
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const tenantContextMiddleware = require('../middleware/tenant-context-middleware');
const knex = require('../config/knex');
const { uploadBuffer, getSignedDownloadUrl } = require('../storage/r2-storage');
const {
  buildSettlementPdf,
  getSettlementDisplayNumber,
  getSettlementPdfFileName
} = require('../services/settlement-pdf.service');
const {
  sendSettlementEmailReport
} = require('../services/settlement-email.service');
const {
  createDraftSettlement,
  recalcAndUpdateSettlement,
  applyVariableExpenseToSettlement,
  addLoadToSettlement,
  removeLoadFromSettlement,
  addAdjustment,
  removeAdjustment,
  restoreScheduledAdjustment,
  approveSettlement,
  voidSettlement,
  listSettlements,
  getActiveCompensationProfile,
  ensureActiveCompensationProfile,
  getActivePayeeAssignment,
  getEligibleLoads,
  getRecurringDeductionsForPeriod
} = require('../services/settlement-service');
const {
  normalizeRecurringDeductionPayeeIds
} = require('../services/settlement-recurring-deductions');
const { getClient } = require('../internal/db');

async function getSettlementPdfContext(settlementId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) return null;

  const loadItems = await knex('settlement_load_items as sli')
    .join('loads as l', 'l.id', 'sli.load_id')
    .where('sli.settlement_id', settlementId)
    .select(
      'sli.*',
      'l.load_number',
      'l.pickup_location',
      'l.delivery_location',
      knex.raw(`COALESCE(sli.loaded_miles, l.loaded_miles) as loaded_miles`),
      knex.raw(`(
        SELECT ls.city
        FROM load_stops ls
        WHERE ls.load_id = l.id
          AND ls.stop_type = 'PICKUP'
        ORDER BY COALESCE(ls.sequence, 999999) ASC, ls.created_at ASC
        LIMIT 1
      ) as pickup_city`),
      knex.raw(`(
        SELECT ls.state
        FROM load_stops ls
        WHERE ls.load_id = l.id
          AND ls.stop_type = 'PICKUP'
        ORDER BY COALESCE(ls.sequence, 999999) ASC, ls.created_at ASC
        LIMIT 1
      ) as pickup_state`),
      knex.raw(`(
        SELECT ls.city
        FROM load_stops ls
        WHERE ls.load_id = l.id
          AND ls.stop_type = 'DELIVERY'
        ORDER BY COALESCE(ls.sequence, -1) DESC, ls.created_at DESC
        LIMIT 1
      ) as delivery_city`),
      knex.raw(`(
        SELECT ls.state
        FROM load_stops ls
        WHERE ls.load_id = l.id
          AND ls.stop_type = 'DELIVERY'
        ORDER BY COALESCE(ls.sequence, -1) DESC, ls.created_at DESC
        LIMIT 1
      ) as delivery_state`)
    );

  const rawAdjustmentItems = await knex('settlement_adjustment_items')
    .where({ settlement_id: settlementId })
    .orderBy('created_at', 'asc');

  const fuelTransactionIds = rawAdjustmentItems
    .filter((item) => item?.source_type === 'imported_fuel' && item?.source_reference_id)
    .map((item) => String(item.source_reference_id));

  let fuelTransactionsById = new Map();
  if (fuelTransactionIds.length) {
    const fuelTransactions = await knex('fuel_transactions')
      .whereIn('id', fuelTransactionIds)
      .select(
        'id',
        'transaction_date',
        'location_name',
        'vendor_name',
        'city',
        'state',
        'product_type',
        'gallons',
        'amount'
      );

    fuelTransactionsById = new Map(
      fuelTransactions.map((fuel) => [String(fuel.id), fuel])
    );
  }

  const adjustmentItems = rawAdjustmentItems.map((item) => ({
    ...item,
    fuel_transaction: item?.source_type === 'imported_fuel' && item?.source_reference_id
      ? fuelTransactionsById.get(String(item.source_reference_id)) || null
      : null
  }));

  const driver = await knex('drivers')
    .where({ id: settlement.driver_id })
    .select('first_name', 'last_name', 'email')
    .first();

  const primaryPayee = settlement.primary_payee_id
    ? await knex('payees').where({ id: settlement.primary_payee_id }).first()
    : null;

  const additionalPayee = settlement.additional_payee_id
    ? await knex('payees').where({ id: settlement.additional_payee_id }).first()
    : null;

  const period = settlement.payroll_period_id
    ? await knex('payroll_periods').where({ id: settlement.payroll_period_id }).first()
    : null;

  const truck = settlement.truck_id
    ? await knex('vehicles')
      .where({ id: settlement.truck_id })
      .select(
        'id',
        'unit_number',
        'equipment_owner_id',
        knex.raw('license_plate as plate_number')
      )
      .first()
    : null;

  const equipmentOwner = settlement.equipment_owner_id
    ? await knex('payees').where({ id: settlement.equipment_owner_id }).first()
    : null;

  const operatingEntity = settlement.operating_entity_id
    ? await knex('operating_entities').where({ id: settlement.operating_entity_id }).first()
    : null;

  const tenant = settlement.tenant_id
    ? await knex('tenants').where({ id: settlement.tenant_id }).first()
    : null;

  return {
    settlement,
    loadItems,
    adjustmentItems,
    driver: driver || null,
    primaryPayee: primaryPayee || null,
    additionalPayee: additionalPayee || null,
    period: period || null,
    truck: truck || null,
    equipmentOwner: equipmentOwner || null,
    operatingEntity: operatingEntity || null,
    tenant: tenant || null
  };
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = (req.user?.role || '').toString().trim().toLowerCase();
    const allowed = allowedRoles.map((r) => r.toString().trim().toLowerCase());
    if (!allowed.includes(role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

router.use(authMiddleware, tenantContextMiddleware);
const settlementRoles = ['admin', 'carrier_accountant', 'dispatch_manager'];

async function getRequestTenantId(req) {
  if (req.context?.tenantId) return req.context.tenantId;
  if (req.user?.tenant_id) return req.user.tenant_id;

  const userId = req.user?.id || req.user?.sub;
  if (!userId) return null;

  const memberships = await knex('user_tenant_memberships')
    .where({ user_id: userId, is_active: true })
    .orderBy('is_default', 'desc')
    .orderBy('created_at', 'asc')
    .select('tenant_id');
  if (memberships.length > 0) {
    return memberships[0].tenant_id;
  }

  const user = await knex('users').where({ id: userId }).first('tenant_id');
  return user?.tenant_id || null;
}

function applyTenantFilter(qb, tenantId, column = 'tenant_id') {
  if (tenantId) {
    qb.andWhere(column, tenantId);
  }
}

function normalizePayeeType(type) {
  const t = (type || '').toString().trim().toLowerCase();
  if (!t) return null;
  if (t === 'equipment_owner') return 'owner';
  return t;
}

function toPayeeDto(row) {
  if (!row) return row;
  return {
    ...row,
    display_type: row.type === 'owner' ? 'equipment_owner' : row.type
  };
}

let payeesColumnSetCache = null;
let settlementsColumnSetCache = null;

async function getPayeesColumnSet() {
  if (payeesColumnSetCache) return payeesColumnSetCache;
  const rows = await knex('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: 'payees' });
  payeesColumnSetCache = new Set(rows.map((r) => r.column_name));
  return payeesColumnSetCache;
}

async function getSettlementsColumnSet() {
  if (settlementsColumnSetCache) return settlementsColumnSetCache;
  const rows = await knex('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: 'settlements' });
  settlementsColumnSetCache = new Set(rows.map((r) => r.column_name));
  return settlementsColumnSetCache;
}

function includeIfColumnExists(payload, columns, key, value) {
  if (columns.has(key)) payload[key] = value;
}

async function resolvePairedSettlement(settlement, context = null) {
  if (!settlement) return null;

  const settlementColumns = await getSettlementsColumnSet();
  const hasPairedSettlementId = settlementColumns.has('paired_settlement_id');
  if (hasPairedSettlementId && settlement.paired_settlement_id) {
    return knex('settlements as s')
      .modify((qb) => {
        applyTenantFilter(qb, context?.tenantId, 's.tenant_id');
        if (context?.operatingEntityId) {
          qb.andWhere('s.operating_entity_id', context.operatingEntityId);
        }
      })
      .where('s.id', settlement.paired_settlement_id)
      .select('s.id', 's.settlement_number', 's.settlement_type', 's.settlement_status', 's.primary_payee_id')
      .first();
  }

  if (!settlement.driver_id || !settlement.payroll_period_id || !settlement.truck_id || !settlement.settlement_type) {
    return null;
  }

  const counterpartType = settlement.settlement_type === 'equipment_owner' ? 'driver' : 'equipment_owner';
  return knex('settlements as s')
    .modify((qb) => {
      applyTenantFilter(qb, context?.tenantId, 's.tenant_id');
      if (context?.operatingEntityId) {
        qb.andWhere('s.operating_entity_id', context.operatingEntityId);
      }
    })
    .where({
      's.driver_id': settlement.driver_id,
      's.payroll_period_id': settlement.payroll_period_id,
      's.truck_id': settlement.truck_id,
      's.settlement_type': counterpartType
    })
    .whereNot('s.id', settlement.id)
    .select('s.id', 's.settlement_number', 's.settlement_type', 's.settlement_status', 's.primary_payee_id')
    .first();
}

async function findOrCreatePayeeByName({ trx, tenantId, name, requestedType, email, phone }) {
  const trimmedName = (name || '').toString().trim();
  if (!trimmedName) return null;

  const normalizedType = normalizePayeeType(requestedType) || 'owner';
  const existing = await trx('payees')
    .whereRaw('LOWER(TRIM(name)) = LOWER(TRIM(?))', [trimmedName])
    .andWhere('type', normalizedType)
    .modify((qb) => applyTenantFilter(qb, tenantId, 'tenant_id'))
    .first();

  if (existing) {
    return existing;
  }

  const [created] = await trx('payees')
    .insert({
      type: normalizedType,
      name: trimmedName,
      email: email || null,
      phone: phone || null,
      tenant_id: tenantId || null,
      is_active: true
    })
    .returning('*');

  return created;
}

// Root: avoid "Cannot GET /api/settlements/" when base URL is hit
router.get('/', requireRole(settlementRoles), (_req, res) => {
  res.json({
    ok: true,
    message: 'Settlements API',
    links: {
      payees: '/api/settlements/payees',
      payrollPeriods: '/api/settlements/payroll-periods',
      settlements: '/api/settlements/settlements',
      recurringDeductions: '/api/settlements/recurring-deductions'
    }
  });
});

// ---------- Payees ----------
router.get('/payees', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const { type, search, is_active, limit = 50 } = req.query;
    const normalizedType = normalizePayeeType(type);
    let q = knex('payees').where('tenant_id', tenantId);
    if (normalizedType) q = q.where('type', normalizedType);
    if (is_active !== undefined) q = q.where('is_active', is_active === 'true' || is_active === true);
    if (search) q = q.where('name', 'ilike', `%${search}%`);
    q = q.orderBy('name').limit(Math.min(Number(limit) || 50, 100));
    const rows = await q;
    res.json(rows.map(toPayeeDto));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search endpoint for Payable To / Additional Payee dropdowns
router.get('/payees/search', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const term = (req.query.q || req.query.search || '').toString().trim();
    const role = (req.query.role || 'all').toString().trim().toLowerCase(); // primary | additional | all
    const includeInactive = req.query.include_inactive === 'true' || req.query.include_inactive === true;
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    let allowedTypes = ['driver', 'company', 'owner', 'external_company', 'contractor'];
    if (role === 'additional') {
      allowedTypes = ['owner', 'external_company', 'contractor'];
    } else if (role === 'primary') {
      allowedTypes = ['driver', 'company', 'owner', 'external_company', 'contractor'];
    }

    let q = knex('payees')
      .where('tenant_id', tenantId)
      .whereIn('type', allowedTypes)
      .orderBy('name', 'asc')
      .limit(limit);

    if (!includeInactive) {
      q = q.where('is_active', true);
    }

    if (term) {
      q = q.where((builder) => {
        builder
          .where('name', 'ilike', `%${term}%`)
          .orWhere('email', 'ilike', `%${term}%`)
          .orWhere('phone', 'ilike', `%${term}%`);
      });
    }

    const rows = await q;
    res.json(rows.map(toPayeeDto));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payees', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const {
      type,
      name,
      contact_id,
      email,
      phone,
      is_active,
      // Extended fields
      address,
      address_line_2,
      city,
      state,
      zip,
      fid_ein,
      mc,
      notes,
      vendor_type,
      is_additional_payee,
      is_equipment_owner,
      additional_payee_rate,
      settlement_template_type
    } = req.body;
    const columns = await getPayeesColumnSet();
    const normalizedType = normalizePayeeType(type) || 'driver';
    const insertPayload = {
      type: normalizedType,
      name: name || 'Unnamed',
      contact_id: contact_id || null,
      email: email || null,
      phone: phone || null,
      tenant_id: tenantId,
      is_active: is_active !== false
    };

    includeIfColumnExists(insertPayload, columns, 'address', address || null);
    includeIfColumnExists(insertPayload, columns, 'address_line_2', address_line_2 || null);
    includeIfColumnExists(insertPayload, columns, 'city', city || null);
    includeIfColumnExists(insertPayload, columns, 'state', state || null);
    includeIfColumnExists(insertPayload, columns, 'zip', zip || null);
    includeIfColumnExists(insertPayload, columns, 'fid_ein', fid_ein || null);
    includeIfColumnExists(insertPayload, columns, 'mc', mc || null);
    includeIfColumnExists(insertPayload, columns, 'notes', notes || null);
    includeIfColumnExists(insertPayload, columns, 'vendor_type', vendor_type || null);
    includeIfColumnExists(insertPayload, columns, 'is_additional_payee', is_additional_payee === true);
    includeIfColumnExists(insertPayload, columns, 'is_equipment_owner', is_equipment_owner === true);
    includeIfColumnExists(insertPayload, columns, 'additional_payee_rate', additional_payee_rate || null);
    includeIfColumnExists(insertPayload, columns, 'settlement_template_type', settlement_template_type || null);

    const [row] = await knex('payees')
      .insert(insertPayload)
      .returning('*');
    res.status(201).json(toPayeeDto(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit create endpoint used by Driver Edit UI
router.post('/payees/equipment-owner', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const {
      name,
      email,
      phone,
      // Extended fields
      address,
      address_line_2,
      city,
      state,
      zip,
      fid_ein,
      mc,
      notes,
      vendor_type,
      additional_payee_rate,
      settlement_template_type
    } = req.body || {};
    const columns = await getPayeesColumnSet();
    const trimmedName = (name || '').toString().trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Use transaction to atomically create or retrieve payee
    const row = await knex.transaction(async (trx) => {
      const existing = await trx('payees')
        .whereRaw('LOWER(TRIM(name)) = LOWER(TRIM(?))', [trimmedName])
        .andWhere('type', 'owner')
        .andWhere('tenant_id', tenantId)
        .first();

      if (existing) {
        return existing;
      }

      const insertPayload = {
        type: 'owner',
        name: trimmedName,
        email: email || null,
        phone: phone || null,
        tenant_id: tenantId,
        is_active: true
      };

      includeIfColumnExists(insertPayload, columns, 'address', address || null);
      includeIfColumnExists(insertPayload, columns, 'address_line_2', address_line_2 || null);
      includeIfColumnExists(insertPayload, columns, 'city', city || null);
      includeIfColumnExists(insertPayload, columns, 'state', state || null);
      includeIfColumnExists(insertPayload, columns, 'zip', zip || null);
      includeIfColumnExists(insertPayload, columns, 'fid_ein', fid_ein || null);
      includeIfColumnExists(insertPayload, columns, 'mc', mc || null);
      includeIfColumnExists(insertPayload, columns, 'notes', notes || null);
      includeIfColumnExists(insertPayload, columns, 'vendor_type', vendor_type || 'equipment_rental');
      includeIfColumnExists(insertPayload, columns, 'is_additional_payee', true);
      includeIfColumnExists(insertPayload, columns, 'is_equipment_owner', true);
      includeIfColumnExists(insertPayload, columns, 'additional_payee_rate', additional_payee_rate || null);
      includeIfColumnExists(insertPayload, columns, 'settlement_template_type', settlement_template_type || null);

      const [created] = await trx('payees')
        .insert(insertPayload)
        .returning('*');

      return created;
    });

    return res.status(201).json(toPayeeDto(row));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/payees/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const row = await knex('payees').where({ id: req.params.id, tenant_id: tenantId }).first();
    if (!row) return res.status(404).json({ error: 'Payee not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/payees/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const {
      type,
      name,
      contact_id,
      email,
      phone,
      is_active,
      // Extended fields
      address,
      address_line_2,
      city,
      state,
      zip,
      fid_ein,
      mc,
      notes,
      vendor_type,
      is_additional_payee,
      is_equipment_owner,
      additional_payee_rate,
      settlement_template_type
    } = req.body;
    const columns = await getPayeesColumnSet();
    const normalizedType = type != null ? normalizePayeeType(type) : null;
    const updates = {
      ...(normalizedType != null && { type: normalizedType }),
      ...(name != null && { name }),
      ...(contact_id !== undefined && { contact_id }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(is_active !== undefined && { is_active }),
      updated_at: knex.fn.now()
    };

    if (columns.has('address') && address !== undefined) updates.address = address;
    if (columns.has('address_line_2') && address_line_2 !== undefined) updates.address_line_2 = address_line_2;
    if (columns.has('city') && city !== undefined) updates.city = city;
    if (columns.has('state') && state !== undefined) updates.state = state;
    if (columns.has('zip') && zip !== undefined) updates.zip = zip;
    if (columns.has('fid_ein') && fid_ein !== undefined) updates.fid_ein = fid_ein;
    if (columns.has('mc') && mc !== undefined) updates.mc = mc;
    if (columns.has('notes') && notes !== undefined) updates.notes = notes;
    if (columns.has('vendor_type') && vendor_type !== undefined) updates.vendor_type = vendor_type;
    if (columns.has('is_additional_payee') && is_additional_payee !== undefined) updates.is_additional_payee = is_additional_payee;
    if (columns.has('is_equipment_owner') && is_equipment_owner !== undefined) updates.is_equipment_owner = is_equipment_owner;
    if (columns.has('additional_payee_rate') && additional_payee_rate !== undefined) updates.additional_payee_rate = additional_payee_rate;
    if (columns.has('settlement_template_type') && settlement_template_type !== undefined) updates.settlement_template_type = settlement_template_type;

    const [row] = await knex('payees')
      .where({ id: req.params.id, tenant_id: tenantId })
      .update(updates)
      .returning('*');
    if (!row) return res.status(404).json({ error: 'Payee not found' });
    res.json(toPayeeDto(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Compensation profiles ----------
router.get('/drivers/:driverId/compensation-profile', requireRole(settlementRoles), async (req, res) => {
  try {
    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);
    const row = await getActiveCompensationProfile(knex, req.params.driverId, asOf);
    if (!row) return res.status(404).json({ error: 'No active compensation profile' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/drivers/:driverId/compensation-profiles', requireRole(settlementRoles), async (req, res) => {
  try {
    const rows = await knex('driver_compensation_profiles')
      .where({ driver_id: req.params.driverId })
      .orderBy('effective_start_date', 'desc');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drivers/:driverId/compensation-profiles', requireRole(settlementRoles), async (req, res) => {
  try {
    const body = req.body;

    // FN-573: Validate equipment_owner_percentage + percentage_rate <= 100
    const eoPct = body.equipment_owner_percentage != null ? Number(body.equipment_owner_percentage) : null;
    if (eoPct != null) {
      if (!Number.isFinite(eoPct) || eoPct < 0 || eoPct > 100) {
        return res.status(400).json({ error: 'equipment_owner_percentage must be between 0 and 100' });
      }
      const pctRate = Number(body.percentage_rate) || 0;
      if (pctRate + eoPct > 100) {
        return res.status(400).json({ error: 'percentage_rate + equipment_owner_percentage cannot exceed 100' });
      }
    }

    const [row] = await knex('driver_compensation_profiles')
      .insert({
        driver_id: req.params.driverId,
        profile_type: body.profile_type || 'driver',
        pay_model: body.pay_model || 'per_mile',
        percentage_rate: body.percentage_rate ?? null,
        cents_per_mile: body.cents_per_mile ?? null,
        flat_weekly_amount: body.flat_weekly_amount ?? null,
        flat_per_load_amount: body.flat_per_load_amount ?? null,
        // FN-573: persist equipment_owner_percentage on direct profile create
        equipment_owner_percentage: eoPct,
        expense_sharing_enabled: body.expense_sharing_enabled === true,
        effective_start_date: body.effective_start_date || new Date().toISOString().slice(0, 10),
        effective_end_date: body.effective_end_date ?? null,
        status: body.status || 'active',
        notes: body.notes ?? null
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/compensation-profiles/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const body = req.body;

    // FN-573: Validate equipment_owner_percentage + percentage_rate <= 100
    if (body.equipment_owner_percentage !== undefined) {
      const eoPct = body.equipment_owner_percentage != null ? Number(body.equipment_owner_percentage) : null;
      if (eoPct != null) {
        if (!Number.isFinite(eoPct) || eoPct < 0 || eoPct > 100) {
          return res.status(400).json({ error: 'equipment_owner_percentage must be between 0 and 100' });
        }
        // Fetch the existing profile to get current percentage_rate if not supplied in body
        const existing = await knex('driver_compensation_profiles').where({ id: req.params.id }).first();
        const pctRate = Number(body.percentage_rate ?? existing?.percentage_rate) || 0;
        if (pctRate + eoPct > 100) {
          return res.status(400).json({ error: 'percentage_rate + equipment_owner_percentage cannot exceed 100' });
        }
      }
    }

    const [row] = await knex('driver_compensation_profiles')
      .where({ id: req.params.id })
      .update({
        ...(body.profile_type != null && { profile_type: body.profile_type }),
        ...(body.pay_model != null && { pay_model: body.pay_model }),
        ...(body.percentage_rate !== undefined && { percentage_rate: body.percentage_rate }),
        ...(body.cents_per_mile !== undefined && { cents_per_mile: body.cents_per_mile }),
        ...(body.flat_weekly_amount !== undefined && { flat_weekly_amount: body.flat_weekly_amount }),
        ...(body.flat_per_load_amount !== undefined && { flat_per_load_amount: body.flat_per_load_amount }),
        // FN-573: persist equipment_owner_percentage on direct profile update
        ...(body.equipment_owner_percentage !== undefined && {
          equipment_owner_percentage: body.equipment_owner_percentage != null
            ? Number(body.equipment_owner_percentage)
            : null
        }),
        ...(body.expense_sharing_enabled !== undefined && { expense_sharing_enabled: body.expense_sharing_enabled }),
        ...(body.effective_start_date != null && { effective_start_date: body.effective_start_date }),
        ...(body.effective_end_date !== undefined && { effective_end_date: body.effective_end_date }),
        ...(body.status != null && { status: body.status }),
        ...(body.notes !== undefined && { notes: body.notes }),
        updated_at: knex.fn.now()
      })
      .returning('*');
    if (!row) return res.status(404).json({ error: 'Profile not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Driver payee assignments ----------
router.get('/drivers/:driverId/payee-assignment', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);
    const assignment = await getActivePayeeAssignment(knex, req.params.driverId, asOf);
    if (!assignment) return res.status(404).json({ error: 'No active payee assignment' });
    
    // Fetch payee details
    const primaryPayee = assignment.primary_payee_id
      ? await knex('payees').where({ id: assignment.primary_payee_id, tenant_id: tenantId }).first()
      : null;
    const additionalPayee = assignment.additional_payee_id
      ? await knex('payees').where({ id: assignment.additional_payee_id, tenant_id: tenantId }).first()
      : null;
    
    res.json({
      assignment,
      primary_payee: primaryPayee || null,
      additional_payee: additionalPayee || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drivers/:driverId/payee-assignments', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const { primary_payee_id, additional_payee_id, rule_type, effective_start_date, effective_end_date } = req.body;

    if (primary_payee_id) {
      const primaryPayee = await knex('payees').where({ id: primary_payee_id, tenant_id: tenantId }).first('id');
      if (!primaryPayee) return res.status(400).json({ error: 'Primary payee does not belong to this tenant' });
    }
    if (additional_payee_id) {
      const additionalPayee = await knex('payees').where({ id: additional_payee_id, tenant_id: tenantId }).first('id');
      if (!additionalPayee) return res.status(400).json({ error: 'Additional payee does not belong to this tenant' });
    }

    // End-date any existing open assignment for this driver
    const newStart = effective_start_date || new Date().toISOString().slice(0, 10);
    await knex('driver_payee_assignments')
      .where({ driver_id: req.params.driverId, tenant_id: tenantId })
      .whereNull('effective_end_date')
      .update({ effective_end_date: newStart, updated_at: knex.fn.now() });

    const [row] = await knex('driver_payee_assignments')
      .insert({
        driver_id: req.params.driverId,
        primary_payee_id: primary_payee_id,
        additional_payee_id: additional_payee_id ?? null,
        rule_type: rule_type || 'custom',
        effective_start_date: newStart,
        effective_end_date: effective_end_date ?? null,
        tenant_id: tenantId
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upsert-like helper for Driver Edit page:
// - accepts IDs if selected from dropdown
// - accepts names if user typed a new payable_to / additional payee
// - creates missing equipment owner payees on the fly
router.post('/drivers/:driverId/payee-assignment/resolve', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const {
      primary_payee_id,
      primary_payee_name,
      primary_payee_type,
      additional_payee_id,
      additional_payee_name,
      additional_payee_type,
      rule_type,
      effective_start_date,
      effective_end_date
    } = req.body || {};

    const result = await knex.transaction(async (trx) => {
      let primary = null;
      let additional = null;

      if (primary_payee_id) {
        primary = await trx('payees').where({ id: primary_payee_id, tenant_id: tenantId }).first();
      } else if (primary_payee_name) {
        primary = await findOrCreatePayeeByName({
          trx,
          tenantId,
          name: primary_payee_name,
          requestedType: primary_payee_type || 'driver'
        });
      }

      if (!primary) {
        const err = new Error('Primary payable-to is required');
        err.status = 400;
        throw err;
      }

      if (additional_payee_id) {
        additional = await trx('payees').where({ id: additional_payee_id, tenant_id: tenantId }).first();
      } else if (additional_payee_name) {
        additional = await findOrCreatePayeeByName({
          trx,
          tenantId,
          name: additional_payee_name,
          requestedType: additional_payee_type || 'owner'
        });
      }

      // End-date any existing open assignment for this driver before creating the new one
      const newStart = effective_start_date || new Date().toISOString().slice(0, 10);
      await trx('driver_payee_assignments')
        .where({ driver_id: req.params.driverId, tenant_id: tenantId })
        .whereNull('effective_end_date')
        .update({ effective_end_date: newStart, updated_at: trx.fn.now() });

      const [assignment] = await trx('driver_payee_assignments')
        .insert({
          driver_id: req.params.driverId,
          primary_payee_id: primary.id,
          additional_payee_id: additional?.id || null,
          rule_type: rule_type || 'custom',
          effective_start_date: newStart,
          effective_end_date: effective_end_date ?? null,
          tenant_id: tenantId
        })
        .returning('*');

      return {
        assignment,
        primary_payee: toPayeeDto(primary),
        additional_payee: toPayeeDto(additional)
      };
    });

    return res.status(201).json({
      assignment: result.assignment,
      primary_payee: result.primary_payee,
      additional_payee: result.additional_payee
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ---------- Expense responsibility profiles ----------
router.get('/drivers/:driverId/expense-responsibility', requireRole(settlementRoles), async (req, res) => {
  try {
    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);
    const d = asOf.toString().slice(0, 10);
    const row = await knex('expense_responsibility_profiles')
      .where({ driver_id: req.params.driverId })
      .whereRaw('effective_start_date <= ?', [d])
      .where(function () {
        this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [d]);
      })
      // FN-569: secondary sort by created_at ensures deterministic result when
      // multiple rows share the same effective_start_date (e.g. same-day saves).
      .orderBy([
        { column: 'effective_start_date', order: 'desc' },
        { column: 'created_at', order: 'desc' }
      ])
      .first();
    res.json(row || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drivers/:driverId/expense-responsibility', requireRole(settlementRoles), async (req, res) => {
  try {
    const body = req.body;
    const newStart = body.effective_start_date || new Date().toISOString().slice(0, 10);

    const row = await knex.transaction(async (trx) => {
      // Look up active compensation profile for this driver
      let compensationProfileId = body.compensation_profile_id;
      if (!compensationProfileId) {
        const driver = await trx('drivers')
          .where({ id: req.params.driverId })
          .select('id', 'pay_basis', 'pay_rate', 'pay_percentage', 'driver_type', 'hire_date')
          .first();
        const activeProfile = driver
          ? await ensureActiveCompensationProfile(trx, driver, newStart)
          : null;
        compensationProfileId = activeProfile?.id || null;
      }

      // FN-569: Close any existing open expense-responsibility record for this driver
      // before inserting the new one (mirrors the payee-assignment/resolve pattern).
      // Sets effective_end_date = newStart so only the newly inserted row is the
      // "current" record going forward.
      await trx('expense_responsibility_profiles')
        .where({ driver_id: req.params.driverId })
        .whereNull('effective_end_date')
        .update({ effective_end_date: newStart, updated_at: trx.fn.now() });

      const [inserted] = await trx('expense_responsibility_profiles')
        .insert({
          driver_id: req.params.driverId,
          compensation_profile_id: compensationProfileId,
          fuel_responsibility: body.fuel_responsibility ?? null,
          insurance_responsibility: body.insurance_responsibility ?? null,
          eld_responsibility: body.eld_responsibility ?? null,
          trailer_rent_responsibility: body.trailer_rent_responsibility ?? null,
          toll_responsibility: body.toll_responsibility ?? null,
          repairs_responsibility: body.repairs_responsibility ?? null,
          // FN-497: shared expense split config columns
          split_type: body.split_type ?? null,
          driver_percentage: body.driver_percentage ?? null,
          driver_fixed_amount: body.driver_fixed_amount ?? null,
          owner_fixed_amount: body.owner_fixed_amount ?? null,
          custom_rules: body.custom_rules != null ? JSON.stringify(body.custom_rules) : trx.raw("'{}'::jsonb"),
          effective_start_date: newStart,
          effective_end_date: body.effective_end_date ?? null
        })
        .returning('*');

      return inserted;
    });

    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Recurring deductions ----------
router.get('/recurring-deductions', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const { driver_id, payee_id, payee_ids, enabled } = req.query;
    let q = knex('recurring_deduction_rules as rdr')
      .leftJoin('drivers as d', 'd.id', 'rdr.driver_id')
      .leftJoin('payees as p', 'p.id', 'rdr.payee_id')
      .where('rdr.tenant_id', tenantId)
      .select(
        'rdr.*',
        knex.raw("concat_ws(' ', d.first_name, d.last_name) as driver_name"),
        'p.name as payee_name',
        'p.type as payee_type'
      );
    const normalizedPayeeIds = [payee_id, payee_ids]
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter(Boolean);

    if (driver_id && normalizedPayeeIds.length) {
      q = q.where(function () {
        this.where('rdr.driver_id', driver_id)
          .orWhere(function () {
            this.whereNull('rdr.driver_id').whereIn('rdr.payee_id', normalizedPayeeIds);
          });
      });
    } else if (driver_id) {
      q = q.where('rdr.driver_id', driver_id);
    } else if (normalizedPayeeIds.length) {
      q = q.whereIn('rdr.payee_id', normalizedPayeeIds);
    }
    if (enabled !== undefined) q = q.where('rdr.enabled', enabled === 'true' || enabled === true);
    const rows = await q.orderBy('rdr.start_date', 'desc');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/recurring-deductions', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const body = req.body;

    // Validate sharing splits when expense_responsibility is 'shared'
    if (body.expense_responsibility === 'shared') {
      if (!body.split_type) {
        return res.status(400).json({ error: 'split_type is required when expense_responsibility is shared' });
      }
      const driverShare = Number(body.driver_share ?? 0);
      const ownerShare = Number(body.owner_share ?? 0);
      if (body.split_type === 'percentage' && Math.abs(driverShare + ownerShare - 100) > 0.01) {
        return res.status(400).json({ error: 'Percentage splits must sum to 100%' });
      }
      if (body.split_type === 'fixed_amount') {
        const totalAmount = Number(body.amount ?? 0);
        if (totalAmount > 0 && Math.abs(driverShare + ownerShare - totalAmount) > 0.01) {
          return res.status(400).json({ error: 'Fixed amount splits must sum to the total deduction amount' });
        }
      }
    }

    const [row] = await knex('recurring_deduction_rules')
      .insert({
        driver_id: body.driver_id ?? null,
        payee_id: body.payee_id ?? null,
        equipment_id: body.equipment_id ?? null,
        rule_scope: body.rule_scope || 'driver',
        description: body.description ?? null,
        amount_type: body.amount_type || 'fixed',
        amount: body.amount ?? 0,
        frequency: body.frequency || 'weekly',
        start_date: body.start_date || new Date().toISOString().slice(0, 10),
        end_date: body.end_date ?? null,
        source_type: body.source_type ?? null,
        applies_when: body.applies_when ?? 'always',
        expense_responsibility: body.expense_responsibility ?? null,
        split_type: body.expense_responsibility === 'shared' ? (body.split_type || null) : null,
        driver_share: body.expense_responsibility === 'shared' ? (body.driver_share ?? null) : null,
        owner_share: body.expense_responsibility === 'shared' ? (body.owner_share ?? null) : null,
        tenant_id: tenantId,
        enabled: body.enabled !== false
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/recurring-deductions/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const body = req.body;

    // For validation, resolve the effective expense_responsibility (from body or existing row)
    let effectiveExpResp = body.expense_responsibility;
    if (effectiveExpResp === undefined) {
      const existing = await knex('recurring_deduction_rules').where({ id: req.params.id, tenant_id: tenantId }).first();
      if (!existing) return res.status(404).json({ error: 'Not found' });
      effectiveExpResp = existing.expense_responsibility;
    }

    // Validate sharing splits when expense_responsibility is 'shared'
    if (effectiveExpResp === 'shared' && (body.split_type !== undefined || body.driver_share !== undefined || body.owner_share !== undefined)) {
      const splitType = body.split_type;
      const driverShare = Number(body.driver_share ?? 0);
      const ownerShare = Number(body.owner_share ?? 0);
      if (splitType === 'percentage' && Math.abs(driverShare + ownerShare - 100) > 0.01) {
        return res.status(400).json({ error: 'Percentage splits must sum to 100%' });
      }
      if (splitType === 'fixed_amount') {
        const totalAmount = Number(body.amount ?? 0);
        if (totalAmount > 0 && Math.abs(driverShare + ownerShare - totalAmount) > 0.01) {
          return res.status(400).json({ error: 'Fixed amount splits must sum to the total deduction amount' });
        }
      }
    }

    const updates = { updated_at: knex.fn.now() };
    if (body.driver_id !== undefined) updates.driver_id = body.driver_id || null;
    if (body.payee_id !== undefined) updates.payee_id = body.payee_id || null;
    if (body.equipment_id !== undefined) updates.equipment_id = body.equipment_id || null;
    if (body.rule_scope !== undefined) updates.rule_scope = body.rule_scope || 'driver';
    if (body.description !== undefined) updates.description = body.description ?? null;
    if (body.amount_type !== undefined) updates.amount_type = body.amount_type || 'fixed';
    if (body.amount !== undefined) updates.amount = body.amount ?? 0;
    if (body.frequency !== undefined) updates.frequency = body.frequency || 'weekly';
    if (body.start_date !== undefined) updates.start_date = body.start_date || new Date().toISOString().slice(0, 10);
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.end_date !== undefined) updates.end_date = body.end_date;
    if (body.source_type !== undefined) updates.source_type = body.source_type ?? null;
    if (body.applies_when !== undefined) updates.applies_when = body.applies_when ?? 'always';
    if (body.expense_responsibility !== undefined) {
      updates.expense_responsibility = body.expense_responsibility ?? null;
      // Clear split fields if not shared
      if (body.expense_responsibility !== 'shared') {
        updates.split_type = null;
        updates.driver_share = null;
        updates.owner_share = null;
      }
    }
    if (body.split_type !== undefined) updates.split_type = body.split_type ?? null;
    if (body.driver_share !== undefined) updates.driver_share = body.driver_share ?? null;
    if (body.owner_share !== undefined) updates.owner_share = body.owner_share ?? null;

    const [row] = await knex('recurring_deduction_rules')
      .where({ id: req.params.id, tenant_id: tenantId })
      .update(updates)
      .returning('*');
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/recurring-deductions/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = await getRequestTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Forbidden: tenant context missing' });

    const { id } = req.params;

    const existing = await knex('recurring_deduction_rules').where({ id, tenant_id: tenantId }).first();
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await knex('recurring_deduction_rules').where({ id, tenant_id: tenantId }).del();
    return res.json({ success: true, message: 'Recurring deduction deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/recurring-deductions/backfill', requireRole(settlementRoles), async (req, res) => {
  try {
    const {
      driver_id,
      start_date,
      end_date,
      include_locked = false,
      dry_run = false,
      limit = 500
    } = req.body || {};

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }

    let query = knex('settlements as s')
      .leftJoin('payroll_periods as pp', 'pp.id', 's.payroll_period_id')
      .select('s.id', 's.driver_id', 's.settlement_status', 'pp.period_start', 'pp.period_end')
      .whereRaw('COALESCE(pp.period_end, pp.period_start, s.date::date, s.created_at::date) BETWEEN ? AND ?', [start_date, end_date])
      .orderByRaw('COALESCE(pp.period_end, pp.period_start, s.date::date, s.created_at::date) ASC')
      .limit(Math.min(Number(limit) || 500, 2000));

    if (driver_id) {
      query = query.where('s.driver_id', driver_id);
    }

    if (!include_locked) {
      query = query.whereRaw("LOWER(COALESCE(s.settlement_status, '')) NOT IN ('approved', 'paid', 'void')");
    }

    const candidates = await query;

    if (dry_run) {
      return res.json({
        mode: 'dry_run',
        filters: { driver_id: driver_id || null, start_date, end_date, include_locked: !!include_locked },
        matched_count: candidates.length,
        matched_settlement_ids: candidates.map((s) => s.id)
      });
    }

    const updated = [];
    const failed = [];
    let settlementsWithScheduledDeductions = 0;
    let scheduledDeductionRowCount = 0;

    for (const s of candidates) {
      try {
        await recalcAndUpdateSettlement(knex, s.id, {
          historicalRecurringRuleStartDateStart: start_date,
          historicalRecurringRuleStartDateEnd: end_date
        });
        updated.push(s.id);

        const scheduledCountRow = await knex('settlement_adjustment_items')
          .where({ settlement_id: s.id, source_type: 'scheduled_rule' })
          .count('* as count')
          .first();

        const scheduledCount = Number(scheduledCountRow?.count || 0);
        if (scheduledCount > 0) {
          settlementsWithScheduledDeductions += 1;
          scheduledDeductionRowCount += scheduledCount;
        }
      } catch (err) {
        failed.push({ id: s.id, error: err.message });
      }
    }

    res.json({
      mode: 'execute',
      filters: { driver_id: driver_id || null, start_date, end_date, include_locked: !!include_locked },
      matched_count: candidates.length,
      updated_count: updated.length,
      settlements_with_scheduled_deductions: settlementsWithScheduledDeductions,
      scheduled_deduction_row_count: scheduledDeductionRowCount,
      failed_count: failed.length,
      updated_settlement_ids: updated,
      failures: failed
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Payroll periods ----------
router.get('/payroll-periods', requireRole(settlementRoles), async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    let q = knex('payroll_periods')
      .modify((qb) => {
        if (req.context?.tenantId) qb.where('tenant_id', req.context.tenantId);
        if (req.context?.operatingEntityId) qb.andWhere('operating_entity_id', req.context.operatingEntityId);
      })
      .orderBy('period_start', 'desc')
      .limit(Math.min(Number(limit) || 50, 100));
    if (status) q = q.where('status', status);
    const rows = await q;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payroll-periods', requireRole(settlementRoles), async (req, res) => {
  try {
    const tenantId = req.context?.tenantId || null;
    const operatingEntityId = req.context?.operatingEntityId || null;
    if (!tenantId || !operatingEntityId) {
      return res.status(403).json({ error: 'Operating entity context is required to create a payroll period' });
    }

    const { period_start, period_end, run_type } = req.body;
    const [row] = await knex('payroll_periods')
      .insert({
        tenant_id: tenantId,
        operating_entity_id: operatingEntityId,
        period_start: period_start || new Date().toISOString().slice(0, 10),
        period_end: period_end || new Date().toISOString().slice(0, 10),
        run_type: run_type || 'weekly',
        status: 'draft',
        created_by: req.user?.id ?? null
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/payroll-periods/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const { status } = req.body;
    const [row] = await knex('payroll_periods')
      .where({ id: req.params.id })
      .modify((qb) => {
        if (req.context?.tenantId) qb.andWhere('tenant_id', req.context.tenantId);
        if (req.context?.operatingEntityId) qb.andWhere('operating_entity_id', req.context.operatingEntityId);
      })
      .update({ status, updated_at: knex.fn.now() })
      .returning('*');
    if (!row) return res.status(404).json({ error: 'Period not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Eligible loads (preview for settlement) ----------
router.get('/eligible-loads', requireRole(settlementRoles), async (req, res) => {
  try {
    const { driver_id, period_start, period_end, date_basis } = req.query;
    if (!driver_id || !period_start || !period_end) {
      return res.status(400).json({ error: 'driver_id, period_start, period_end required' });
    }
      const client = await getClient(); // Ensure client is obtained
    try {
      const loads = await getEligibleLoads(knex, client, driver_id, period_start, period_end, date_basis || 'pickup', req.context || null);
      res.json(loads);
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recurring-deductions/preview', requireRole(settlementRoles), async (req, res) => {
  try {
    const { driver_id, period_start, period_end } = req.query;
    if (!driver_id || !period_start || !period_end) {
      return res.status(400).json({ error: 'driver_id, period_start, period_end required' });
    }
    let payeeAssignment = await getActivePayeeAssignment(knex, driver_id, period_end);
    if (!payeeAssignment) {
      payeeAssignment = await knex('driver_payee_assignments')
        .where({ driver_id })
        .orderBy('effective_start_date', 'desc')
        .first();
    }
    const payeeIds = normalizeRecurringDeductionPayeeIds([], payeeAssignment);
    const rows = await getRecurringDeductionsForPeriod(knex, driver_id, period_start, period_end, payeeIds);
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    res.json({ rules: rows, totalDeductions: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Settlements ----------
router.get('/settlements', requireRole(settlementRoles), async (req, res) => {
  try {
    const filters = {
      driver_id: req.query.driver_id,
      payroll_period_id: req.query.payroll_period_id,
      settlement_status: req.query.settlement_status,
      settlement_type: req.query.settlement_type,
      truck_id: req.query.truck_id,
      equipment_owner_id: req.query.equipment_owner_id,
      paired_settlement_id: req.query.paired_settlement_id,
      settlement_number: req.query.settlement_number,
      limit: req.query.limit,
      offset: req.query.offset
    };
    const rows = await listSettlements(knex, filters, req.context || null);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const createDraftHandler = async (req, res) => {
  try {
    const { payroll_period_id, driver_id, date_basis } = req.body;
    if (!payroll_period_id || !driver_id) {
      return res.status(400).json({ error: 'payroll_period_id and driver_id required' });
    }
    const settlement = await createDraftSettlement(
      payroll_period_id,
      driver_id,
      date_basis || 'pickup',
      req.user?.id ?? null,
      knex,
      req.context || null
    );
    res.status(201).json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// POST /api/settlements/draft (alias for frontend)
router.post('/draft', requireRole(settlementRoles), createDraftHandler);
// POST /api/settlements/settlements/draft
router.post('/settlements/draft', requireRole(settlementRoles), createDraftHandler);

router.get('/settlements/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlementColumns = await getSettlementsColumnSet();
    const hasPairedSettlementId = settlementColumns.has('paired_settlement_id');
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });

    const loadItems = await knex('settlement_load_items as sli')
      .leftJoin('loads as l', 'l.id', 'sli.load_id')
      .where('sli.settlement_id', req.params.id)
      .select(
        'sli.id',
        'sli.settlement_id',
        'sli.load_id',
        knex.raw('COALESCE(sli.pickup_date, l.pickup_date) as pickup_date'),
        knex.raw('COALESCE(sli.delivery_date, l.delivery_date) as delivery_date'),
        'sli.loaded_miles',
        'sli.pay_basis_snapshot',
        'sli.gross_amount',
        'sli.driver_pay_amount',
        'sli.additional_payee_amount',
        'sli.included_by',
        'sli.created_at',
        'sli.updated_at',
        'l.load_number'
      );

    const adjustmentItems = await knex('settlement_adjustment_items')
      .where({ settlement_id: req.params.id })
      .orderBy('created_at', 'asc');

    const driver = await knex('drivers')
      .where({ id: settlement.driver_id })
      .select('id', 'first_name', 'last_name', 'email')
      .first();

    const period = await knex('payroll_periods')
      .where({ id: settlement.payroll_period_id })
      .first();

    const truck = settlement.truck_id
      ? await knex('vehicles')
        .where({ id: settlement.truck_id })
        .select(
          'id',
          'unit_number',
          'equipment_owner_id',
          knex.raw('license_plate as plate_number')
        )
        .first()
      : null;

    const equipmentOwner = settlement.equipment_owner_id
      ? await knex('payees')
        .where({ id: settlement.equipment_owner_id })
        .first()
      : null;

    let primaryPayee = settlement.primary_payee_id
      ? await knex('payees').where({ id: settlement.primary_payee_id }).first()
      : null;

    let additionalPayee = settlement.additional_payee_id
      ? await knex('payees').where({ id: settlement.additional_payee_id }).first()
      : null;

    if (!primaryPayee || !additionalPayee) {
      const asOf = settlement.date || period?.period_end || new Date().toISOString().slice(0, 10);
      let assignment = await getActivePayeeAssignment(knex, settlement.driver_id, asOf);
      if (!assignment) {
        assignment = await knex('driver_payee_assignments')
          .where({ driver_id: settlement.driver_id })
          .orderBy('effective_start_date', 'desc')
          .first();
      }
      if (!primaryPayee && assignment?.primary_payee_id) {
        primaryPayee = await knex('payees').where({ id: assignment.primary_payee_id }).first();
      }
      if (!additionalPayee && assignment?.additional_payee_id) {
        additionalPayee = await knex('payees').where({ id: assignment.additional_payee_id }).first();
      }
    }

    const adjustmentGroups = {
      scheduled: adjustmentItems.filter((i) => i.source_type === 'scheduled_rule'),
      manual: adjustmentItems.filter((i) => (i.source_type || 'manual') === 'manual'),
      variable: adjustmentItems.filter((i) => !['scheduled_rule', 'scheduled_rule_removed', 'manual', null, undefined].includes(i.source_type))
    };

    const pairedSettlement = await resolvePairedSettlement(settlement, req.context || null);

    res.json({
      ...settlement,
      paired_settlement_id: hasPairedSettlementId ? settlement.paired_settlement_id || null : pairedSettlement?.id || null,
      paired_settlement: pairedSettlement || null,
      driver: driver || null,
      period: period || null,
      truck: truck || null,
      equipment_owner: equipmentOwner || null,
      primary_payee: primaryPayee || null,
      additional_payee: additionalPayee || null,
      load_items: loadItems,
      adjustment_items: adjustmentItems,
      adjustment_groups: adjustmentGroups
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settlements/:id/recalc', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await recalcAndUpdateSettlement(knex, req.params.id);
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/settlements/:id/loads', requireRole(settlementRoles), async (req, res) => {
  try {
    const { load_id } = req.body;
    if (!load_id) return res.status(400).json({ error: 'load_id required' });
    await addLoadToSettlement(knex, req.params.id, load_id, req.user?.id ?? null);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/settlements/:id/loads/:loadItemId', requireRole(settlementRoles), async (req, res) => {
  try {
    await removeLoadFromSettlement(knex, req.params.id, req.params.loadItemId);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/settlements/:id/adjustments', requireRole(settlementRoles), async (req, res) => {
  try {
    await addAdjustment(knex, req.params.id, req.body, req.user?.id ?? null);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/settlements/:id/adjustments/:adjustmentId', requireRole(settlementRoles), async (req, res) => {
  try {
    await removeAdjustment(knex, req.params.id, req.params.adjustmentId);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/settlements/:id/adjustments/:adjustmentId/restore', requireRole(settlementRoles), async (req, res) => {
  try {
    await restoreScheduledAdjustment(knex, req.params.id, req.params.adjustmentId);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/settlements/:id/approve', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await approveSettlement(knex, req.params.id, req.user?.id ?? null);
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/settlements/:id/void', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await voidSettlement(knex, req.params.id);
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- PDF payload (Phase 4) ----------
router.get('/settlements/:id/pdf-payload', requireRole(settlementRoles), async (req, res) => {
  try {
    const payload = await getSettlementPdfContext(req.params.id);
    if (!payload) return res.status(404).json({ error: 'Settlement not found' });

    res.json({
      settlement: payload.settlement,
      driver: payload.driver || {},
      primary_payee: payload.primaryPayee || {},
      additional_payee: payload.additionalPayee || null,
      truck: payload.truck || null,
      equipment_owner: payload.equipmentOwner || null,
      operating_entity: payload.operatingEntity || null,
      tenant: payload.tenant || null,
      period: payload.period || {},
      load_items: payload.loadItems,
      adjustment_items: payload.adjustmentItems
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate PDF and upload to Cloudflare R2, then return signed URL
router.post('/settlements/:id/pdf/generate', requireRole(settlementRoles), async (req, res) => {
  try {
    const payload = await getSettlementPdfContext(req.params.id);
    if (!payload) return res.status(404).json({ error: 'Settlement not found' });

    const pdfBuffer = await buildSettlementPdf({
      settlement: payload.settlement,
      driver: payload.driver,
      period: payload.period,
      primaryPayee: payload.primaryPayee,
      additionalPayee: payload.additionalPayee,
      loadItems: payload.loadItems,
      adjustmentItems: payload.adjustmentItems,
      truck: payload.truck,
      equipmentOwner: payload.equipmentOwner,
      operatingEntity: payload.operatingEntity,
      tenant: payload.tenant
    });

    const displaySettlementNumber = getSettlementDisplayNumber(payload);
    const fileName = getSettlementPdfFileName(payload);
    const { key: storageKey } = await uploadBuffer({
      buffer: pdfBuffer,
      contentType: 'application/pdf',
      prefix: `settlements/${payload.settlement.id}`,
      fileName
    });

    const downloadUrl = await getSignedDownloadUrl(storageKey);

    res.json({
      success: true,
      settlement_id: payload.settlement.id,
      settlement_number_display: displaySettlementNumber,
      storage_key: storageKey,
      file_name: fileName,
      download_url: downloadUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to generate settlement PDF' });
  }
});

async function sendSettlementPdfDownload(req, res) {
  const payload = await getSettlementPdfContext(req.params.id);
  if (!payload) return res.status(404).json({ error: 'Settlement not found' });

  const pdfBuffer = await buildSettlementPdf({
    settlement: payload.settlement,
    driver: payload.driver,
    period: payload.period,
    primaryPayee: payload.primaryPayee,
    additionalPayee: payload.additionalPayee,
    loadItems: payload.loadItems,
    adjustmentItems: payload.adjustmentItems,
    truck: payload.truck,
    equipmentOwner: payload.equipmentOwner,
    operatingEntity: payload.operatingEntity,
    tenant: payload.tenant
  });

  const fileName = getSettlementPdfFileName(payload);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(pdfBuffer);
}

// Canonical PDF download endpoint
router.get('/settlements/:id/pdf', requireRole(settlementRoles), async (req, res) => {
  try {
    return await sendSettlementPdfDownload(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to download settlement PDF' });
  }
});

// Legacy direct PDF download stream (kept for backward compatibility)
router.get('/settlements/:id/pdf/download', requireRole(settlementRoles), async (req, res) => {
  try {
    return await sendSettlementPdfDownload(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to download settlement PDF' });
  }
});

// ---------- Send settlement email (Phase 4) ----------
router.post('/settlements/:id/send-email', requireRole(settlementRoles), async (req, res) => {
  try {
    const payload = await getSettlementPdfContext(req.params.id);
    if (!payload) return res.status(404).json({ error: 'Settlement not found' });

    const pdfPayload = {
      settlement: payload.settlement,
      driver: payload.driver,
      period: payload.period,
      primaryPayee: payload.primaryPayee,
      additionalPayee: payload.additionalPayee,
      loadItems: payload.loadItems,
      adjustmentItems: payload.adjustmentItems,
      truck: payload.truck,
      equipmentOwner: payload.equipmentOwner,
      operatingEntity: payload.operatingEntity,
      tenant: payload.tenant
    };
    const pdfBuffer = await buildSettlementPdf(pdfPayload);
    const fileName = getSettlementPdfFileName(pdfPayload);

    const emailResult = await sendSettlementEmailReport({
      payload: pdfPayload,
      options: req.body || {},
      pdfBuffer,
      fileName
    });

    if (!emailResult?.sent) {
      const status = emailResult?.reason === 'no_recipients'
        ? 400
        : emailResult?.error && String(emailResult.error).toLowerCase().includes('not configured')
          ? 503
          : 502;
      return res.status(status).json({
        success: false,
        error: emailResult?.error || 'Failed to send settlement email'
      });
    }

    res.json({
      success: true,
      message: 'Settlement email sent',
      recipients: emailResult.recipients || [],
      cc_recipients: emailResult.ccRecipients || [],
      file_name: fileName
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Imported expense sources (Phase 4) ----------
router.get('/imported-expense-sources', requireRole(settlementRoles), async (req, res) => {
  try {
    const rows = await knex('imported_expense_sources').orderBy('imported_at', 'desc').limit(100);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/imported-expense-sources', requireRole(settlementRoles), async (req, res) => {
  try {
    const { source_type, file_id, storage_key, parse_status, raw_metadata } = req.body;
    const [row] = await knex('imported_expense_sources')
      .insert({
        source_type: source_type || 'manual_upload',
        file_id: file_id ?? null,
        storage_key: storage_key ?? null,
        parse_status: parse_status ?? 'pending',
        raw_metadata: raw_metadata != null ? JSON.stringify(raw_metadata) : knex.raw("'{}'::jsonb"),
        imported_by: req.user?.id ?? null
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/imported-expense-items', requireRole(settlementRoles), async (req, res) => {
  try {
    const { source_id, status, matched_driver_id } = req.query;
    let q = knex('imported_expense_items').orderBy('transaction_date', 'desc').limit(200);
    if (source_id) q = q.where('imported_source_id', source_id);
    if (status) q = q.where('status', status);
    if (matched_driver_id) q = q.where('matched_driver_id', matched_driver_id);
    const rows = await q;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/imported-expense-items/:id/match', requireRole(settlementRoles), async (req, res) => {
  try {
    const { matched_driver_id, matched_payee_id, matched_vehicle_id, match_confidence } = req.body;
    const [row] = await knex('imported_expense_items')
      .where({ id: req.params.id })
      .update({
        matched_driver_id: matched_driver_id ?? null,
        matched_payee_id: matched_payee_id ?? null,
        matched_vehicle_id: matched_vehicle_id ?? null,
        match_confidence: match_confidence ?? null,
        status: 'matched',
        updated_at: knex.fn.now()
      })
      .returning('*');
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/imported-expense-items/:id/apply-to-settlement', requireRole(settlementRoles), async (req, res) => {
  try {
    const { settlement_id } = req.body;
    if (!settlement_id) return res.status(400).json({ error: 'settlement_id required' });
    const item = await knex('imported_expense_items').where({ id: req.params.id }).first();
    if (!item) return res.status(404).json({ error: 'Expense item not found' });
    const result = await applyVariableExpenseToSettlement(knex, settlement_id, {
      expenseType: 'fuel',
      amount: Number(item.amount) || 0,
      description: item.description || 'Imported expense',
      occurrenceDate: item.transaction_date,
      userId: req.user?.id ?? null,
      sourceType: 'imported_fuel',
      sourceReferenceId: item.id,
      sourceReferenceType: 'imported_expense_item'
    });

    const adj = result.primaryAdjustment || result.mirroredAdjustment;
    if (!adj) {
      return res.status(409).json({ error: 'Imported expense is not billable to driver or equipment owner under the current responsibility profile' });
    }

    await knex('imported_expense_items').where({ id: req.params.id }).update({
      settlement_adjustment_item_id: adj.id,
      status: 'applied',
      updated_at: knex.fn.now()
    });
    await recalcAndUpdateSettlement(knex, result.primarySettlementId);
    if (result.mirroredAdjustment) {
      const mirroredSettlement = await knex('settlement_adjustment_items').where({ id: result.mirroredAdjustment.id }).first();
      if (mirroredSettlement?.settlement_id && mirroredSettlement.settlement_id !== result.primarySettlementId) {
        await recalcAndUpdateSettlement(knex, mirroredSettlement.settlement_id);
      }
    }
    res.json(adj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================================
// Settlement Engine V2 — FN-499
// ==========================================================================
const {
  generateDualSettlements,
  createBalanceTransfer,
  approveBalanceTransfer,
  rejectBalanceTransfer,
  listBalanceTransfers
} = require('../services/settlement-engine-v2');

/**
 * POST /generate-dual
 * Generate Driver + EO settlements for a driver in a payroll period.
 * Body: { payroll_period_id, driver_id, date_basis? }
 */
router.post('/generate-dual', requireRole(settlementRoles), async (req, res) => {
  try {
    const { payroll_period_id, driver_id, date_basis = 'pickup' } = req.body;
    if (!payroll_period_id) return res.status(400).json({ error: 'payroll_period_id is required' });
    if (!driver_id) return res.status(400).json({ error: 'driver_id is required' });

    const context = {
      tenantId: req.context?.tenantId,
      operatingEntityId: req.context?.operatingEntityId
    };

    const result = await generateDualSettlements(
      payroll_period_id,
      driver_id,
      date_basis,
      req.user?.id,
      knex,
      context
    );

    res.status(201).json({
      success: true,
      driverSettlement: result.driverSettlement,
      eoSettlement: result.eoSettlement
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /balance-transfers
 * List balance transfers. Query: status, target_equipment_owner_id, source_driver_id
 */
router.get('/balance-transfers', requireRole(settlementRoles), async (req, res) => {
  try {
    const context = {
      tenantId: req.context?.tenantId,
      operatingEntityId: req.context?.operatingEntityId
    };
    const filters = {
      status: req.query.status || null,
      targetEquipmentOwnerId: req.query.target_equipment_owner_id || null,
      sourceDriverId: req.query.source_driver_id || null
    };
    const rows = await listBalanceTransfers(filters, knex, context);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /balance-transfers
 * Create a pending balance transfer.
 * Body: { source_driver_id, source_settlement_id, target_equipment_owner_id, amount, reason }
 */
router.post('/balance-transfers', requireRole(settlementRoles), async (req, res) => {
  try {
    const context = {
      tenantId: req.context?.tenantId,
      operatingEntityId: req.context?.operatingEntityId
    };
    const transfer = await createBalanceTransfer(req.body, req.user?.id, knex, context);
    res.status(201).json(transfer);
  } catch (err) {
    res.status(err.message.includes('required') || err.message.includes('must') ? 400 : 500)
      .json({ error: err.message });
  }
});

/**
 * PATCH /balance-transfers/:id/approve
 * Approve a pending balance transfer.
 * Body: { review_notes? }
 */
router.patch('/balance-transfers/:id/approve', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const context = {
      tenantId: req.context?.tenantId,
      operatingEntityId: req.context?.operatingEntityId
    };
    const updated = await approveBalanceTransfer(
      req.params.id,
      req.user?.id,
      req.body?.review_notes || null,
      knex,
      context
    );
    res.json(updated);
  } catch (err) {
    const status = err.message.includes('not found') ? 404
      : err.message.includes('Cannot') ? 422
        : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * PATCH /balance-transfers/:id/reject
 * Reject a pending or approved balance transfer.
 * Body: { review_notes? }
 */
router.patch('/balance-transfers/:id/reject', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const context = {
      tenantId: req.context?.tenantId,
      operatingEntityId: req.context?.operatingEntityId
    };
    const updated = await rejectBalanceTransfer(
      req.params.id,
      req.user?.id,
      req.body?.review_notes || null,
      knex,
      context
    );
    res.json(updated);
  } catch (err) {
    const status = err.message.includes('not found') ? 404
      : err.message.includes('Cannot') ? 422
        : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
