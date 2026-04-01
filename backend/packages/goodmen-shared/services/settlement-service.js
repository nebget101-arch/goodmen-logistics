/**
 * Settlement workflow: draft creation, prefill (eligible loads + recurring deductions),
 * add/remove items, recalc totals, approve, void. Ensures load cannot be double-settled.
 */
const { getClient } = require('../internal/db');
const { getDrivingDistanceMiles } = require('../utils/distance');
const {
  computeLoadPay,
  recalculateSettlementTotals
} = require('./settlement-calculation');
const {
  buildUniqueSettlementNumber,
  insertSettlementWithRetry,
  sanitizeSettlementNumberToken
} = require('./settlement-numbering');
const {
  ELIGIBLE_SETTLEMENT_LOAD_STATUSES
} = require('./settlement-load-status');
const {
  resolveEligibleLoadDate
} = require('./settlement-load-dates');
const {
  getExpenseResponsibilityFieldForSourceType,
  normalizeRecurringDeductionPayeeIds,
  resolveSpecificExpenseResponsibility,
  resolveRecurringDeductionBackfillStartDate,
  shouldApplyRecurringDeductionForSettlement,
  shouldIncludeRecurringDeductionRule,
  resolveRecurringDeductionApplyTo
} = require('./settlement-recurring-deductions');
const {
  applyLeaseDeductionForSettlement
} = require('./lease-financing-service');

const SETTLEMENT_NUMBER_PREFIX = 'STL';
let payeesColumnSetCache = null;

function applyTenantFilter(qb, context, column = 'tenant_id') {
  if (context?.tenantId) {
    qb.andWhere(column, context.tenantId);
  }
}

function applyEntityFilter(qb, context, column = 'operating_entity_id') {
  if (context?.operatingEntityId) {
    qb.andWhere(column, context.operatingEntityId);
  }
}

function normalizeStopType(value) {
  return (value || '').toString().trim().toUpperCase();
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function estimateDrivingMilesFromCoordinates(fromCoords, toCoords) {
  if (!fromCoords || !toCoords) return 0;

  const fromLat = toFiniteNumber(fromCoords.latitude);
  const fromLon = toFiniteNumber(fromCoords.longitude);
  const toLat = toFiniteNumber(toCoords.latitude);
  const toLon = toFiniteNumber(toCoords.longitude);
  if ([fromLat, fromLon, toLat, toLon].some((value) => value === null)) return 0;

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latDelta = toRadians(toLat - fromLat);
  const lonDelta = toRadians(toLon - fromLon);
  const startLat = toRadians(fromLat);
  const endLat = toRadians(toLat);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(lonDelta / 2) ** 2;
  const greatCircleMiles = 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // Inflate straight-line distance slightly so settlement draft mileage stays useful
  // without blocking on third-party routing APIs during draft generation.
  return Math.round(greatCircleMiles * 1.18);
}

function toDateOnly(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const str = String(value).trim();
  // Fast path for ISO-like strings: 2026-03-01 or 2026-03-01T...
  const isoPrefix = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix) return isoPrefix[1];

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

async function getPayeesColumnSet(knex) {
  if (payeesColumnSetCache) return payeesColumnSetCache;
  const rows = await knex('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: 'payees' });
  payeesColumnSetCache = new Set(rows.map((row) => row.column_name));
  return payeesColumnSetCache;
}

async function getAdditionalPayeeRate(knex, payeeId) {
  if (!payeeId) return null;
  const columns = await getPayeesColumnSet(knex);
  if (!columns.has('additional_payee_rate')) return null;

  const row = await knex('payees')
    .where({ id: payeeId })
    .select('additional_payee_rate')
    .first();

  return row?.additional_payee_rate ?? null;
}

async function getActiveCompensationProfile(knex, driverId, asOfDate) {
  const d = toDateOnly(asOfDate) || toDateOnly(new Date());
  const row = await knex('driver_compensation_profiles')
    .where({ driver_id: driverId, status: 'active' })
    .whereRaw('effective_start_date <= ?', [d])
    .where(function () {
      this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [d]);
    })
    .orderBy([
      { column: 'effective_start_date', order: 'desc' },
      { column: 'created_at', order: 'desc' }
    ])
    .first();
  return row || null;
}

function buildCompensationProfileInsert(driverRow, effectiveStartDate) {
  if (!driverRow) return null;

  const payBasisLower = (driverRow.pay_basis || '').toString().toLowerCase();
  const profileType = (driverRow.driver_type || '').toString().toLowerCase() === 'owner_operator'
    ? 'owner_operator'
    : 'company_driver';

  let payModel = 'per_mile';
  let centsPerMile = null;
  let percentageRate = null;
  let flatWeeklyAmount = null;
  let flatPerLoadAmount = null;

  if (payBasisLower === 'percentage') {
    payModel = 'percentage';
    percentageRate = driverRow.pay_percentage ?? null;
  } else if (payBasisLower === 'flatpay' || payBasisLower === 'flat_weekly') {
    payModel = 'flat_weekly';
    flatWeeklyAmount = driverRow.pay_rate ?? null;
  } else if (payBasisLower === 'flat_per_load') {
    payModel = 'flat_per_load';
    flatPerLoadAmount = driverRow.pay_rate ?? null;
  } else {
    payModel = 'per_mile';
    centsPerMile = driverRow.pay_rate ?? null;
  }

  const hasSomePayConfig = [percentageRate, centsPerMile, flatWeeklyAmount, flatPerLoadAmount]
    .some((value) => value !== null && value !== undefined && value !== '');

  if (!hasSomePayConfig) return null;

  return {
    driver_id: driverRow.id,
    profile_type: profileType,
    pay_model: payModel,
    percentage_rate: percentageRate,
    cents_per_mile: centsPerMile,
    flat_weekly_amount: flatWeeklyAmount,
    flat_per_load_amount: flatPerLoadAmount,
    expense_sharing_enabled: false,
    effective_start_date: toDateOnly(driverRow.hire_date) || toDateOnly(effectiveStartDate) || toDateOnly(new Date()),
    effective_end_date: null,
    status: 'active',
    notes: 'Auto-created from driver pay settings'
  };
}

async function ensureActiveCompensationProfile(knex, driverRow, asOfDate) {
  if (!driverRow?.id) return null;

  let profile = await getActiveCompensationProfile(knex, driverRow.id, asOfDate);
  if (profile) return profile;

  const insertPayload = buildCompensationProfileInsert(driverRow, asOfDate);
  if (!insertPayload) return null;

  const [created] = await knex('driver_compensation_profiles')
    .insert(insertPayload)
    .returning('*');

  await knex('expense_responsibility_profiles')
    .where({ driver_id: driverRow.id, compensation_profile_id: null })
    .update({
      compensation_profile_id: created.id,
      updated_at: knex.fn.now()
    });

  return created;
}

async function getActivePayeeAssignment(knex, driverId, asOfDate) {
  const d = toDateOnly(asOfDate) || toDateOnly(new Date());
  const row = await knex('driver_payee_assignments')
    .where({ driver_id: driverId })
    .whereRaw('effective_start_date <= ?', [d])
    .where(function () {
      this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [d]);
    })
    .orderBy([
      { column: 'effective_start_date', order: 'desc' },
      { column: 'created_at', order: 'desc' }
    ])
    .first();
  return row || null;
}

