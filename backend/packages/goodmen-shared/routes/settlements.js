/**
 * Payroll / Settlement APIs: payees, compensation profiles, payee assignments,
 * expense responsibility, recurring deductions, payroll periods, settlements,
 * settlement load items, adjustment items, PDF payload, email.
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
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

async function lookupZipLatLon(zip) {
  const trimmed = (zip || '').toString().trim();
  if (!trimmed) return null;
  try {
    const response = await axios.get(`https://api.zippopotam.us/us/${encodeURIComponent(trimmed)}`);
    const place = response.data?.places?.[0];
    if (!place) return null;
    const lat = parseFloat(place.latitude);
    const lon = parseFloat(place.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    return { lat, lon };
  } catch (_err) {
    return null;
  }
}

async function getDrivingDistanceMiles(fromZip, toZip) {
  const from = await lookupZipLatLon(fromZip);
  const to = await lookupZipLatLon(toZip);
  if (!from || !to) return 0;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const response = await axios.get(url);
    const meters = response.data?.routes?.[0]?.distance;
    if (typeof meters !== 'number' || meters <= 0) return 0;
    return Math.round(meters / 1609.34);
  } catch (_err) {
    return 0;
  }
}

async function hydrateSettlementLoadTripMetrics(loadItems) {
  const items = Array.isArray(loadItems) ? loadItems : [];
  if (!items.length) return items;

  return Promise.all(items.map(async (item) => {
    if (item?.empty_miles !== null && item?.empty_miles !== undefined && item?.empty_miles !== '') {
      return item;
    }

    const pickupZip = (item?.pickup_zip || '').toString().trim();
    const prevZip = (item?.prev_delivery_zip || '').toString().trim();
    const emptyMiles = pickupZip && prevZip && pickupZip !== prevZip
      ? await getDrivingDistanceMiles(prevZip, pickupZip)
      : 0;

    return {
      ...item,
      empty_miles: emptyMiles
    };
  }));
}

async function getSettlementPdfContext(settlementId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) return null;

  const rawLoadItems = await knex('settlement_load_items as sli')
    .join('loads as l', 'l.id', 'sli.load_id')
    .where('sli.settlement_id', settlementId)
    .select(
      'sli.*',
      'l.load_number',
      'l.pickup_location',
      'l.delivery_location',
      'sli.loaded_miles',
      knex.raw(`(
        SELECT ls.zip
        FROM load_stops ls
        WHERE ls.load_id = l.id
          AND ls.stop_type = 'PICKUP'
        ORDER BY COALESCE(ls.sequence, 999999) ASC, ls.created_at ASC
        LIMIT 1
      ) as pickup_zip`),
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
      ) as delivery_state`),
      knex.raw(`(
        SELECT ls.zip
        FROM load_stops ls
        WHERE ls.load_id = l.id
          AND ls.stop_type = 'DELIVERY'
        ORDER BY COALESCE(ls.sequence, -1) DESC, ls.created_at DESC
        LIMIT 1
      ) as delivery_zip`),
      knex.raw(`(
        SELECT prev_stop.zip
        FROM loads prev_load
        JOIN load_stops prev_stop ON prev_stop.load_id = prev_load.id
        WHERE prev_load.driver_id = l.driver_id
          AND prev_load.id <> l.id
          AND prev_stop.stop_type = 'DELIVERY'
          AND COALESCE(prev_stop.stop_date, prev_load.completed_date, prev_load.created_at) <=
              COALESCE(sli.pickup_date, l.created_at)
        ORDER BY COALESCE(prev_stop.stop_date, prev_load.completed_date, prev_load.created_at) DESC,
                 prev_load.created_at DESC
        LIMIT 1
      ) as prev_delivery_zip`)
    );

  const loadItems = await hydrateSettlementLoadTripMetrics(rawLoadItems);

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

/**
 * @openapi
 * /api/settlements:
 *   get:
 *     summary: Settlements API root
 *     description: Returns available sub-resource links for the Settlements API.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: API discovery links
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 links:
 *                   type: object
 *                   properties:
 *                     payees:
 *                       type: string
 *                     payrollPeriods:
 *                       type: string
 *                     settlements:
 *                       type: string
 *                     recurringDeductions:
 *                       type: string
 *       403:
 *         description: Forbidden — insufficient role
 */
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
/**
 * @openapi
 * /api/settlements/payees:
 *   get:
 *     summary: List payees
 *     description: Returns payees for the current tenant, optionally filtered by type, active status, or search term.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [driver, company, owner, external_company, contractor]
 *         description: Filter by payee type. "equipment_owner" is normalized to "owner".
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive name search (ILIKE).
 *       - in: query
 *         name: is_active
 *         schema:
 *           type: boolean
 *         description: Filter by active status.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *         description: Maximum number of rows to return.
 *     responses:
 *       200:
 *         description: Array of payee objects with display_type included.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/payees/search:
 *   get:
 *     summary: Search payees
 *     description: |
 *       Search payees by name, email, or phone for use in Payable To / Additional Payee dropdowns.
 *       Results are filtered by role context (primary vs additional payee).
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search term (matches name, email, or phone via ILIKE). Alias "search" is also accepted.
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [primary, additional, all]
 *           default: all
 *         description: |
 *           Restricts which payee types are returned.
 *           "additional" limits to owner, external_company, contractor.
 *       - in: query
 *         name: include_inactive
 *         schema:
 *           type: boolean
 *           default: false
 *         description: When true, includes inactive payees in results.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Array of matching payee objects with display_type.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/payees:
 *   post:
 *     summary: Create a payee
 *     description: Creates a new payee record for the current tenant. Extended address and vendor fields are persisted when the underlying DB columns exist.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [driver, company, owner, external_company, contractor]
 *                 description: Payee type. "equipment_owner" is normalized to "owner". Defaults to "driver".
 *               name:
 *                 type: string
 *               contact_id:
 *                 type: string
 *                 nullable: true
 *               email:
 *                 type: string
 *                 nullable: true
 *               phone:
 *                 type: string
 *                 nullable: true
 *               is_active:
 *                 type: boolean
 *                 default: true
 *               address:
 *                 type: string
 *                 nullable: true
 *               address_line_2:
 *                 type: string
 *                 nullable: true
 *               city:
 *                 type: string
 *                 nullable: true
 *               state:
 *                 type: string
 *                 nullable: true
 *               zip:
 *                 type: string
 *                 nullable: true
 *               fid_ein:
 *                 type: string
 *                 nullable: true
 *               mc:
 *                 type: string
 *                 nullable: true
 *               notes:
 *                 type: string
 *                 nullable: true
 *               vendor_type:
 *                 type: string
 *                 nullable: true
 *               is_additional_payee:
 *                 type: boolean
 *               is_equipment_owner:
 *                 type: boolean
 *               additional_payee_rate:
 *                 type: number
 *                 nullable: true
 *               settlement_template_type:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Created payee object with display_type.
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/payees/equipment-owner:
 *   post:
 *     summary: Create or retrieve an equipment-owner payee
 *     description: |
 *       Atomically finds an existing equipment-owner payee by name (case-insensitive)
 *       or creates a new one. Used by the Driver Edit UI to ensure an owner payee exists.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Equipment owner name (required, used for deduplication).
 *               email:
 *                 type: string
 *                 nullable: true
 *               phone:
 *                 type: string
 *                 nullable: true
 *               address:
 *                 type: string
 *                 nullable: true
 *               address_line_2:
 *                 type: string
 *                 nullable: true
 *               city:
 *                 type: string
 *                 nullable: true
 *               state:
 *                 type: string
 *                 nullable: true
 *               zip:
 *                 type: string
 *                 nullable: true
 *               fid_ein:
 *                 type: string
 *                 nullable: true
 *               mc:
 *                 type: string
 *                 nullable: true
 *               notes:
 *                 type: string
 *                 nullable: true
 *               vendor_type:
 *                 type: string
 *                 nullable: true
 *               additional_payee_rate:
 *                 type: number
 *                 nullable: true
 *               settlement_template_type:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Created or existing payee object with display_type.
 *       400:
 *         description: Validation error — name is required.
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/payees/{id}:
 *   get:
 *     summary: Get a payee by ID
 *     description: Returns a single payee record for the current tenant.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Payee ID.
 *     responses:
 *       200:
 *         description: Payee object.
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       404:
 *         description: Payee not found.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/payees/{id}:
 *   put:
 *     summary: Update a payee
 *     description: Partially updates a payee record. Only supplied fields are changed.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Payee ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [driver, company, owner, external_company, contractor]
 *               name:
 *                 type: string
 *               contact_id:
 *                 type: string
 *                 nullable: true
 *               email:
 *                 type: string
 *                 nullable: true
 *               phone:
 *                 type: string
 *                 nullable: true
 *               is_active:
 *                 type: boolean
 *               address:
 *                 type: string
 *                 nullable: true
 *               address_line_2:
 *                 type: string
 *                 nullable: true
 *               city:
 *                 type: string
 *                 nullable: true
 *               state:
 *                 type: string
 *                 nullable: true
 *               zip:
 *                 type: string
 *                 nullable: true
 *               fid_ein:
 *                 type: string
 *                 nullable: true
 *               mc:
 *                 type: string
 *                 nullable: true
 *               notes:
 *                 type: string
 *                 nullable: true
 *               vendor_type:
 *                 type: string
 *                 nullable: true
 *               is_additional_payee:
 *                 type: boolean
 *               is_equipment_owner:
 *                 type: boolean
 *               additional_payee_rate:
 *                 type: number
 *                 nullable: true
 *               settlement_template_type:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Updated payee object with display_type.
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       404:
 *         description: Payee not found.
 *       500:
 *         description: Internal server error.
 */
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
/**
 * @openapi
 * /api/settlements/drivers/{driverId}/compensation-profile:
 *   get:
 *     summary: Get active compensation profile for a driver
 *     description: Returns the currently active compensation profile for the given driver as of the requested date.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver ID.
 *       - in: query
 *         name: asOf
 *         schema:
 *           type: string
 *           format: date
 *         description: Date to evaluate the active profile against. Defaults to today.
 *     responses:
 *       200:
 *         description: Active compensation profile object.
 *       404:
 *         description: No active compensation profile found.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/drivers/{driverId}/compensation-profiles:
 *   get:
 *     summary: List all compensation profiles for a driver
 *     description: Returns every compensation profile for the driver, sorted by effective_start_date descending.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver ID.
 *     responses:
 *       200:
 *         description: Array of compensation profile objects.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/drivers/{driverId}/compensation-profiles:
 *   post:
 *     summary: Create a compensation profile
 *     description: |
 *       Creates a new compensation profile for the driver. Validates that
 *       equipment_owner_percentage + percentage_rate does not exceed 100.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profile_type:
 *                 type: string
 *                 default: driver
 *               pay_model:
 *                 type: string
 *                 enum: [per_mile, percentage, flat_weekly, flat_per_load]
 *                 default: per_mile
 *               percentage_rate:
 *                 type: number
 *                 nullable: true
 *               cents_per_mile:
 *                 type: number
 *                 nullable: true
 *               flat_weekly_amount:
 *                 type: number
 *                 nullable: true
 *               flat_per_load_amount:
 *                 type: number
 *                 nullable: true
 *               equipment_owner_percentage:
 *                 type: number
 *                 nullable: true
 *                 description: Must be 0-100 and sum with percentage_rate must not exceed 100.
 *               expense_sharing_enabled:
 *                 type: boolean
 *                 default: false
 *               effective_start_date:
 *                 type: string
 *                 format: date
 *               effective_end_date:
 *                 type: string
 *                 format: date
 *                 nullable: true
 *               status:
 *                 type: string
 *                 default: active
 *               notes:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Created compensation profile object.
 *       400:
 *         description: Validation error (e.g. percentage sum exceeds 100).
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/compensation-profiles/{id}:
 *   put:
 *     summary: Update a compensation profile
 *     description: |
 *       Partially updates a compensation profile. Only supplied fields are changed.
 *       Validates equipment_owner_percentage + percentage_rate does not exceed 100.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Compensation profile ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profile_type:
 *                 type: string
 *               pay_model:
 *                 type: string
 *                 enum: [per_mile, percentage, flat_weekly, flat_per_load]
 *               percentage_rate:
 *                 type: number
 *                 nullable: true
 *               cents_per_mile:
 *                 type: number
 *                 nullable: true
 *               flat_weekly_amount:
 *                 type: number
 *                 nullable: true
 *               flat_per_load_amount:
 *                 type: number
 *                 nullable: true
 *               equipment_owner_percentage:
 *                 type: number
 *                 nullable: true
 *               expense_sharing_enabled:
 *                 type: boolean
 *               effective_start_date:
 *                 type: string
 *                 format: date
 *               effective_end_date:
 *                 type: string
 *                 format: date
 *                 nullable: true
 *               status:
 *                 type: string
 *               notes:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Updated compensation profile object.
 *       400:
 *         description: Validation error (e.g. percentage sum exceeds 100).
 *       404:
 *         description: Profile not found.
 *       500:
 *         description: Internal server error.
 */
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
/**
 * @openapi
 * /api/settlements/drivers/{driverId}/payee-assignment:
 *   get:
 *     summary: Get active payee assignment for a driver
 *     description: Returns the active payee assignment for the driver as of the given date, including resolved primary and additional payee details.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver ID.
 *       - in: query
 *         name: asOf
 *         schema:
 *           type: string
 *           format: date
 *         description: Date to evaluate the active assignment against. Defaults to today.
 *     responses:
 *       200:
 *         description: Assignment with resolved payee details.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assignment:
 *                   type: object
 *                 primary_payee:
 *                   type: object
 *                   nullable: true
 *                 additional_payee:
 *                   type: object
 *                   nullable: true
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       404:
 *         description: No active payee assignment found.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/drivers/{driverId}/payee-assignments:
 *   post:
 *     summary: Create a payee assignment
 *     description: |
 *       Creates a new payee assignment for the driver. Any existing open assignment
 *       is automatically end-dated to the new assignment's start date.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               primary_payee_id:
 *                 type: string
 *                 format: uuid
 *               additional_payee_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               rule_type:
 *                 type: string
 *                 default: custom
 *               effective_start_date:
 *                 type: string
 *                 format: date
 *               effective_end_date:
 *                 type: string
 *                 format: date
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Created payee assignment object.
 *       400:
 *         description: Validation error — payee does not belong to tenant.
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/drivers/{driverId}/payee-assignment/resolve:
 *   post:
 *     summary: Resolve and upsert payee assignment
 *     description: |
 *       Upsert-like helper for the Driver Edit page. Accepts payee IDs or names;
 *       creates missing equipment-owner payees on the fly. End-dates any existing
 *       open assignment before inserting the new one.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               primary_payee_id:
 *                 type: string
 *                 format: uuid
 *                 description: Existing payee ID (takes precedence over name).
 *               primary_payee_name:
 *                 type: string
 *                 description: Name used to find-or-create the primary payee.
 *               primary_payee_type:
 *                 type: string
 *                 default: driver
 *               additional_payee_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               additional_payee_name:
 *                 type: string
 *                 nullable: true
 *               additional_payee_type:
 *                 type: string
 *                 default: owner
 *               rule_type:
 *                 type: string
 *                 default: custom
 *               effective_start_date:
 *                 type: string
 *                 format: date
 *               effective_end_date:
 *                 type: string
 *                 format: date
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Created assignment with resolved primary and additional payee objects.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assignment:
 *                   type: object
 *                 primary_payee:
 *                   type: object
 *                 additional_payee:
 *                   type: object
 *                   nullable: true
 *       400:
 *         description: Primary payable-to is required.
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       500:
 *         description: Internal server error.
 */
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
/**
 * @openapi
 * /api/settlements/drivers/{driverId}/expense-responsibility:
 *   get:
 *     summary: Get active expense responsibility profile
 *     description: Returns the active expense responsibility profile for the driver as of the given date. Uses deterministic ordering (effective_start_date desc, created_at desc) when multiple rows share the same start date.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver ID.
 *       - in: query
 *         name: asOf
 *         schema:
 *           type: string
 *           format: date
 *         description: Date to evaluate against. Defaults to today.
 *     responses:
 *       200:
 *         description: Expense responsibility profile object, or null if none found.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/drivers/{driverId}/expense-responsibility:
 *   post:
 *     summary: Create an expense responsibility profile
 *     description: |
 *       Creates a new expense responsibility profile for the driver. Automatically
 *       end-dates any existing open profile. Resolves the active compensation profile
 *       if compensation_profile_id is not provided.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               compensation_profile_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: If omitted, the active compensation profile is resolved automatically.
 *               fuel_responsibility:
 *                 type: string
 *                 nullable: true
 *               insurance_responsibility:
 *                 type: string
 *                 nullable: true
 *               eld_responsibility:
 *                 type: string
 *                 nullable: true
 *               trailer_rent_responsibility:
 *                 type: string
 *                 nullable: true
 *               toll_responsibility:
 *                 type: string
 *                 nullable: true
 *               repairs_responsibility:
 *                 type: string
 *                 nullable: true
 *               split_type:
 *                 type: string
 *                 nullable: true
 *               driver_percentage:
 *                 type: number
 *                 nullable: true
 *               driver_fixed_amount:
 *                 type: number
 *                 nullable: true
 *               owner_fixed_amount:
 *                 type: number
 *                 nullable: true
 *               custom_rules:
 *                 type: object
 *                 nullable: true
 *               effective_start_date:
 *                 type: string
 *                 format: date
 *               effective_end_date:
 *                 type: string
 *                 format: date
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Created expense responsibility profile object.
 *       500:
 *         description: Internal server error.
 */
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
/**
 * @openapi
 * /api/settlements/recurring-deductions:
 *   get:
 *     summary: List recurring deduction rules
 *     description: Returns recurring deduction rules for the tenant, optionally filtered by driver, payee(s), or enabled status. Includes joined driver and payee names.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: driver_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by driver ID.
 *       - in: query
 *         name: payee_id
 *         schema:
 *           type: string
 *         description: Filter by payee ID (single value or comma-separated).
 *       - in: query
 *         name: payee_ids
 *         schema:
 *           type: string
 *         description: Filter by multiple payee IDs (comma-separated).
 *       - in: query
 *         name: enabled
 *         schema:
 *           type: boolean
 *         description: Filter by enabled status.
 *     responses:
 *       200:
 *         description: Array of recurring deduction rule objects with driver_name, payee_name, and payee_type.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/recurring-deductions:
 *   post:
 *     summary: Create a recurring deduction rule
 *     description: |
 *       Creates a new recurring deduction rule. When expense_responsibility is "shared",
 *       split_type is required and driver_share + owner_share must sum correctly
 *       (100% for percentage, total amount for fixed_amount).
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               payee_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               equipment_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               rule_scope:
 *                 type: string
 *                 default: driver
 *               description:
 *                 type: string
 *                 nullable: true
 *               amount_type:
 *                 type: string
 *                 enum: [fixed, percentage]
 *                 default: fixed
 *               amount:
 *                 type: number
 *                 default: 0
 *               frequency:
 *                 type: string
 *                 enum: [weekly, biweekly, monthly, per_settlement]
 *                 default: weekly
 *               start_date:
 *                 type: string
 *                 format: date
 *               end_date:
 *                 type: string
 *                 format: date
 *                 nullable: true
 *               source_type:
 *                 type: string
 *                 nullable: true
 *               applies_when:
 *                 type: string
 *                 default: always
 *               expense_responsibility:
 *                 type: string
 *                 nullable: true
 *                 description: Set to "shared" to enable split fields.
 *               split_type:
 *                 type: string
 *                 nullable: true
 *                 description: Required when expense_responsibility is "shared".
 *               driver_share:
 *                 type: number
 *                 nullable: true
 *               owner_share:
 *                 type: number
 *                 nullable: true
 *               enabled:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Created recurring deduction rule object.
 *       400:
 *         description: Validation error (e.g. split_type required, splits do not sum correctly).
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/recurring-deductions/{id}:
 *   patch:
 *     summary: Update a recurring deduction rule
 *     description: |
 *       Partially updates a recurring deduction rule. Only supplied fields are changed.
 *       Validates sharing splits when expense_responsibility is "shared".
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Recurring deduction rule ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               payee_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               equipment_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               rule_scope:
 *                 type: string
 *               description:
 *                 type: string
 *                 nullable: true
 *               amount_type:
 *                 type: string
 *               amount:
 *                 type: number
 *               frequency:
 *                 type: string
 *               start_date:
 *                 type: string
 *                 format: date
 *               end_date:
 *                 type: string
 *                 format: date
 *                 nullable: true
 *               source_type:
 *                 type: string
 *                 nullable: true
 *               applies_when:
 *                 type: string
 *               expense_responsibility:
 *                 type: string
 *                 nullable: true
 *               split_type:
 *                 type: string
 *                 nullable: true
 *               driver_share:
 *                 type: number
 *                 nullable: true
 *               owner_share:
 *                 type: number
 *                 nullable: true
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated recurring deduction rule object.
 *       400:
 *         description: Validation error (e.g. splits do not sum correctly).
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       404:
 *         description: Not found.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/recurring-deductions/{id}:
 *   delete:
 *     summary: Delete a recurring deduction rule
 *     description: Permanently removes a recurring deduction rule for the current tenant.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Recurring deduction rule ID.
 *     responses:
 *       200:
 *         description: Deletion confirmation.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       403:
 *         description: Forbidden — tenant context missing or insufficient role.
 *       404:
 *         description: Not found.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/recurring-deductions/backfill:
 *   post:
 *     summary: Backfill recurring deductions onto settlements
 *     description: |
 *       Re-applies recurring deduction rules to settlements within a date range.
 *       Supports dry_run mode to preview affected settlements without making changes.
 *       By default, locked settlements (approved/paid/void) are excluded.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [start_date, end_date]
 *             properties:
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional driver filter.
 *               start_date:
 *                 type: string
 *                 format: date
 *               end_date:
 *                 type: string
 *                 format: date
 *               include_locked:
 *                 type: boolean
 *                 default: false
 *                 description: When true, includes approved/paid/void settlements.
 *               dry_run:
 *                 type: boolean
 *                 default: false
 *                 description: When true, returns matched settlements without updating them.
 *               limit:
 *                 type: integer
 *                 default: 500
 *                 maximum: 2000
 *     responses:
 *       200:
 *         description: Backfill results.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mode:
 *                   type: string
 *                   enum: [dry_run, execute]
 *                 filters:
 *                   type: object
 *                 matched_count:
 *                   type: integer
 *                 updated_count:
 *                   type: integer
 *                 settlements_with_scheduled_deductions:
 *                   type: integer
 *                 scheduled_deduction_row_count:
 *                   type: integer
 *                 failed_count:
 *                   type: integer
 *                 updated_settlement_ids:
 *                   type: array
 *                   items:
 *                     type: string
 *                 failures:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       error:
 *                         type: string
 *       400:
 *         description: start_date and end_date are required.
 *       500:
 *         description: Internal server error.
 */
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
/**
 * @openapi
 * /api/settlements/payroll-periods:
 *   get:
 *     summary: List payroll periods
 *     description: Returns payroll periods for the current tenant/operating entity, optionally filtered by status.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, open, closed]
 *         description: Filter by period status.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Array of payroll period objects sorted by period_start descending.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/payroll-periods:
 *   post:
 *     summary: Create a payroll period
 *     description: Creates a new payroll period in draft status. Requires operating entity context.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               period_start:
 *                 type: string
 *                 format: date
 *               period_end:
 *                 type: string
 *                 format: date
 *               run_type:
 *                 type: string
 *                 enum: [weekly, biweekly, monthly]
 *                 default: weekly
 *     responses:
 *       201:
 *         description: Created payroll period object.
 *       403:
 *         description: Operating entity context is required.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/payroll-periods/{id}:
 *   patch:
 *     summary: Update a payroll period status
 *     description: Updates the status of a payroll period (e.g. draft, open, closed).
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Payroll period ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [draft, open, closed]
 *     responses:
 *       200:
 *         description: Updated payroll period object.
 *       404:
 *         description: Period not found.
 *       500:
 *         description: Internal server error.
 */
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
/**
 * @openapi
 * /api/settlements/eligible-loads:
 *   get:
 *     summary: List eligible loads for a settlement
 *     description: Returns loads eligible for inclusion in a settlement for a given driver and payroll period date range.
 *     tags: [Settlements]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: driver_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: period_start
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: period_end
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: date_basis
 *         schema:
 *           type: string
 *           enum: [pickup, delivery]
 *           default: pickup
 *         description: Which date on the load determines period eligibility.
 *     responses:
 *       200:
 *         description: Array of eligible load objects.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       400:
 *         description: driver_id, period_start, period_end required.
 *       500:
 *         description: Internal server error.
 */
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

