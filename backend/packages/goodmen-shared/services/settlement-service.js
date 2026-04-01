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
  resolveVariableExpenseSplit,
  shouldApplyRecurringDeductionForSettlement,
  shouldIncludeRecurringDeductionRule,
  resolveRecurringDeductionApplyTo
} = require('./settlement-recurring-deductions');
const {
  applyLeaseDeductionForSettlement
} = require('./lease-financing-service');
const {
  mergeCompensationProfileWithFallback
} = require('./driver-compensation-profile-sync');

const SETTLEMENT_NUMBER_PREFIX = 'STL';
let payeesColumnSetCache = null;
let settlementsColumnSetCache = null;

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

async function getSettlementsColumnSet(knex) {
  if (settlementsColumnSetCache) return settlementsColumnSetCache;
  const rows = await knex('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: 'settlements' });
  settlementsColumnSetCache = new Set(rows.map((row) => row.column_name));
  return settlementsColumnSetCache;
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

async function getLatestCompensationProfile(knex, driverId) {
  const row = await knex('driver_compensation_profiles')
    .where({ driver_id: driverId })
    .orderByRaw(`CASE WHEN status = 'active' THEN 0 ELSE 1 END`)
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
    equipment_owner_percentage:
      driverRow.equipment_owner_percentage
      ?? driverRow.equipmentOwnerPercentage
      ?? null,
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
  const latestKnownProfile = await getLatestCompensationProfile(knex, driverRow.id);

  if (profile) {
    return mergeCompensationProfileWithFallback(profile, latestKnownProfile, driverRow);
  }

  const insertPayload = buildCompensationProfileInsert({
    ...driverRow,
    equipment_owner_percentage:
      driverRow?.equipment_owner_percentage
      ?? driverRow?.equipmentOwnerPercentage
      ?? latestKnownProfile?.equipment_owner_percentage
      ?? null
  }, asOfDate);
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

  return mergeCompensationProfileWithFallback(created, latestKnownProfile, driverRow);
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
      'l.truck_id',
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

async function generateSettlementNumberWithType(_knex, partyName, period, typeToken) {
  const displayName = String(partyName || '').trim() || 'PAYEE';
  const periodStart = toDateOnly(period?.period_start) || 'START';
  const periodEnd = toDateOnly(period?.period_end) || 'END';
  return buildUniqueSettlementNumber(SETTLEMENT_NUMBER_PREFIX, [
    sanitizeSettlementNumberToken(displayName, 'PAYEE'),
    sanitizeSettlementNumberToken(`${periodStart}_TO_${periodEnd}`, 'NO_PERIOD'),
    sanitizeSettlementNumberToken(typeToken || 'SETTLEMENT', 'SETTLEMENT')
  ]);
}

async function updateSettlementTotalsFromRows(knex, settlementId, profileSnapshot) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  const loadItems = await knex('settlement_load_items').where({ settlement_id: settlementId });
  const adjustmentItems = await knex('settlement_adjustment_items').where({ settlement_id: settlementId });
  const totals = recalculateSettlementTotals(settlement, loadItems, adjustmentItems, profileSnapshot);
  await knex('settlements').where({ id: settlementId }).update({
    ...totals,
    updated_at: knex.fn.now()
  });
  return knex('settlements').where({ id: settlementId }).first();
}

async function syncPairedSettlementIds(knex, firstSettlementId, secondSettlementId) {
  const settlementColumns = await getSettlementsColumnSet(knex);
  if (!settlementColumns.has('paired_settlement_id')) return;

  await knex('settlements')
    .where({ id: firstSettlementId })
    .update({ paired_settlement_id: secondSettlementId, updated_at: knex.fn.now() });
  await knex('settlements')
    .where({ id: secondSettlementId })
    .update({ paired_settlement_id: firstSettlementId, updated_at: knex.fn.now() });
}

async function resolveVariableExpenseSettlementTargets(knex, settlementId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) throw new Error('Settlement not found');

  const pairedSettlement = settlement.paired_settlement_id
    ? await knex('settlements').where({ id: settlement.paired_settlement_id }).first()
    : null;

  if (!pairedSettlement) {
    return {
      selectedSettlement: settlement,
      driverSettlement: settlement,
      ownerSettlement: null,
      hasPair: false
    };
  }

  const driverSettlement = settlement.settlement_type === 'equipment_owner'
    ? pairedSettlement
    : settlement;
  const ownerSettlement = settlement.settlement_type === 'equipment_owner'
    ? settlement
    : pairedSettlement;

  return {
    selectedSettlement: settlement,
    driverSettlement,
    ownerSettlement,
    hasPair: driverSettlement?.settlement_type === 'driver' && ownerSettlement?.settlement_type === 'equipment_owner'
  };
}

async function insertVariableExpenseAdjustment(knex, data) {
  const [adjustment] = await knex('settlement_adjustment_items')
    .insert(data)
    .returning('*');
  return adjustment;
}

async function applyVariableExpenseToSettlement(knex, settlementId, options = {}) {
  const {
    expenseType,
    amount,
    description,
    occurrenceDate = null,
    userId = null,
    sourceType,
    sourceReferenceId = null,
    sourceReferenceType = null
  } = options;

  const targets = await resolveVariableExpenseSettlementTargets(knex, settlementId);
  const asOf = toDateOnly(occurrenceDate)
    || toDateOnly(targets.selectedSettlement?.date)
    || toDateOnly(new Date());
  const expenseProfile = await getActiveExpenseResponsibilityProfile(
    knex,
    targets.selectedSettlement.driver_id,
    asOf
  );
  const split = resolveVariableExpenseSplit(expenseType, expenseProfile, amount);

  if (split.responsibility === 'company') {
    return {
      split,
      primarySettlementId: targets.driverSettlement.id,
      primaryAdjustment: null,
      mirroredAdjustment: null
    };
  }

  const basePayload = {
    item_type: 'deduction',
    source_type: sourceType,
    description,
    occurrence_date: occurrenceDate,
    status: 'applied',
    created_by: userId,
    source_reference_id: sourceReferenceId,
    source_reference_type: sourceReferenceType
  };

  if (!targets.hasPair) {
    const amountForSingleSettlement = split.responsibility === 'owner'
      ? split.ownerAmount
      : split.driverAmount;
    if (!amountForSingleSettlement) {
      return {
        split,
        primarySettlementId: targets.driverSettlement.id,
        primaryAdjustment: null,
        mirroredAdjustment: null
      };
    }

    const primaryAdjustment = await insertVariableExpenseAdjustment(knex, {
      ...basePayload,
      settlement_id: targets.selectedSettlement.id,
      amount: amountForSingleSettlement,
      charge_party: split.chargeParty,
      apply_to: 'primary_payee'
    });

    return {
      split,
      primarySettlementId: targets.selectedSettlement.id,
      primaryAdjustment,
      mirroredAdjustment: null
    };
  }

  let primaryAdjustment = null;
  let mirroredAdjustment = null;

  if (split.driverAmount > 0) {
    primaryAdjustment = await insertVariableExpenseAdjustment(knex, {
      ...basePayload,
      settlement_id: targets.driverSettlement.id,
      amount: split.driverAmount,
      charge_party: split.chargeParty,
      apply_to: 'primary_payee'
    });
  }

  if (split.ownerAmount > 0) {
    mirroredAdjustment = await insertVariableExpenseAdjustment(knex, {
      ...basePayload,
      settlement_id: targets.ownerSettlement.id,
      amount: split.ownerAmount,
      charge_party: split.responsibility === 'shared' ? 'shared' : 'equipment_owner',
      apply_to: 'primary_payee'
    });
  }

  return {
    split,
    primarySettlementId: targets.driverSettlement.id,
    primaryAdjustment,
    mirroredAdjustment
  };
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

  const defaultSplit = resolveVariableExpenseSplit('fuel', expenseProfile, 1);
  if (defaultSplit.responsibility === 'company') return [];

  // 6. Create adjustment items and link fuel transactions
  const createdAdjustments = [];
  for (const fuel of fuels) {
    const fuelAmount = Number(fuel.amount) || 0;
    if (fuelAmount === 0) continue;

    const description = [
      'Fuel',
      fuel.vendor_name || fuel.provider_name || '',
      fuel.location_name ? `(${fuel.location_name})` : '',
      fuel.transaction_date ? `${toDateOnly(fuel.transaction_date)}` : ''
    ].filter(Boolean).join(' — ');

    const result = await applyVariableExpenseToSettlement(knex, settlementId, {
      expenseType: 'fuel',
      amount: fuelAmount,
      description,
      occurrenceDate: fuel.transaction_date,
      userId,
      sourceType: 'imported_fuel',
      sourceReferenceId: fuel.id,
      sourceReferenceType: 'fuel_transaction'
    });

    // Link the fuel transaction to this settlement
    // Note: fuel_transactions has no settlement_adjustment_item_id column
    await knex('fuel_transactions')
      .where({ id: fuel.id })
      .update({
        settlement_id: result.primarySettlementId,
        settlement_link_status: 'linked',
        updated_at: knex.fn.now()
      });

    if (result.primaryAdjustment) createdAdjustments.push(result.primaryAdjustment);
    if (result.mirroredAdjustment) createdAdjustments.push(result.mirroredAdjustment);
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

  const defaultSplit = resolveVariableExpenseSplit('toll', expenseProfile, 1);
  if (defaultSplit.responsibility === 'company') return [];

  // 6. Create adjustment items and link toll transactions
  const createdAdjustments = [];
  for (const toll of tolls) {
    const tollAmount = Number(toll.amount) || 0;
    if (tollAmount === 0) continue;

    const description = [
      'Toll',
      toll.plaza_name || toll.provider_name || '',
      toll.transaction_date ? `(${toDateOnly(toll.transaction_date)})` : ''
    ].filter(Boolean).join(' — ');

    const result = await applyVariableExpenseToSettlement(knex, settlementId, {
      expenseType: 'toll',
      amount: tollAmount,
      description,
      occurrenceDate: toll.transaction_date,
      userId,
      sourceType: 'imported_toll',
      sourceReferenceId: toll.id,
      sourceReferenceType: 'toll_transaction'
    });

    // Link the toll transaction to this settlement
    await knex('toll_transactions')
      .where({ id: toll.id })
      .update({
        settlement_id: result.primarySettlementId,
        settlement_adjustment_item_id: result.primaryAdjustment?.id || null,
        settlement_link_status: 'linked',
        updated_at: knex.fn.now()
      });

    if (result.primaryAdjustment) createdAdjustments.push(result.primaryAdjustment);
    if (result.mirroredAdjustment) createdAdjustments.push(result.mirroredAdjustment);
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
      .select('id', 'first_name', 'last_name', 'pay_basis', 'pay_rate', 'pay_percentage', 'driver_type', 'hire_date', 'truck_id')
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

    const settlementColumns = await getSettlementsColumnSet(knex);
    const hasPairedSettlementId = settlementColumns.has('paired_settlement_id');
    const isOwnerOperator = (driver.driver_type || '').toString().toLowerCase() === 'owner_operator';
    const truckId = driver.truck_id || null;
    const truck = truckId
      ? await knex('vehicles')
        .where({ id: truckId })
        .modify((qb) => applyTenantFilter(qb, context, 'vehicles.tenant_id'))
        .first()
      : null;
    const equipmentOwnerId = truck?.equipment_owner_id || null;
    const ownerPayeeId = additionalPayeeId || equipmentOwnerId || null;
    const shouldCreatePairedSettlements = Boolean(
      hasPairedSettlementId
      && !isOwnerOperator
      && truckId
      && equipmentOwnerId
      && ownerPayeeId
    );

    if (shouldCreatePairedSettlements) {
      const ownerPayee = await knex('payees').where({ id: ownerPayeeId }).first();
      const driverSettlementBasePayload = {
        tenant_id: tenantId,
        operating_entity_id: operatingEntityId,
        payroll_period_id: payrollPeriodId,
        driver_id: driverId,
        compensation_profile_id: profile?.id ?? null,
        primary_payee_id: primaryPayeeId,
        additional_payee_id: null,
        settlement_type: 'driver',
        equipment_owner_id: equipmentOwnerId,
        truck_id: truckId,
        settlement_status: 'preparing',
        date: period.period_end,
        subtotal_gross: 0,
        subtotal_driver_pay: 0,
        subtotal_additional_payee: 0,
        total_deductions: 0,
        total_advances: 0,
        net_pay_driver: 0,
        net_pay_additional_payee: 0,
        created_by: userId
      };
      const eoSettlementBasePayload = {
        tenant_id: tenantId,
        operating_entity_id: operatingEntityId,
        payroll_period_id: payrollPeriodId,
        driver_id: driverId,
        compensation_profile_id: profile?.id ?? null,
        primary_payee_id: ownerPayeeId,
        additional_payee_id: null,
        settlement_type: 'equipment_owner',
        equipment_owner_id: equipmentOwnerId,
        truck_id: truckId,
        settlement_status: 'preparing',
        date: period.period_end,
        subtotal_gross: 0,
        subtotal_driver_pay: 0,
        subtotal_additional_payee: 0,
        total_deductions: 0,
        total_advances: 0,
        net_pay_driver: 0,
        net_pay_additional_payee: 0,
        created_by: userId
      };

      const driverSettlement = await insertSettlementWithRetry(knex, async () => ({
        ...driverSettlementBasePayload,
        settlement_number: await generateSettlementNumberWithType(
          knex,
          [driver.first_name, driver.last_name].filter(Boolean).join(' '),
          period,
          'DRV'
        )
      }));
      const eoSettlement = await insertSettlementWithRetry(knex, async () => ({
        ...eoSettlementBasePayload,
        settlement_number: await generateSettlementNumberWithType(
          knex,
          ownerPayee?.name || truck?.equipment_owner_name || 'Equipment Owner',
          period,
          'EO'
        )
      }));
      await syncPairedSettlementIds(knex, driverSettlement.id, eoSettlement.id);

      for (const load of eligibleLoads) {
        const gross = Number(load.rate) || 0;
        const pairedPay = computeLoadPay({
          payModel: profileSnapshot.pay_model,
          centsPerMile: profileSnapshot.cents_per_mile,
          percentageRate: profileSnapshot.percentage_rate,
          flatPerLoadAmount: profileSnapshot.flat_per_load_amount,
          gross,
          loadedMiles: load.loaded_miles || 0,
          hasAdditionalPayee: true,
          additionalPayeeRate: profileSnapshot.additional_payee_rate,
          equipmentOwnerPercentage: profileSnapshot.equipment_owner_percentage
        });
        const driverSnapshot = { ...profileSnapshot, settlement_type: 'driver' };
        const eoSnapshot = { ...profileSnapshot, settlement_type: 'equipment_owner' };

        await knex('settlement_load_items').insert({
          settlement_id: driverSettlement.id,
          load_id: load.id,
          pickup_date: load.pickup_date,
          delivery_date: load.delivery_date,
          loaded_miles: load.loaded_miles ?? null,
          pay_basis_snapshot: driverSnapshot,
          gross_amount: gross,
          driver_pay_amount: pairedPay.driverPay,
          additional_payee_amount: 0,
          included_by: userId
        });
        await knex('settlement_load_items').insert({
          settlement_id: eoSettlement.id,
          load_id: load.id,
          pickup_date: load.pickup_date,
          delivery_date: load.delivery_date,
          loaded_miles: load.loaded_miles ?? null,
          pay_basis_snapshot: eoSnapshot,
          gross_amount: gross,
          driver_pay_amount: 0,
          additional_payee_amount: pairedPay.additionalPayeePay,
          included_by: userId
        });
      }

      const expenseProfile = await getActiveExpenseResponsibilityProfile(knex, driverId, period.period_end);
      const recurring = await getRecurringDeductionsForPeriod(
        knex,
        driverId,
        period.period_start,
        period.period_end,
        normalizeRecurringDeductionPayeeIds([primaryPayeeId, ownerPayeeId], payeeAssignment)
      );
      logTiming('recurring-deductions-resolved', { recurringCount: recurring.length, pairedMode: true });

      for (const rule of recurring) {
        const applyTo = resolveRecurringDeductionApplyTo(rule, {
          primaryPayeeId,
          additionalPayeeId: ownerPayeeId
        });
        if (!applyTo) continue;
        if (!shouldApplyRecurringDeductionForSettlement(rule, applyTo, {
          expenseProfile,
          hasLoadItems: eligibleLoads.length > 0
        })) {
          continue;
        }

        const targetSettlementId = applyTo === 'additional_payee' ? eoSettlement.id : driverSettlement.id;
        await knex('settlement_adjustment_items').insert({
          settlement_id: targetSettlementId,
          item_type: 'deduction',
          source_type: 'scheduled_rule',
          description: rule.description || rule.source_type || 'Recurring deduction',
          amount: Number(rule.amount) || 0,
          charge_party: applyTo === 'additional_payee' ? 'equipment_owner' : 'driver',
          apply_to: 'primary_payee',
          source_reference_id: rule.id,
          source_reference_type: 'recurring_deduction_rule',
          status: 'applied',
          created_by: userId
        });
      }

      await consumeFuelForSettlement(
        knex,
        driverSettlement.id,
        driverId,
        period.period_start,
        period.period_end,
        userId,
        tenantId
      );
      logTiming('fuel-consumed', { pairedMode: true, targetSettlement: 'driver' });
      await consumeTollsForSettlement(
        knex,
        driverSettlement.id,
        driverId,
        period.period_start,
        period.period_end,
        userId,
        tenantId
      );
      logTiming('tolls-consumed', { pairedMode: true, targetSettlement: 'driver' });

      const finalDriverSettlement = await updateSettlementTotalsFromRows(knex, driverSettlement.id, { ...profileSnapshot, settlement_type: 'driver' });
      await updateSettlementTotalsFromRows(knex, eoSettlement.id, { ...profileSnapshot, settlement_type: 'equipment_owner' });
      logTiming('settlement-recalculated', { pairedMode: true });
      return finalDriverSettlement;
    }

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
  const isEquipmentOwnerSettlement = settlement.settlement_type === 'equipment_owner';
  const isPairedDriverSettlement = settlement.settlement_type === 'driver' && !!settlement.paired_settlement_id;
  
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
  const effectivePrimaryPayeeId = isEquipmentOwnerSettlement
    ? (settlement.primary_payee_id || payeeAssignment?.additional_payee_id || null)
    : (settlement.primary_payee_id || payeeAssignment?.primary_payee_id || null);
  const effectiveAdditionalPayeeId = isEquipmentOwnerSettlement
    ? null
    : (isPairedDriverSettlement ? null : (settlement.additional_payee_id || payeeAssignment?.additional_payee_id || null));

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
      if (isEquipmentOwnerSettlement && applyTo !== 'additional_payee') {
        continue;
      }
      if (isPairedDriverSettlement && applyTo === 'additional_payee') {
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
        charge_party: isEquipmentOwnerSettlement ? 'equipment_owner' : 'driver',
        apply_to: isEquipmentOwnerSettlement ? 'primary_payee' : applyTo,
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

  const hasAdditionalPayee = isEquipmentOwnerSettlement
    ? true
    : (!!effectiveAdditionalPayeeId || (Number(additionalPayeeRate) || 0) > 0);

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
      equipment_owner_percentage: itemSnapshot.equipment_owner_percentage ?? profileSnapshot.equipment_owner_percentage ?? null,
      settlement_type: itemSnapshot.settlement_type || settlement.settlement_type || 'driver'
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
    const targetDriverPay = isEquipmentOwnerSettlement ? 0 : driverPay;
    const targetAdditionalPayee = isEquipmentOwnerSettlement
      ? additionalPayeePay
      : (isPairedDriverSettlement ? 0 : additionalPayeePay);

    console.log('[Settlement Recalc] load pay', {
      settlementId,
      loadId: item.load_id,
      gross: Number(item.gross_amount) || 0,
      rateUsed: itemSnapshot.additional_payee_rate ?? profileSnapshot.additional_payee_rate,
      driverPay: targetDriverPay,
      additionalPayeePay: targetAdditionalPayee,
      previousAdditionalPayeeAmount: Number(item.additional_payee_amount || 0)
    });

    if (
      Number(item.driver_pay_amount) !== Number(targetDriverPay) ||
      Number(item.additional_payee_amount || 0) !== Number(targetAdditionalPayee) ||
      JSON.stringify(itemSnapshot || {}) !== JSON.stringify(refreshedSnapshot)
    ) {
      await knex('settlement_load_items')
        .where({ id: item.id })
        .update({
          pay_basis_snapshot: refreshedSnapshot,
          driver_pay_amount: targetDriverPay,
          additional_payee_amount: targetAdditionalPayee,
          updated_at: knex.fn.now()
        });
    }

    recalculatedLoadItems.push({
      ...item,
      pay_basis_snapshot: refreshedSnapshot,
      driver_pay_amount: targetDriverPay,
      additional_payee_amount: targetAdditionalPayee
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
    if (
      ['imported_fuel', 'imported_toll'].includes(adjustment.source_type)
      && settlement.paired_settlement_id
      && adjustment.source_reference_id
    ) {
      await knex('settlement_adjustment_items')
        .where({ settlement_id: settlement.paired_settlement_id })
        .andWhere({
          source_type: adjustment.source_type,
          source_reference_id: adjustment.source_reference_id,
          source_reference_type: adjustment.source_reference_type
        })
        .del();

      if (adjustment.source_reference_type === 'fuel_transaction') {
        await knex('fuel_transactions')
          .where({ id: adjustment.source_reference_id })
          .update({
            settlement_id: null,
            settlement_link_status: 'none',
            updated_at: knex.fn.now()
          });
      }

      if (adjustment.source_reference_type === 'toll_transaction') {
        await knex('toll_transactions')
          .where({ id: adjustment.source_reference_id })
          .update({
            settlement_id: null,
            settlement_adjustment_item_id: null,
            settlement_link_status: 'none',
            updated_at: knex.fn.now()
          });
      }
    }

    await knex('settlement_adjustment_items').where({ id: adjustmentId, settlement_id: settlementId }).del();
  }

  await recalcAndUpdateSettlement(knex, settlementId);
  if (settlement.paired_settlement_id) {
    await recalcAndUpdateSettlement(knex, settlement.paired_settlement_id);
  }
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
  const settlementColumns = await getSettlementsColumnSet(knex);
  const hasPairedSettlementId = settlementColumns.has('paired_settlement_id');
  let q = knex('settlements as s')
    .select(
      's.*',
      'pp.period_start',
      'pp.period_end',
      'pp.status as period_status',
      knex.raw("concat_ws(' ', d.first_name, d.last_name) as driver_name"),
      knex.raw(`
        CASE
          WHEN COALESCE(s.settlement_type, 'driver') = 'equipment_owner'
            THEN COALESCE(primary_payee.name, additional_payee.name, concat_ws(' ', d.first_name, d.last_name))
          ELSE COALESCE(primary_payee.name, concat_ws(' ', d.first_name, d.last_name))
        END as payable_to_name
      `),
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
  if (filters.settlement_type) q = q.where('s.settlement_type', filters.settlement_type);
  if (filters.truck_id) q = q.where('s.truck_id', filters.truck_id);
  if (filters.equipment_owner_id) q = q.where('s.equipment_owner_id', filters.equipment_owner_id);
  if (filters.paired_settlement_id && hasPairedSettlementId) {
    q = q.where('s.paired_settlement_id', filters.paired_settlement_id);
  }
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
  applyVariableExpenseToSettlement,
  addLoadToSettlement,
  removeLoadFromSettlement,
  addAdjustment,
  removeAdjustment,
  restoreScheduledAdjustment,
  approveSettlement,
  voidSettlement,
  listSettlements
};