async function getActiveExpenseResponsibilityProfile(knex, driverId, asOfDate) {
  const d = toDateOnly(asOfDate) || toDateOnly(new Date());
  const row = await knex('expense_responsibility_profiles')
    .where({ driver_id: driverId })
    .whereRaw('effective_start_date <= ?', [d])
    .where(function () {
      this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [d]);
    })
    .orderBy([
      { column: 'effective_start_date', order: 'desc' },
      { column: 'created_at', order: 'desc' }
    ])
    .first();
  return row || null;
}

function buildPaySnapshot(profile, driverRow) {
  if (profile) {
    return {
      pay_model: profile.pay_model,
      percentage_rate: profile.percentage_rate,
      cents_per_mile: profile.cents_per_mile,
      flat_weekly_amount: profile.flat_weekly_amount,
      flat_per_load_amount: profile.flat_per_load_amount,
      equipment_owner_percentage: profile.equipment_owner_percentage ?? null
    };
  }

  const payBasis = (driverRow?.pay_basis || '').toString().toLowerCase();
  if (payBasis === 'percentage') {
    return {
      pay_model: 'percentage',
      percentage_rate: driverRow?.pay_percentage ?? 0,
      cents_per_mile: null,
      flat_weekly_amount: null,
      flat_per_load_amount: null,
      equipment_owner_percentage: null
    };
  }
  if (payBasis === 'flatpay' || payBasis === 'flat_weekly') {
    return {
      pay_model: 'flat_weekly',
      percentage_rate: null,
      cents_per_mile: null,
      flat_weekly_amount: driverRow?.pay_rate ?? 0,
      flat_per_load_amount: null,
      equipment_owner_percentage: null
    };
  }
  if (payBasis === 'flat_per_load') {
    return {
      pay_model: 'flat_per_load',
      percentage_rate: null,
      cents_per_mile: null,
      flat_weekly_amount: null,
      flat_per_load_amount: driverRow?.pay_rate ?? 0,
      equipment_owner_percentage: null
    };
  }

  return {
    pay_model: 'per_mile',
    percentage_rate: null,
    cents_per_mile: driverRow?.pay_rate ?? 0,
    flat_weekly_amount: null,
    flat_per_load_amount: null,
    equipment_owner_percentage: null
  };
}

async function getLoadedMilesForLoad(client, loadId) {
  const stops = await client.query(
    `SELECT stop_type, zip FROM load_stops WHERE load_id = $1 ORDER BY sequence ASC, stop_type`,
    [loadId]
  );
  const pickups = stops.rows.filter((s) => normalizeStopType(s.stop_type) === 'PICKUP');
  const deliveries = stops.rows.filter((s) => normalizeStopType(s.stop_type) === 'DELIVERY');
  const firstZip = pickups[0]?.zip?.trim();
  const lastZip = deliveries.length ? deliveries[deliveries.length - 1]?.zip?.trim() : null;
  if (!firstZip || !lastZip) return 0;
  return getDrivingDistanceMiles(firstZip, lastZip);
}

async function getStopsForLoads(knex, loadIds) {
  if (!Array.isArray(loadIds) || !loadIds.length) return new Map();

  const rows = await knex('load_stops')
    .select('load_id', 'stop_type', 'stop_date', 'zip', 'sequence')
    .whereIn('load_id', loadIds)
    .orderBy([
      { column: 'load_id', order: 'asc' },
      { column: 'sequence', order: 'asc' },
      { column: 'created_at', order: 'asc' }
    ]);

  const byLoadId = new Map();
  for (const row of rows) {
    const key = String(row.load_id);
    const existing = byLoadId.get(key) || [];
    existing.push(row);
    byLoadId.set(key, existing);
  }
  return byLoadId;
}

async function getZipCoordinateMap(knex, zips) {
  const uniqueZips = Array.from(new Set(
    (Array.isArray(zips) ? zips : [])
      .map((zip) => (zip || '').toString().trim())
      .filter(Boolean)
  ));

  if (!uniqueZips.length) return new Map();
  let rows = [];
  try {
    rows = await knex('zip_codes')
      .select('zip', 'latitude', 'longitude')
      .whereIn('zip', uniqueZips);
  } catch (err) {
    return new Map();
  }

  const coordinateMap = new Map();
  for (const row of rows) {
    coordinateMap.set(String(row.zip).trim(), row);
  }
  return coordinateMap;
}

function getDraftLoadDatesAndZips(load, stops) {
  const stopList = Array.isArray(stops) ? stops : [];
  const pickups = stopList.filter((stop) => normalizeStopType(stop.stop_type) === 'PICKUP');
  const deliveries = stopList.filter((stop) => normalizeStopType(stop.stop_type) === 'DELIVERY');
  const firstPickup = pickups[0] || null;
  const lastDelivery = deliveries.length ? deliveries[deliveries.length - 1] : null;

  return {
    pickupDate: firstPickup?.stop_date || load.pickup_date_direct || null,
    deliveryDate: lastDelivery?.stop_date || load.delivery_date_direct || null,
    completedDate: load.completed_date_direct || null,
    createdAt: load.created_at_direct || null,
    pickupZip: firstPickup?.zip?.trim() || null,
    deliveryZip: lastDelivery?.zip?.trim() || null
  };
}

/** Load IDs already in a non-void settlement for the given driver (any period). */
async function getAlreadySettledLoadIds(knex, driverId) {
  const rows = await knex('settlement_load_items as sli')
    .join('settlements as s', 's.id', 'sli.settlement_id')
    .where('s.driver_id', driverId)
    .whereNot('s.settlement_status', 'void')
    .distinct('sli.load_id')
    .select('sli.load_id');
  return (rows || []).map((r) => r.load_id);
}

/**
 * Eligible loads: driver_id match, terminal status, pickup/delivery date in range, not already settled.
 * dateBasis: 'pickup' | 'delivery'
 */