/**
 * @openapi
 * /api/settlements/settlements/{id}/recalc:
 *   post:
 *     summary: Recalculate settlement totals
 *     description: Recalculates all line items and totals for a settlement. Settlement lifecycle states are preparing → ready_for_review → approved → paid → void.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Recalculated settlement
 *       400:
 *         description: Bad request
 */
router.post('/settlements/:id/recalc', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await recalcAndUpdateSettlement(knex, req.params.id);
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/settlements/settlements/{id}/loads:
 *   post:
 *     summary: Add a load to a settlement
 *     description: Adds a load item to a settlement in preparation.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - load_id
 *             properties:
 *               load_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Updated settlement
 *       400:
 *         description: Missing load_id or bad request
 */
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

/**
 * @openapi
 * /api/settlements/settlements/{id}/loads/{loadItemId}:
 *   delete:
 *     summary: Remove a load from a settlement
 *     description: Removes a load item from a settlement.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: loadItemId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Updated settlement
 *       400:
 *         description: Bad request
 */
router.delete('/settlements/:id/loads/:loadItemId', requireRole(settlementRoles), async (req, res) => {
  try {
    await removeLoadFromSettlement(knex, req.params.id, req.params.loadItemId);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/settlements/settlements/{id}/adjustments:
 *   post:
 *     summary: Add an adjustment to a settlement
 *     description: Adds a manual adjustment (deduction or addition) to a settlement.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated settlement
 *       400:
 *         description: Bad request
 */
router.post('/settlements/:id/adjustments', requireRole(settlementRoles), async (req, res) => {
  try {
    await addAdjustment(knex, req.params.id, req.body, req.user?.id ?? null);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/settlements/settlements/{id}/adjustments/{adjustmentId}:
 *   delete:
 *     summary: Remove an adjustment from a settlement
 *     description: Soft-deletes an adjustment item from a settlement.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: adjustmentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Updated settlement
 *       400:
 *         description: Bad request
 */
router.delete('/settlements/:id/adjustments/:adjustmentId', requireRole(settlementRoles), async (req, res) => {
  try {
    await removeAdjustment(knex, req.params.id, req.params.adjustmentId);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/settlements/settlements/{id}/adjustments/{adjustmentId}/restore:
 *   post:
 *     summary: Restore a deleted scheduled adjustment
 *     description: Restores a previously removed scheduled adjustment to a settlement.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: adjustmentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Updated settlement
 *       400:
 *         description: Bad request
 */
router.post('/settlements/:id/adjustments/:adjustmentId/restore', requireRole(settlementRoles), async (req, res) => {
  try {
    await restoreScheduledAdjustment(knex, req.params.id, req.params.adjustmentId);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/settlements/settlements/{id}/approve:
 *   post:
 *     summary: Approve a settlement
 *     description: Transitions a settlement from ready_for_review to approved. Settlement lifecycle&#58; preparing → ready_for_review → approved → paid → void.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Approved settlement
 *       400:
 *         description: Invalid state transition
 */
router.post('/settlements/:id/approve', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await approveSettlement(knex, req.params.id, req.user?.id ?? null);
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/settlements/settlements/{id}/void:
 *   post:
 *     summary: Void a settlement
 *     description: Voids a settlement, making it inactive. Settlement lifecycle&#58; preparing → ready_for_review → approved → paid → void.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Voided settlement
 *       400:
 *         description: Invalid state transition
 */
router.post('/settlements/:id/void', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await voidSettlement(knex, req.params.id);
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/settlements/settlements/{id}/pdf-payload:
 *   get:
 *     summary: Get settlement PDF payload
 *     description: Returns the full data context needed to render a settlement PDF, including driver, payees, truck, operating entity, and line items.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: PDF payload data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settlement:
 *                   type: object
 *                 driver:
 *                   type: object
 *                 primary_payee:
 *                   type: object
 *                 additional_payee:
 *                   type: object
 *                   nullable: true
 *                 truck:
 *                   type: object
 *                   nullable: true
 *                 equipment_owner:
 *                   type: object
 *                   nullable: true
 *                 operating_entity:
 *                   type: object
 *                   nullable: true
 *                 tenant:
 *                   type: object
 *                   nullable: true
 *                 period:
 *                   type: object
 *                 load_items:
 *                   type: array
 *                   items:
 *                     type: object
 *                 adjustment_items:
 *                   type: array
 *                   items:
 *                     type: object
 *       404:
 *         description: Settlement not found
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/settlements/settlements/{id}/pdf/generate:
 *   post:
 *     summary: Generate settlement PDF
 *     description: Generates a PDF for a settlement, uploads it to cloud storage, and returns a signed download URL.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Generated PDF details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 settlement_id:
 *                   type: string
 *                   format: uuid
 *                 settlement_number_display:
 *                   type: string
 *                 storage_key:
 *                   type: string
 *                 file_name:
 *                   type: string
 *                 download_url:
 *                   type: string
 *       404:
 *         description: Settlement not found
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/settlements/settlements/{id}/pdf:
 *   get:
 *     summary: Download settlement PDF
 *     description: Generates and streams a settlement PDF as an attachment.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: PDF file stream
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Settlement not found
 *       500:
 *         description: Server error
 */
router.get('/settlements/:id/pdf', requireRole(settlementRoles), async (req, res) => {
  try {
    return await sendSettlementPdfDownload(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to download settlement PDF' });
  }
});

/**
 * @openapi
 * /api/settlements/settlements/{id}/pdf/download:
 *   get:
 *     summary: Download settlement PDF (legacy)
 *     description: Legacy endpoint — streams the settlement PDF as an attachment. Same behavior as GET /settlements/{id}/pdf.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: PDF file stream
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Settlement not found
 *       500:
 *         description: Server error
 */
router.get('/settlements/:id/pdf/download', requireRole(settlementRoles), async (req, res) => {
  try {
    return await sendSettlementPdfDownload(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to download settlement PDF' });
  }
});

/**
 * @openapi
 * /api/settlements/settlements/{id}/send-email:
 *   post:
 *     summary: Send settlement email
 *     description: Generates a PDF and emails the settlement report to configured recipients.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Optional email options (recipients, cc, subject overrides)
 *     responses:
 *       200:
 *         description: Email sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 recipients:
 *                   type: array
 *                   items:
 *                     type: string
 *                 cc_recipients:
 *                   type: array
 *                   items:
 *                     type: string
 *                 file_name:
 *                   type: string
 *       400:
 *         description: No recipients
 *       404:
 *         description: Settlement not found
 *       502:
 *         description: Email send failure
 *       503:
 *         description: Email not configured
 */
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

/**
 * @openapi
 * /api/settlements/imported-expense-sources:
 *   get:
 *     summary: List imported expense sources
 *     description: Returns the most recent 100 imported expense sources (file uploads, integrations, etc.).
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of imported expense sources
 *       500:
 *         description: Server error
 */
router.get('/imported-expense-sources', requireRole(settlementRoles), async (req, res) => {
  try {
    const rows = await knex('imported_expense_sources').orderBy('imported_at', 'desc').limit(100);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/settlements/imported-expense-sources:
 *   post:
 *     summary: Create an imported expense source
 *     description: Registers a new expense source (e.g. a file upload or integration batch).
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               source_type:
 *                 type: string
 *                 default: manual_upload
 *               file_id:
 *                 type: string
 *                 nullable: true
 *               storage_key:
 *                 type: string
 *                 nullable: true
 *               parse_status:
 *                 type: string
 *                 default: pending
 *               raw_metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Created expense source
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/settlements/imported-expense-items:
 *   get:
 *     summary: List imported expense items
 *     description: Returns imported expense items, optionally filtered by source, status, or matched driver.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: source_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: matched_driver_id
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Array of imported expense items
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/settlements/imported-expense-items/{id}/match:
 *   patch:
 *     summary: Match an imported expense item
 *     description: Associates an imported expense item with a driver, payee, or vehicle.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               matched_driver_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               matched_payee_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               matched_vehicle_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               match_confidence:
 *                 type: number
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Updated expense item
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/settlements/imported-expense-items/{id}/apply-to-settlement:
 *   post:
 *     summary: Apply imported expense to a settlement
 *     description: Converts an imported expense item into a settlement adjustment and links it to the target settlement. Recalculates settlement totals after application.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - settlement_id
 *             properties:
 *               settlement_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Created adjustment
 *       400:
 *         description: Missing settlement_id
 *       404:
 *         description: Expense item not found
 *       409:
 *         description: Expense not billable under current responsibility profile
 *       500:
 *         description: Server error
 */
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
 * @openapi
 * /api/settlements/generate-dual:
 *   post:
 *     summary: Generate dual settlements (driver + equipment owner)
 *     description: Creates both a driver settlement and an equipment-owner settlement for a given driver in a payroll period. Part of Settlement Engine V2.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - payroll_period_id
 *               - driver_id
 *             properties:
 *               payroll_period_id:
 *                 type: string
 *                 format: uuid
 *               driver_id:
 *                 type: string
 *                 format: uuid
 *               date_basis:
 *                 type: string
 *                 default: pickup
 *     responses:
 *       201:
 *         description: Dual settlements created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 driverSettlement:
 *                   type: object
 *                 eoSettlement:
 *                   type: object
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/settlements/balance-transfers:
 *   get:
 *     summary: List balance transfers
 *     description: Returns balance transfers, optionally filtered by status, target equipment owner, or source driver.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: target_equipment_owner_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: source_driver_id
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Array of balance transfers
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/settlements/balance-transfers:
 *   post:
 *     summary: Create a balance transfer
 *     description: Creates a new pending balance transfer between a driver and an equipment owner.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - source_driver_id
 *               - source_settlement_id
 *               - target_equipment_owner_id
 *               - amount
 *             properties:
 *               source_driver_id:
 *                 type: string
 *                 format: uuid
 *               source_settlement_id:
 *                 type: string
 *                 format: uuid
 *               target_equipment_owner_id:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created balance transfer
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/settlements/balance-transfers/{id}/approve:
 *   patch:
 *     summary: Approve a balance transfer
 *     description: Approves a pending balance transfer. Requires admin or manager role.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               review_notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Approved transfer
 *       404:
 *         description: Transfer not found
 *       422:
 *         description: Cannot approve in current state
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/settlements/balance-transfers/{id}/reject:
 *   patch:
 *     summary: Reject a balance transfer
 *     description: Rejects a pending or approved balance transfer. Requires admin or manager role.
 *     tags:
 *       - Settlements
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               review_notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Rejected transfer
 *       404:
 *         description: Transfer not found
 *       422:
 *         description: Cannot reject in current state
 *       500:
 *         description: Server error
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