async function getEligibleLoads(knex, client, driverId, periodStart, periodEnd, dateBasis = 'pickup', context = null) {
  const settledIds = await getAlreadySettledLoadIds(knex, driverId);

  const loads = await knex('loads as l')
    .select(
      'l.id',
      'l.load_number',
      'l.rate',
      'l.driver_id',
      'l.pickup_date as pickup_date_direct',
      'l.delivery_date as delivery_date_direct',
      'l.completed_date as completed_date_direct',
      'l.created_at as created_at_direct'
    )
    .where('l.driver_id', driverId)
    .whereIn('l.status', ELIGIBLE_SETTLEMENT_LOAD_STATUSES)
    .whereNotNull('l.rate')
    .modify((q) => {
      applyTenantFilter(q, context, 'l.tenant_id');
      applyEntityFilter(q, context, 'l.operating_entity_id');
      if (settledIds.length) q.whereNotIn('l.id', settledIds);
    });

  const periodStartStr = toDateOnly(periodStart);
  const periodEndStr = toDateOnly(periodEnd);
  if (!periodStartStr || !periodEndStr) {
    throw new Error('Invalid period_start or period_end');
  }

  const loadIds = loads.map((row) => row.id);
  const stopsByLoadId = await getStopsForLoads(knex, loadIds);
  const loadMetadata = new Map();
  const relevantZips = new Set();

  for (const row of loads) {
    const metadata = getDraftLoadDatesAndZips(row, stopsByLoadId.get(String(row.id)) || []);
    loadMetadata.set(String(row.id), metadata);
    if (metadata.pickupZip) relevantZips.add(metadata.pickupZip);
    if (metadata.deliveryZip) relevantZips.add(metadata.deliveryZip);
  }

  const zipCoordinateMap = await getZipCoordinateMap(knex, Array.from(relevantZips));
  const filtered = [];
  for (const row of loads) {
    const metadata = loadMetadata.get(String(row.id)) || {};
    const pickupDate = metadata.pickupDate || null;
    const deliveryDate = metadata.deliveryDate || null;
    const dateVal = resolveEligibleLoadDate(dateBasis, metadata);
    const d = toDateOnly(dateVal);
    if (d && d >= periodStartStr && d <= periodEndStr) {
      const loadedMiles = estimateDrivingMilesFromCoordinates(
        zipCoordinateMap.get(metadata.pickupZip || ''),
        zipCoordinateMap.get(metadata.deliveryZip || '')
      );
      filtered.push({ ...row, pickup_date: pickupDate, delivery_date: deliveryDate, loaded_miles: loadedMiles });
    }
  }
  return filtered;
}

async function backfillSettlementLoadDates(knex, settlementId) {
  const items = await knex('settlement_load_items')
    .where({ settlement_id: settlementId })
    .where(function () {
      this.whereNull('pickup_date').orWhereNull('delivery_date');
    });

  if (!items.length) return;

  const client = await getClient();
  try {
    for (const item of items) {
      const load = await knex('loads').where({ id: item.load_id }).select('pickup_date', 'delivery_date').first();
      const stops = await client.query(
        'SELECT stop_type, stop_date FROM load_stops WHERE load_id = $1 ORDER BY sequence ASC, stop_type',
        [item.load_id]
      );
      const pickups = stops.rows.filter((s) => normalizeStopType(s.stop_type) === 'PICKUP');
      const deliveries = stops.rows.filter((s) => normalizeStopType(s.stop_type) === 'DELIVERY');

      const pickupDate = item.pickup_date || pickups[0]?.stop_date || load?.pickup_date || null;
      const deliveryDate = item.delivery_date || (deliveries.length ? deliveries[deliveries.length - 1].stop_date : null) || load?.delivery_date || null;

      if (pickupDate !== item.pickup_date || deliveryDate !== item.delivery_date) {
        await knex('settlement_load_items')
          .where({ id: item.id })
          .update({
            pickup_date: pickupDate,
            delivery_date: deliveryDate,
            updated_at: knex.fn.now()
          });
      }
    }
  } finally {
    client.release();
  }
}

/** Recurring deductions applicable for driver in date range. */
async function getRecurringDeductionsForPeriod(knex, driverId, periodStart, periodEnd, payeeIds = [], options = {}) {
  const startStr = toDateOnly(periodStart);
  const endStr = toDateOnly(periodEnd);
  if (!startStr || !endStr) {
    throw new Error('Invalid period_start or period_end');
  }
  const normalizedPayeeIds = (Array.isArray(payeeIds) ? payeeIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const rows = await knex('recurring_deduction_rules')
    .where('enabled', true)
    .where(function () {
      this.whereNull('end_date').orWhereRaw('end_date >= ?', [startStr]);
    })
    .andWhere(function () {
      this.where('driver_id', driverId)
        .orWhere(function () {
          this.whereNull('driver_id').whereNull('payee_id');
        });

      if (normalizedPayeeIds.length) {
        this.orWhere(function () {
          this.whereNull('driver_id').whereIn('payee_id', normalizedPayeeIds);
        });
      }
    });

  return rows.filter((rule) => shouldIncludeRecurringDeductionRule(rule, startStr, endStr, options));
}

async function generateSettlementNumberWithContext(_knex, driver, period) {
  const driverName = [driver?.first_name, driver?.last_name].filter(Boolean).join('_') || 'DRIVER';
  const periodStart = toDateOnly(period?.period_start) || 'START';
  const periodEnd = toDateOnly(period?.period_end) || 'END';
  return buildUniqueSettlementNumber(SETTLEMENT_NUMBER_PREFIX, [
    sanitizeSettlementNumberToken(driverName, 'DRIVER'),
    sanitizeSettlementNumberToken(`${periodStart}_TO_${periodEnd}`, 'NO_PERIOD')
  ]);
}

/**
 * FN-578: Consume unlinked fuel transactions for a settlement.
 * Queries fuel_transactions where driver_id matches and settlement_link_status = 'none',
 * checks expense_responsibility_profiles for fuel_responsibility setting,
 * creates settlement_adjustment_items and links fuel transactions.
 *
 * Note: fuel_transactions does not have a settlement_adjustment_item_id column
 * (unlike toll_transactions), so only settlement_id and settlement_link_status are updated.
 *
 * @param {object} knex - Knex instance
 * @param {string} settlementId - Settlement UUID
 * @param {string} driverId - Driver UUID
 * @param {string} periodStart - Period start date (YYYY-MM-DD)
 * @param {string} periodEnd - Period end date (YYYY-MM-DD)
 * @param {string|null} userId - User performing the action
 * @param {string|null} tenantId - Tenant UUID
 */
async function consumeFuelForSettlement(knex, settlementId, driverId, periodStart, periodEnd, userId, tenantId) {
  // 1. Get unlinked fuel transactions for the driver in the period
  let fuelQuery = knex('fuel_transactions')
    .where({
      driver_id: driverId,
      settlement_link_status: 'none'
    })
    .where('transaction_date', '>=', periodStart)
    .where('transaction_date', '<=', periodEnd);

  if (tenantId) {
    fuelQuery = fuelQuery.where('tenant_id', tenantId);
  }

  const fuels = await fuelQuery.orderBy('transaction_date', 'asc');
  if (!fuels.length) return [];

  // 2. Get the driver's expense responsibility profile
  const asOf = toDateOnly(periodEnd) || toDateOnly(new Date());
  const expenseProfile = await knex('expense_responsibility_profiles')
    .where({ driver_id: driverId })
    .whereRaw('effective_start_date <= ?', [asOf])
    .where(function () {
      this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [asOf]);
    })
    // FN-569: deterministic sort — most-recently created wins on same date
    .orderBy([
      { column: 'effective_start_date', order: 'desc' },
      { column: 'created_at', order: 'desc' }
    ])
    .first();

  const fuelResponsibility = expenseProfile?.fuel_responsibility || 'company';

  // 3. If company pays, skip — no deduction from driver or owner
  if (fuelResponsibility === 'company') return [];

  // 4. Determine driver share percentage
  let driverSharePct = 1.0; // 100% for 'driver' responsibility
  if (fuelResponsibility === 'shared') {
    const customRules = expenseProfile?.custom_rules || {};
    // Primary: explicit fuel_split_percentage key (0-100 = driver's share)
    // Fallback: custom_rules.percentages.fuel (stored by FN-567 sharedExpensePercentages)
    const splitPct = Number(customRules.fuel_split_percentage ?? customRules.percentages?.fuel);
    driverSharePct = (!Number.isNaN(splitPct) && splitPct >= 0 && splitPct <= 100)
      ? splitPct / 100
      : 0.5; // Default 50/50 if not configured
  } else if (fuelResponsibility === 'owner') {
    // Owner-only: driver share is 0 — adjustment goes to owner
    driverSharePct = 0;
  }

  // 5. Determine charge_party
  const chargeParty = fuelResponsibility === 'shared'
    ? 'shared'
    : fuelResponsibility === 'owner'
      ? 'owner'
      : 'driver';

  // 6. Create adjustment items and link fuel transactions
  const createdAdjustments = [];
  for (const fuel of fuels) {
    const fuelAmount = Number(fuel.amount) || 0;
    if (fuelAmount === 0) continue;

    // For owner responsibility, the full amount is charged to the owner;
    // for driver/shared use driverSharePct of the transaction amount.
    const deductionAmount = fuelResponsibility === 'owner'
      ? Math.round(fuelAmount * 100) / 100
      : Math.round(fuelAmount * driverSharePct * 100) / 100;

    if (deductionAmount === 0) continue;

    const description = [
      'Fuel',
      fuel.vendor_name || fuel.provider_name || '',
      fuel.location_name ? `(${fuel.location_name})` : '',
      fuel.transaction_date ? `${toDateOnly(fuel.transaction_date)}` : ''
    ].filter(Boolean).join(' — ');

    const [adj] = await knex('settlement_adjustment_items')
      .insert({
        settlement_id: settlementId,
        item_type: 'deduction',
        source_type: 'imported_fuel',
        description,
        amount: deductionAmount,
        charge_party: chargeParty,
        apply_to: 'primary_payee',
        source_reference_id: fuel.id,
        source_reference_type: 'fuel_transaction',
        occurrence_date: fuel.transaction_date,
        status: 'applied',
        created_by: userId
      })
      .returning('*');

    // Link the fuel transaction to this settlement
    // Note: fuel_transactions has no settlement_adjustment_item_id column
    await knex('fuel_transactions')
      .where({ id: fuel.id })
      .update({
        settlement_id: settlementId,
        settlement_link_status: 'linked',
        updated_at: knex.fn.now()
      });

    createdAdjustments.push(adj);
  }

  return createdAdjustments;
}

/**
 * Consume unlinked toll transactions for a settlement.
 * Queries toll_transactions where driver_id matches and settlement_link_status = 'none',
 * checks expense_responsibility_profiles for toll_responsibility setting,
 * creates settlement_adjustment_items and links toll transactions.
 *
 * @param {object} knex - Knex instance
 * @param {string} settlementId - Settlement UUID
 * @param {string} driverId - Driver UUID
 * @param {string} periodStart - Period start date (YYYY-MM-DD)
 * @param {string} periodEnd - Period end date (YYYY-MM-DD)
 * @param {string|null} userId - User performing the action
 * @param {string|null} tenantId - Tenant UUID
 */
async function consumeTollsForSettlement(knex, settlementId, driverId, periodStart, periodEnd, userId, tenantId) {
  // 1. Get unlinked toll transactions for the driver in the period
  let tollQuery = knex('toll_transactions')
    .where({
      driver_id: driverId,
      settlement_link_status: 'none'
    })
    .where('transaction_date', '>=', periodStart)
    .where('transaction_date', '<=', periodEnd);

  if (tenantId) {
    tollQuery = tollQuery.where('tenant_id', tenantId);
  }

  const tolls = await tollQuery.orderBy('transaction_date', 'asc');
  if (!tolls.length) return [];

  // 2. Get the driver's expense responsibility profile
  const asOf = toDateOnly(periodEnd) || toDateOnly(new Date());
  const expenseProfile = await knex('expense_responsibility_profiles')
    .where({ driver_id: driverId })
    .whereRaw('effective_start_date <= ?', [asOf])
    .where(function () {
      this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [asOf]);
    })
    .orderBy('effective_start_date', 'desc')
    .first();

  const tollResponsibility = expenseProfile?.toll_responsibility || 'company';

  // 3. If company pays, skip — no deduction from driver
  if (tollResponsibility === 'company') return [];

  // 4. Determine split percentage for shared responsibility
  let driverSharePct = 1.0; // 100% for 'driver' responsibility
  if (tollResponsibility === 'shared') {
    const customRules = expenseProfile?.custom_rules || {};
    // custom_rules may contain toll_split_percentage (0-100)
    const splitPct = Number(customRules.toll_split_percentage);
    driverSharePct = (!Number.isNaN(splitPct) && splitPct >= 0 && splitPct <= 100)
      ? splitPct / 100
      : 0.5; // Default 50/50 if not configured
  }

  // 5. Determine charge_party
  const chargeParty = tollResponsibility === 'shared' ? 'shared' : 'driver';

  // 6. Create adjustment items and link toll transactions
  const createdAdjustments = [];
  for (const toll of tolls) {
    const tollAmount = Number(toll.amount) || 0;
    if (tollAmount === 0) continue;

    const deductionAmount = Math.round(tollAmount * driverSharePct * 100) / 100;
    if (deductionAmount === 0) continue;

    const description = [
      'Toll',
      toll.plaza_name || toll.provider_name || '',
      toll.transaction_date ? `(${toDateOnly(toll.transaction_date)})` : ''
    ].filter(Boolean).join(' — ');

    const [adj] = await knex('settlement_adjustment_items')
      .insert({
        settlement_id: settlementId,
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
        created_by: userId
      })
      .returning('*');

    // Link the toll transaction to this settlement
    await knex('toll_transactions')
      .where({ id: toll.id })
      .update({
        settlement_id: settlementId,
        settlement_adjustment_item_id: adj.id,
        settlement_link_status: 'linked',
        updated_at: knex.fn.now()
      });

    createdAdjustments.push(adj);
  }

  return createdAdjustments;
}

/**
 * Create draft settlement: resolve profile + payees, get eligible loads + recurring deductions,
 * build load items with pay snapshot, insert adjustments for recurring deductions, recalc totals.
 */
async function createDraftSettlement(payrollPeriodId, driverId, dateBasis, userId, knex, context = null) {
  const client = await getClient();
  const startedAt = process.hrtime.bigint();
  const logTiming = (stage, extra = {}) => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log('[Settlement Create][Timing]', {
      payrollPeriodId,
      driverId,
      stage,
      elapsedMs: Number(elapsedMs.toFixed(1)),
      ...extra
    });
  };
  try {
    const tenantId = context?.tenantId || null;
    const operatingEntityId = context?.operatingEntityId || null;
    if (!tenantId || !operatingEntityId) {
      throw new Error('Operating entity context is required to create a settlement');
    }

    const period = await knex('payroll_periods')
      .where({ id: payrollPeriodId })
      .modify((qb) => {
        applyTenantFilter(qb, context, 'payroll_periods.tenant_id');
        applyEntityFilter(qb, context, 'payroll_periods.operating_entity_id');
      })
      .first();
    if (!period) throw new Error('Payroll period not found');
    if (!['draft', 'open'].includes(period.status)) throw new Error('Period not open for new settlements');

    const driver = await knex('drivers')
      .where({ id: driverId })
      .modify((qb) => applyTenantFilter(qb, context, 'drivers.tenant_id'))
      .select('id', 'first_name', 'last_name', 'pay_basis', 'pay_rate', 'pay_percentage', 'driver_type', 'hire_date')
      .first();
    if (!driver) throw new Error('Driver not found');

    const profile = await ensureActiveCompensationProfile(knex, driver, period.period_end);
    const payeeAssignment = await getActivePayeeAssignment(knex, driverId, period.period_end);

    console.log('[Settlement Create] Driver lookup:', {
      driverId,
      periodEnd: period.period_end,
      profileFound: !!profile,
      profileId: profile?.id,
      payeeAssignmentFound: !!payeeAssignment,
      primaryPayeeId: payeeAssignment?.primary_payee_id,
      additionalPayeeIdFromAssignment: payeeAssignment?.additional_payee_id
    });

    let primaryPayeeId = payeeAssignment?.primary_payee_id;
    let additionalPayeeId = payeeAssignment?.additional_payee_id ?? null;

    if (!primaryPayeeId) {
      const driverPayee = await knex('payees').where({ type: 'driver', is_active: true }).first();
      if (driverPayee) primaryPayeeId = driverPayee.id;
    }
    if (!primaryPayeeId) {
      const payeeName = [driver.first_name, driver.last_name].filter(Boolean).join(' ').trim() || `Driver ${driverId.slice(0, 8)}`;
      const [newPayee] = await knex('payees').insert({
        tenant_id: tenantId,
        type: 'driver',
        name: payeeName,
        is_active: true
      }).returning('id');
      primaryPayeeId = newPayee.id;
      const periodStart = toDateOnly(period.period_start) || toDateOnly(new Date());
      await knex('driver_payee_assignments').insert({
        tenant_id: tenantId,
        driver_id: driverId,
        primary_payee_id: primaryPayeeId,
        rule_type: 'company_truck',
        effective_start_date: periodStart
      });
    }

    const additionalPayeeRate = await getAdditionalPayeeRate(knex, additionalPayeeId);

    const eligibleLoads = await getEligibleLoads(
      knex,
      client,
      driverId,
      period.period_start,
      period.period_end,
      dateBasis,
      context
    );
    logTiming('eligible-loads-resolved', { eligibleLoadCount: eligibleLoads.length });

    const profileSnapshot = {
      ...buildPaySnapshot(profile, driver),
      additional_payee_rate: additionalPayeeRate
    };

    const settlementDate = period.period_end;
    const settlementBasePayload = {
      tenant_id: tenantId,
      operating_entity_id: operatingEntityId,
      payroll_period_id: payrollPeriodId,
      driver_id: driverId,
      compensation_profile_id: profile?.id ?? null,
      primary_payee_id: primaryPayeeId,
      additional_payee_id: additionalPayeeId,
      settlement_status: 'preparing',
      date: settlementDate,
      subtotal_gross: 0,
      subtotal_driver_pay: 0,
      subtotal_additional_payee: 0,
      total_deductions: 0,
      total_advances: 0,
      net_pay_driver: 0,
      net_pay_additional_payee: 0,
      created_by: userId
    };

    const settlement = await insertSettlementWithRetry(knex, async () => ({
      ...settlementBasePayload,
      settlement_number: await generateSettlementNumberWithContext(knex, driver, period)
    }));

    for (const load of eligibleLoads) {
      const gross = Number(load.rate) || 0;
      const { driverPay, additionalPayeePay } = computeLoadPay({
        payModel: profileSnapshot.pay_model,
        centsPerMile: profileSnapshot.cents_per_mile,
        percentageRate: profileSnapshot.percentage_rate,
        flatPerLoadAmount: profileSnapshot.flat_per_load_amount,
        gross,
        loadedMiles: load.loaded_miles || 0,
        hasAdditionalPayee: !!additionalPayeeId,
        additionalPayeeRate: profileSnapshot.additional_payee_rate,
        equipmentOwnerPercentage: profileSnapshot.equipment_owner_percentage
      });
      await knex('settlement_load_items').insert({
        settlement_id: settlement.id,
        load_id: load.id,
        pickup_date: load.pickup_date,
        delivery_date: load.delivery_date,
        loaded_miles: load.loaded_miles ?? null,
        pay_basis_snapshot: profileSnapshot,
        gross_amount: gross,
        driver_pay_amount: driverPay,
        additional_payee_amount: additionalPayeePay,
        included_by: userId
      });
    }

    const expenseProfile = await getActiveExpenseResponsibilityProfile(knex, driverId, period.period_end);
    const recurring = await getRecurringDeductionsForPeriod(
      knex,
      driverId,
      period.period_start,
      period.period_end,
      normalizeRecurringDeductionPayeeIds(
        [primaryPayeeId, additionalPayeeId],
        payeeAssignment
      )
    );
    logTiming('recurring-deductions-resolved', { recurringCount: recurring.length });
    for (const rule of recurring) {
      const applyTo = resolveRecurringDeductionApplyTo(rule, {
        primaryPayeeId,
        additionalPayeeId
      });
      if (!applyTo) {
        continue;
      }
      if (!shouldApplyRecurringDeductionForSettlement(rule, applyTo, {
        expenseProfile,
        hasLoadItems: eligibleLoads.length > 0
      })) {
        continue;
      }
      const inferredExpenseResponsibility = resolveSpecificExpenseResponsibility(rule, expenseProfile);
      const responsibilityField = getExpenseResponsibilityFieldForSourceType(rule.source_type);
      if (inferredExpenseResponsibility && !rule.expense_responsibility && responsibilityField) {
        await knex('recurring_deduction_rules')
          .where({ id: rule.id })
          .update({
            expense_responsibility: inferredExpenseResponsibility,
            updated_at: knex.fn.now()
          });
        rule.expense_responsibility = inferredExpenseResponsibility;
      }

      await knex('settlement_adjustment_items').insert({
        settlement_id: settlement.id,
        item_type: 'deduction',
        source_type: 'scheduled_rule',
        description: rule.description || rule.source_type || 'Recurring deduction',
        amount: Number(rule.amount) || 0,
        charge_party: 'driver',
        apply_to: applyTo,
        source_reference_id: rule.id,
        source_reference_type: 'recurring_deduction_rule',
        status: 'applied',
        created_by: userId
      });
    }

    // FN-578: Auto-consume unlinked fuel transactions for the period
    await consumeFuelForSettlement(
      knex,
      settlement.id,
      driverId,
      period.period_start,
      period.period_end,
      userId,
      tenantId
    );
    logTiming('fuel-consumed');

    // Auto-consume unlinked toll transactions for the period
    await consumeTollsForSettlement(
      knex,
      settlement.id,
      driverId,
      period.period_start,
      period.period_end,
      userId,
      tenantId
    );
    logTiming('tolls-consumed');

    await recalcAndUpdateSettlement(knex, settlement.id);
    logTiming('settlement-recalculated');
    return knex('settlements').where({ id: settlement.id }).first();
  } finally {
    client.release();
  }
}

async function recalcAndUpdateSettlement(knex, settlementId, options = {}) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) throw new Error('Settlement not found');
  if (settlement.settlement_status === 'void') return settlement;

  const asOf = toDateOnly(new Date());
  
  // Resolve compensation profile
  let activeCompensationProfile = await getActiveCompensationProfile(knex, settlement.driver_id, asOf);
  if (!activeCompensationProfile) {
    activeCompensationProfile = await knex('driver_compensation_profiles')
      .where({ driver_id: settlement.driver_id, status: 'active' })
      .orderBy([
        { column: 'effective_start_date', order: 'desc' },
        { column: 'created_at', order: 'desc' }
      ])
      .first();
  }
  const effectiveCompensationProfileId = activeCompensationProfile?.id || settlement.compensation_profile_id || null;

  // Resolve payee assignment
  let payeeAssignment = await getActivePayeeAssignment(knex, settlement.driver_id, asOf);
  if (!payeeAssignment) {
    payeeAssignment = await knex('driver_payee_assignments')
      .where({ driver_id: settlement.driver_id })
      .orderBy([
        { column: 'effective_start_date', order: 'desc' },
        { column: 'created_at', order: 'desc' }
      ])
      .first();
  }
  const effectivePrimaryPayeeId = settlement.primary_payee_id || payeeAssignment?.primary_payee_id || null;
  const effectiveAdditionalPayeeId = settlement.additional_payee_id || payeeAssignment?.additional_payee_id || null;

  // Update settlement if snapshot values changed
  if (
    effectiveCompensationProfileId !== settlement.compensation_profile_id ||
    effectivePrimaryPayeeId !== settlement.primary_payee_id ||
    effectiveAdditionalPayeeId !== settlement.additional_payee_id
  ) {
    await knex('settlements')
      .where({ id: settlementId })
      .update({
        compensation_profile_id: effectiveCompensationProfileId,
        primary_payee_id: effectivePrimaryPayeeId,
        additional_payee_id: effectiveAdditionalPayeeId,
        updated_at: knex.fn.now()
      });

    settlement.compensation_profile_id = effectiveCompensationProfileId;
    settlement.primary_payee_id = effectivePrimaryPayeeId;
    settlement.additional_payee_id = effectiveAdditionalPayeeId;
  }

  await backfillSettlementLoadDates(knex, settlementId);

  // Refresh scheduled deductions: remove old ones and re-apply current rules
  await knex('settlement_adjustment_items')
    .where({ settlement_id: settlementId, source_type: 'scheduled_rule' })
    .andWhere(function () {
      this.whereNull('status').orWhereNot('status', 'removed');
    })
    .delete();

  // Get settlement period for recurring deduction lookup
  const period = settlement.payroll_period_id
    ? await knex('payroll_periods').where({ id: settlement.payroll_period_id }).first()
    : null;

  if (period) {
    const expenseProfile = await getActiveExpenseResponsibilityProfile(knex, settlement.driver_id, asOf);
    const excludedScheduledRows = await knex('settlement_adjustment_items')
      .where({ settlement_id: settlementId, source_type: 'scheduled_rule_removed' })
      .select('source_reference_id', 'apply_to');
    const excludedScheduledKeys = new Set(
      excludedScheduledRows
        .filter((row) => !!row?.source_reference_id)
        .map((row) => `${row.source_reference_id}|${row.apply_to || 'primary_payee'}`)
    );

    const recurring = await getRecurringDeductionsForPeriod(
      knex,
      settlement.driver_id,
      period.period_start,
      period.period_end,
      normalizeRecurringDeductionPayeeIds(
        [effectivePrimaryPayeeId, effectiveAdditionalPayeeId],
        payeeAssignment
      ),
      {
        historicalBackfillStartDate: options?.historicalRecurringRuleStartDateStart || null,
        historicalBackfillEndDate: options?.historicalRecurringRuleStartDateEnd || null
      }
    );

    for (const rule of recurring) {
      const backfilledRuleStartDate = resolveRecurringDeductionBackfillStartDate(rule, period.period_end, {
        historicalBackfillStartDate: options?.historicalRecurringRuleStartDateStart || null,
        historicalBackfillEndDate: options?.historicalRecurringRuleStartDateEnd || null
      });
      if (backfilledRuleStartDate) {
        await knex('recurring_deduction_rules')
          .where({ id: rule.id })
          .update({
            start_date: backfilledRuleStartDate,
            updated_at: knex.fn.now()
          });
        rule.start_date = backfilledRuleStartDate;
      }

      const applyTo = resolveRecurringDeductionApplyTo(rule, {
        primaryPayeeId: effectivePrimaryPayeeId,
        additionalPayeeId: effectiveAdditionalPayeeId
      });
      if (!applyTo) {
        continue;
      }
      if (!shouldApplyRecurringDeductionForSettlement(rule, applyTo, {
        expenseProfile,
        hasLoadItems: false
      })) {
        continue;
      }
      const inferredExpenseResponsibility = resolveSpecificExpenseResponsibility(rule, expenseProfile);
      const responsibilityField = getExpenseResponsibilityFieldForSourceType(rule.source_type);
      if (inferredExpenseResponsibility && !rule.expense_responsibility && responsibilityField) {
        await knex('recurring_deduction_rules')
          .where({ id: rule.id })
          .update({
            expense_responsibility: inferredExpenseResponsibility,
            updated_at: knex.fn.now()
          });
        rule.expense_responsibility = inferredExpenseResponsibility;
      }

      const exclusionKey = `${rule.id}|${applyTo}`;
      if (excludedScheduledKeys.has(exclusionKey)) {
        continue;
      }

      await knex('settlement_adjustment_items').insert({
        settlement_id: settlementId,
        item_type: 'deduction',
        source_type: 'scheduled_rule',
        description: rule.description || rule.source_type || 'Recurring deduction',
        amount: Number(rule.amount) || 0,
        charge_party: 'driver',
        apply_to: applyTo,
        source_reference_id: rule.id,
        source_reference_type: 'recurring_deduction_rule',
        status: 'applied',
        created_by: settlement.created_by || null
      });
    }
  }

  // Apply lease-to-own deduction idempotently for active agreements.
  await applyLeaseDeductionForSettlement(knex, settlement).catch((err) => {
    console.warn('[settlement] lease deduction skipped', err?.message || err);
  });

  const loadItems = await knex('settlement_load_items').where({ settlement_id: settlementId });
  const adjustmentItems = await knex('settlement_adjustment_items').where({ settlement_id: settlementId });
  const profile = activeCompensationProfile
    || (effectiveCompensationProfileId
      ? await knex('driver_compensation_profiles').where({ id: effectiveCompensationProfileId }).first()
      : null);
  const driver = await knex('drivers')
    .where({ id: settlement.driver_id })
    .select('pay_basis', 'pay_rate', 'pay_percentage')
    .first();
  const additionalPayeeRateRaw = await getAdditionalPayeeRate(knex, effectiveAdditionalPayeeId);
  const additionalPayeeRate = Number.isFinite(Number(additionalPayeeRateRaw))
    ? Number(additionalPayeeRateRaw)
    : null;
  const profileSnapshot = {
    ...buildPaySnapshot(profile, driver),
    additional_payee_rate: additionalPayeeRate
  };

  const hasAdditionalPayee = !!effectiveAdditionalPayeeId || (Number(additionalPayeeRate) || 0) > 0;

  console.log('[Settlement Recalc] payee context', {
    settlementId,
    settlementAdditionalPayeeId: settlement.additional_payee_id,
    effectiveAdditionalPayeeId,
    additionalPayeeRateRaw,
    additionalPayeeRate,
    hasAdditionalPayee
  });
  const normalizeSnapshot = (value) => {
    if (!value) return {};
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (_) {
        return {};
      }
    }
    return value;
  };

  const recalculatedLoadItems = [];
  for (const item of loadItems) {
    const itemSnapshot = normalizeSnapshot(item.pay_basis_snapshot);
    const payModel = itemSnapshot.pay_model || profileSnapshot.pay_model || 'per_mile';
    const refreshedSnapshot = {
      pay_model: payModel,
      percentage_rate: itemSnapshot.percentage_rate ?? profileSnapshot.percentage_rate ?? null,
      cents_per_mile: itemSnapshot.cents_per_mile ?? profileSnapshot.cents_per_mile ?? null,
      flat_weekly_amount: itemSnapshot.flat_weekly_amount ?? profileSnapshot.flat_weekly_amount ?? null,
      flat_per_load_amount: itemSnapshot.flat_per_load_amount ?? profileSnapshot.flat_per_load_amount ?? null,
      additional_payee_rate: itemSnapshot.additional_payee_rate ?? profileSnapshot.additional_payee_rate ?? null,
      equipment_owner_percentage: itemSnapshot.equipment_owner_percentage ?? profileSnapshot.equipment_owner_percentage ?? null
    };
    const { driverPay, additionalPayeePay } = computeLoadPay({
      payModel: refreshedSnapshot.pay_model,
      centsPerMile: refreshedSnapshot.cents_per_mile,
      percentageRate: refreshedSnapshot.percentage_rate,
      flatPerLoadAmount: refreshedSnapshot.flat_per_load_amount,
      gross: Number(item.gross_amount) || 0,
      loadedMiles: Number(item.loaded_miles) || 0,
      hasAdditionalPayee,
      additionalPayeeRate: refreshedSnapshot.additional_payee_rate,
      equipmentOwnerPercentage: refreshedSnapshot.equipment_owner_percentage
    });

    console.log('[Settlement Recalc] load pay', {
      settlementId,
      loadId: item.load_id,
      gross: Number(item.gross_amount) || 0,
      rateUsed: itemSnapshot.additional_payee_rate ?? profileSnapshot.additional_payee_rate,
      driverPay,
      additionalPayeePay,
      previousAdditionalPayeeAmount: Number(item.additional_payee_amount || 0)
    });

    if (
      Number(item.driver_pay_amount) !== Number(driverPay) ||
      Number(item.additional_payee_amount || 0) !== Number(additionalPayeePay) ||
      JSON.stringify(itemSnapshot || {}) !== JSON.stringify(refreshedSnapshot)
    ) {
      await knex('settlement_load_items')
        .where({ id: item.id })
        .update({
          pay_basis_snapshot: refreshedSnapshot,
          driver_pay_amount: driverPay,
          additional_payee_amount: additionalPayeePay,
          updated_at: knex.fn.now()
        });
    }

    recalculatedLoadItems.push({
      ...item,
      pay_basis_snapshot: refreshedSnapshot,
      driver_pay_amount: driverPay,
      additional_payee_amount: additionalPayeePay
    });
  }

  const totals = recalculateSettlementTotals(settlement, recalculatedLoadItems, adjustmentItems, profileSnapshot);
  await knex('settlements').where({ id: settlementId }).update(totals);
  return knex('settlements').where({ id: settlementId }).first();
}

async function addLoadToSettlement(knex, settlementId, loadId, userId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) throw new Error('Settlement not found');
  if (['approved', 'paid', 'void'].includes(settlement.settlement_status)) throw new Error('Settlement is locked');

  const already = await knex('settlement_load_items').where({ settlement_id: settlementId, load_id: loadId }).first();
  if (already) throw new Error('Load already in this settlement');

  const settledIds = await getAlreadySettledLoadIds(knex, settlement.driver_id);
  if (settledIds.includes(loadId)) throw new Error('Load already in another non-void settlement');

  const client = await getClient();
  try {
    const load = await knex('loads').where({ id: loadId, driver_id: settlement.driver_id }).first();
    if (!load) throw new Error('Load not found or not assigned to this driver');
    const loadedMiles = await getLoadedMilesForLoad(client, loadId);
    const profile = settlement.compensation_profile_id
      ? await knex('driver_compensation_profiles').where({ id: settlement.compensation_profile_id }).first()
      : null;
    const driver = await knex('drivers')
      .where({ id: settlement.driver_id })
      .select('pay_basis', 'pay_rate', 'pay_percentage')
      .first();
    const additionalPayeeRate = await getAdditionalPayeeRate(knex, settlement.additional_payee_id);
    const snapshot = {
      ...buildPaySnapshot(profile, driver),
      additional_payee_rate: additionalPayeeRate
    };
    const gross = Number(load.rate) || 0;
    const { driverPay, additionalPayeePay } = computeLoadPay({
      payModel: snapshot.pay_model,
      centsPerMile: snapshot.cents_per_mile,
      percentageRate: snapshot.percentage_rate,
      flatPerLoadAmount: snapshot.flat_per_load_amount,
      gross,
      loadedMiles,
      hasAdditionalPayee: !!settlement.additional_payee_id,
      additionalPayeeRate: snapshot.additional_payee_rate,
      equipmentOwnerPercentage: snapshot.equipment_owner_percentage
    });
    const stops = await client.query(
      'SELECT stop_type, stop_date FROM load_stops WHERE load_id = $1 ORDER BY sequence',
      [loadId]
    );
    const pickups = stops.rows.filter((s) => normalizeStopType(s.stop_type) === 'PICKUP');
    const deliveries = stops.rows.filter((s) => normalizeStopType(s.stop_type) === 'DELIVERY');
    const pickupDate = pickups[0]?.stop_date ?? load.pickup_date ?? null;
    const deliveryDate = deliveries.length ? deliveries[deliveries.length - 1].stop_date : (load.delivery_date ?? null);
    await knex('settlement_load_items').insert({
      settlement_id: settlementId,
      load_id: loadId,
      pickup_date: pickupDate,
      delivery_date: deliveryDate,
      loaded_miles: loadedMiles,
      pay_basis_snapshot: snapshot,
      gross_amount: gross,
      driver_pay_amount: driverPay,
      additional_payee_amount: additionalPayeePay,
      included_by: userId
    });
    await recalcAndUpdateSettlement(knex, settlementId);
  } finally {
    client.release();
  }
}

async function removeLoadFromSettlement(knex, settlementId, loadItemId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) throw new Error('Settlement not found');
  if (['approved', 'paid', 'void'].includes(settlement.settlement_status)) throw new Error('Settlement is locked');
  await knex('settlement_load_items').where({ id: loadItemId, settlement_id: settlementId }).del();
  await recalcAndUpdateSettlement(knex, settlementId);
}

async function addAdjustment(knex, settlementId, payload, userId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) throw new Error('Settlement not found');
  if (['approved', 'paid', 'void'].includes(settlement.settlement_status)) throw new Error('Settlement is locked');
  await knex('settlement_adjustment_items').insert({
    settlement_id: settlementId,
    item_type: payload.item_type || 'deduction',
    source_type: payload.source_type || 'manual',
    description: payload.description || null,
    amount: Number(payload.amount) || 0,
    quantity: payload.quantity != null ? Number(payload.quantity) : null,
    unit_rate: payload.unit_rate != null ? Number(payload.unit_rate) : null,
    charge_party: payload.charge_party || 'driver',
    apply_to: payload.apply_to || 'primary_payee',
    status: 'applied',
    created_by: userId
  });
  await recalcAndUpdateSettlement(knex, settlementId);
}

async function removeAdjustment(knex, settlementId, adjustmentId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) throw new Error('Settlement not found');
  if (['approved', 'paid', 'void'].includes(settlement.settlement_status)) throw new Error('Settlement is locked');

  const adjustment = await knex('settlement_adjustment_items')
    .where({ id: adjustmentId, settlement_id: settlementId })
    .first();
  if (!adjustment) throw new Error('Adjustment not found');

  // For scheduled rules, persist an exclusion marker so recalc/backfill won't re-add it.
  if (adjustment.source_type === 'scheduled_rule' && adjustment.source_reference_id) {
    const existingExclusion = await knex('settlement_adjustment_items')
      .where({
        settlement_id: settlementId,
        source_type: 'scheduled_rule_removed',
        source_reference_id: adjustment.source_reference_id,
        apply_to: adjustment.apply_to || 'primary_payee'
      })
      .first();

    if (!existingExclusion) {
      await knex('settlement_adjustment_items').insert({
        settlement_id: settlementId,
        item_type: 'deduction',
        source_type: 'scheduled_rule_removed',
        description: `Excluded scheduled deduction: ${adjustment.description || 'Recurring deduction'}`,
        amount: 0,
        charge_party: adjustment.charge_party || 'driver',
        apply_to: adjustment.apply_to || 'primary_payee',
        source_reference_id: adjustment.source_reference_id,
        source_reference_type: adjustment.source_reference_type || 'recurring_deduction_rule',
        status: 'applied',
        created_by: settlement.created_by || null
      });
    }
  }

  if (adjustment.source_type === 'scheduled_rule') {
    await knex('settlement_adjustment_items')
      .where({ id: adjustmentId, settlement_id: settlementId })
      .update({
        status: 'removed',
        updated_at: knex.fn.now()
      });
  } else {
    await knex('settlement_adjustment_items').where({ id: adjustmentId, settlement_id: settlementId }).del();
  }

  await recalcAndUpdateSettlement(knex, settlementId);
}

async function restoreScheduledAdjustment(knex, settlementId, adjustmentId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) throw new Error('Settlement not found');
  if (['approved', 'paid', 'void'].includes(settlement.settlement_status)) throw new Error('Settlement is locked');

  const adjustment = await knex('settlement_adjustment_items')
    .where({ id: adjustmentId, settlement_id: settlementId, source_type: 'scheduled_rule' })
    .first();
  if (!adjustment) throw new Error('Scheduled adjustment not found');

  const applyTo = adjustment.apply_to || 'primary_payee';

  if (adjustment.source_reference_id) {
    await knex('settlement_adjustment_items')
      .where({
        settlement_id: settlementId,
        source_type: 'scheduled_rule_removed',
        source_reference_id: adjustment.source_reference_id,
        apply_to: applyTo
      })
      .del();
  }

  await knex('settlement_adjustment_items')
    .where({ id: adjustmentId, settlement_id: settlementId })
    .update({
      status: 'applied',
      updated_at: knex.fn.now()
    });

  await recalcAndUpdateSettlement(knex, settlementId);
}

async function approveSettlement(knex, settlementId, userId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) throw new Error('Settlement not found');
  if (settlement.settlement_status === 'void') throw new Error('Cannot approve voided settlement');
  await knex('settlements').where({ id: settlementId }).update({
    settlement_status: 'approved',
    approved_by: userId,
    approved_at: knex.fn.now()
  });
  return knex('settlements').where({ id: settlementId }).first();
}

async function voidSettlement(knex, settlementId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) throw new Error('Settlement not found');
  await knex('settlements').where({ id: settlementId }).update({ settlement_status: 'void' });

  // FN-578: Reset linked fuel and toll transactions so they can be re-used in a new settlement
  await knex('fuel_transactions')
    .where({ settlement_id: settlementId, settlement_link_status: 'linked' })
    .update({
      settlement_id: null,
      settlement_link_status: 'none',
      updated_at: knex.fn.now()
    });

  await knex('toll_transactions')
    .where({ settlement_id: settlementId, settlement_link_status: 'linked' })
    .update({
      settlement_id: null,
      settlement_adjustment_item_id: null,
      settlement_link_status: 'none',
      updated_at: knex.fn.now()
    });

  return knex('settlements').where({ id: settlementId }).first();
}

async function listSettlements(knex, filters = {}, context = null) {
  let q = knex('settlements as s')
    .select(
      's.*',
      'pp.period_start',
      'pp.period_end',
      'pp.status as period_status',
      knex.raw("concat_ws(' ', d.first_name, d.last_name) as driver_name"),
      knex.raw("concat_ws(' ', d.first_name, d.last_name) as payable_to_name"),
      'primary_payee.name as primary_payee_name',
      'additional_payee.name as additional_payee_name'
    )
    .leftJoin('payroll_periods as pp', 'pp.id', 's.payroll_period_id')
    .leftJoin('drivers as d', 'd.id', 's.driver_id')
    .leftJoin('payees as primary_payee', 'primary_payee.id', 's.primary_payee_id')
    .leftJoin('payees as additional_payee', 'additional_payee.id', 's.additional_payee_id');

  q = q.modify((qb) => {
    applyTenantFilter(qb, context, 's.tenant_id');
    applyEntityFilter(qb, context, 's.operating_entity_id');
  });

  if (filters.driver_id) q = q.where('s.driver_id', filters.driver_id);
  if (filters.payroll_period_id) q = q.where('s.payroll_period_id', filters.payroll_period_id);
  if (filters.settlement_status) q = q.where('s.settlement_status', filters.settlement_status);
  if (filters.settlement_number) q = q.where('s.settlement_number', 'ilike', `%${filters.settlement_number}%`);

  q = q.orderBy('s.created_at', 'desc');
  if (filters.limit) q = q.limit(Math.min(Number(filters.limit) || 50, 100));
  if (filters.offset) q = q.offset(Number(filters.offset) || 0);

  return q;
}

module.exports = {
  getActiveCompensationProfile,
  ensureActiveCompensationProfile,
  getActivePayeeAssignment,
  getEligibleLoads,
  getRecurringDeductionsForPeriod,
  getAlreadySettledLoadIds,
  createDraftSettlement,
  recalcAndUpdateSettlement,
  consumeFuelForSettlement,
  consumeTollsForSettlement,
  addLoadToSettlement,
  removeLoadFromSettlement,
  addAdjustment,
  removeAdjustment,
  restoreScheduledAdjustment,
  approveSettlement,
  voidSettlement,
  listSettlements
};
