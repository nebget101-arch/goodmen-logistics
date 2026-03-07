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

const DELIVERED_STATUSES = ['DELIVERED'];
const SETTLEMENT_NUMBER_PREFIX = 'STL';

async function getActiveCompensationProfile(knex, driverId, asOfDate) {
  const d = (asOfDate || new Date()).toISOString().slice(0, 10);
  const row = await knex('driver_compensation_profiles')
    .where({ driver_id: driverId, status: 'active' })
    .whereRaw('effective_start_date <= ?', [d])
    .where(function () {
      this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [d]);
    })
    .orderBy('effective_start_date', 'desc')
    .first();
  return row || null;
}

async function getActivePayeeAssignment(knex, driverId, asOfDate) {
  const d = (asOfDate || new Date()).toISOString().slice(0, 10);
  const row = await knex('driver_payee_assignments')
    .where({ driver_id: driverId })
    .whereRaw('effective_start_date <= ?', [d])
    .where(function () {
      this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [d]);
    })
    .orderBy('effective_start_date', 'desc')
    .first();
  return row || null;
}

async function getLoadedMilesForLoad(client, loadId) {
  const stops = await client.query(
    `SELECT stop_type, zip FROM load_stops WHERE load_id = $1 ORDER BY sequence ASC, stop_type`,
    [loadId]
  );
  const pickups = stops.rows.filter((s) => (s.stop_type || '').toUpperCase() === 'PICKUP');
  const deliveries = stops.rows.filter((s) => (s.stop_type || '').toUpperCase() === 'DELIVERY');
  const firstZip = pickups[0]?.zip?.trim();
  const lastZip = deliveries.length ? deliveries[deliveries.length - 1]?.zip?.trim() : null;
  if (!firstZip || !lastZip) return 0;
  return getDrivingDistanceMiles(firstZip, lastZip);
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
 * Eligible loads: driver_id match, status delivered, pickup/delivery date in range, not already settled.
 * dateBasis: 'pickup' | 'delivery'
 */
async function getEligibleLoads(knex, client, driverId, periodStart, periodEnd, dateBasis = 'pickup') {
  const settledIds = await getAlreadySettledLoadIds(knex, driverId);
  const dateCol = dateBasis === 'delivery' ? 'delivery_date' : 'pickup_date';

  const loads = await knex('loads as l')
    .select(
      'l.id',
      'l.load_number',
      'l.rate',
      'l.driver_id',
      knex.raw(`(
        SELECT MIN(s.stop_date) FROM load_stops s
        WHERE s.load_id = l.id AND s.stop_type = 'PICKUP'
      ) as pickup_date`),
      knex.raw(`(
        SELECT MAX(s.stop_date) FROM load_stops s
        WHERE s.load_id = l.id AND s.stop_type = 'DELIVERY'
      ) as delivery_date`)
    )
    .where('l.driver_id', driverId)
    .whereIn('l.status', DELIVERED_STATUSES)
    .whereNotNull('l.rate')
    .modify((q) => {
      if (settledIds.length) q.whereNotIn('l.id', settledIds);
    });

  const periodStartStr = (periodStart || '').toString().slice(0, 10);
  const periodEndStr = (periodEnd || '').toString().slice(0, 10);
  const filtered = [];
  for (const row of loads) {
    const dateVal = dateBasis === 'delivery' ? row.delivery_date : row.pickup_date;
    const d = dateVal ? new Date(dateVal).toISOString().slice(0, 10) : null;
    if (d && d >= periodStartStr && d <= periodEndStr) {
      const loadedMiles = await getLoadedMilesForLoad(client, row.id);
      filtered.push({ ...row, loaded_miles: loadedMiles });
    }
  }
  return filtered;
}

/** Recurring deductions applicable for driver in date range. */
async function getRecurringDeductionsForPeriod(knex, driverId, periodStart, periodEnd) {
  const startStr = (periodStart || '').toString().slice(0, 10);
  const endStr = (periodEnd || '').toString().slice(0, 10);
  return knex('recurring_deduction_rules')
    .where('enabled', true)
    .whereRaw('start_date <= ?', [endStr])
    .where(function () {
      this.whereNull('end_date').orWhereRaw('end_date >= ?', [startStr]);
    })
    .andWhere(function () {
      this.whereNull('driver_id').orWhere('driver_id', driverId);
    });
}

async function generateSettlementNumber(knex) {
  const row = await knex('settlements')
    .orderBy('created_at', 'desc')
    .first();
  const seq = row ? parseInt((row.settlement_number || '').replace(/\D/g, ''), 10) + 1 : 1;
  return `${SETTLEMENT_NUMBER_PREFIX}-${Date.now().toString(36).toUpperCase()}-${seq}`;
}

/**
 * Create draft settlement: resolve profile + payees, get eligible loads + recurring deductions,
 * build load items with pay snapshot, insert adjustments for recurring deductions, recalc totals.
 */
async function createDraftSettlement(payrollPeriodId, driverId, dateBasis, userId, knex) {
  const client = await getClient();
  try {
    const period = await knex('payroll_periods').where({ id: payrollPeriodId }).first();
    if (!period) throw new Error('Payroll period not found');
    if (!['draft', 'open'].includes(period.status)) throw new Error('Period not open for new settlements');

    const profile = await getActiveCompensationProfile(knex, driverId, period.period_end);
    const payeeAssignment = await getActivePayeeAssignment(knex, driverId, period.period_end);

    let primaryPayeeId = payeeAssignment?.primary_payee_id;
    let additionalPayeeId = payeeAssignment?.additional_payee_id ?? null;

    if (!primaryPayeeId) {
      const driverPayee = await knex('payees').where({ type: 'driver', is_active: true }).first();
      if (driverPayee) primaryPayeeId = driverPayee.id;
    }
    if (!primaryPayeeId) {
      const driver = await knex('drivers').where({ id: driverId }).select('first_name', 'last_name').first();
      if (!driver) throw new Error('Driver not found');
      const payeeName = [driver.first_name, driver.last_name].filter(Boolean).join(' ').trim() || `Driver ${driverId.slice(0, 8)}`;
      const [newPayee] = await knex('payees').insert({
        type: 'driver',
        name: payeeName,
        is_active: true
      }).returning('id');
      primaryPayeeId = newPayee.id;
      const periodStart = period.period_start ? new Date(period.period_start).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      await knex('driver_payee_assignments').insert({
        driver_id: driverId,
        primary_payee_id: primaryPayeeId,
        rule_type: 'company_truck',
        effective_start_date: periodStart
      });
    }

    const eligibleLoads = await getEligibleLoads(
      knex,
      client,
      driverId,
      period.period_start,
      period.period_end,
      dateBasis
    );

    const profileSnapshot = profile ? {
      pay_model: profile.pay_model,
      percentage_rate: profile.percentage_rate,
      cents_per_mile: profile.cents_per_mile,
      flat_weekly_amount: profile.flat_weekly_amount,
      flat_per_load_amount: profile.flat_per_load_amount
    } : { pay_model: 'per_mile', cents_per_mile: 0 };

    const settlementNumber = await generateSettlementNumber(knex);
    const settlementDate = period.period_end;

    const [settlement] = await knex('settlements').insert({
      payroll_period_id: payrollPeriodId,
      driver_id: driverId,
      compensation_profile_id: profile?.id ?? null,
      primary_payee_id: primaryPayeeId,
      additional_payee_id: additionalPayeeId,
      settlement_number: settlementNumber,
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
    }).returning('*');

    for (const load of eligibleLoads) {
      const gross = Number(load.rate) || 0;
      const { driverPay } = computeLoadPay({
        payModel: profileSnapshot.pay_model,
        centsPerMile: profileSnapshot.cents_per_mile,
        percentageRate: profileSnapshot.percentage_rate,
        flatPerLoadAmount: profileSnapshot.flat_per_load_amount,
        gross,
        loadedMiles: load.loaded_miles || 0
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
        additional_payee_amount: 0,
        included_by: userId
      });
    }

    const recurring = await getRecurringDeductionsForPeriod(
      knex,
      driverId,
      period.period_start,
      period.period_end
    );
    for (const rule of recurring) {
      await knex('settlement_adjustment_items').insert({
        settlement_id: settlement.id,
        item_type: 'deduction',
        source_type: 'scheduled_rule',
        description: rule.description || rule.source_type || 'Recurring deduction',
        amount: Number(rule.amount) || 0,
        charge_party: 'driver',
        apply_to: 'primary_payee',
        status: 'applied',
        created_by: userId
      });
    }

    await recalcAndUpdateSettlement(knex, settlement.id);
    return knex('settlements').where({ id: settlement.id }).first();
  } finally {
    client.release();
  }
}

async function recalcAndUpdateSettlement(knex, settlementId) {
  const settlement = await knex('settlements').where({ id: settlementId }).first();
  if (!settlement) throw new Error('Settlement not found');
  if (settlement.settlement_status === 'void') return settlement;

  const loadItems = await knex('settlement_load_items').where({ settlement_id: settlementId });
  const adjustmentItems = await knex('settlement_adjustment_items').where({ settlement_id: settlementId });
  const profile = settlement.compensation_profile_id
    ? await knex('driver_compensation_profiles').where({ id: settlement.compensation_profile_id }).first()
    : null;
  const profileSnapshot = profile ? {
    pay_model: profile.pay_model,
    flat_weekly_amount: profile.flat_weekly_amount
  } : {};

  const totals = recalculateSettlementTotals(settlement, loadItems, adjustmentItems, profileSnapshot);
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
    const snapshot = profile ? {
      pay_model: profile.pay_model,
      percentage_rate: profile.percentage_rate,
      cents_per_mile: profile.cents_per_mile,
      flat_per_load_amount: profile.flat_per_load_amount
    } : {};
    const gross = Number(load.rate) || 0;
    const { driverPay } = computeLoadPay({
      ...snapshot,
      gross,
      loadedMiles
    });
    const stops = await client.query(
      'SELECT stop_type, stop_date FROM load_stops WHERE load_id = $1 ORDER BY sequence',
      [loadId]
    );
    const pickups = stops.rows.filter((s) => (s.stop_type || '').toUpperCase() === 'PICKUP');
    const deliveries = stops.rows.filter((s) => (s.stop_type || '').toUpperCase() === 'DELIVERY');
    await knex('settlement_load_items').insert({
      settlement_id: settlementId,
      load_id: loadId,
      pickup_date: pickups[0]?.stop_date ?? null,
      delivery_date: deliveries.length ? deliveries[deliveries.length - 1].stop_date : null,
      loaded_miles: loadedMiles,
      pay_basis_snapshot: snapshot,
      gross_amount: gross,
      driver_pay_amount: driverPay,
      additional_payee_amount: 0,
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
  await knex('settlement_adjustment_items').where({ id: adjustmentId, settlement_id: settlementId }).del();
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
  return knex('settlements').where({ id: settlementId }).first();
}

async function listSettlements(knex, filters = {}) {
  let q = knex('settlements as s')
    .select(
      's.*',
      'pp.period_start',
      'pp.period_end',
      'pp.status as period_status'
    )
    .leftJoin('payroll_periods as pp', 'pp.id', 's.payroll_period_id');

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
  getActivePayeeAssignment,
  getEligibleLoads,
  getRecurringDeductionsForPeriod,
  getAlreadySettledLoadIds,
  createDraftSettlement,
  recalcAndUpdateSettlement,
  addLoadToSettlement,
  removeLoadFromSettlement,
  addAdjustment,
  removeAdjustment,
  approveSettlement,
  voidSettlement,
  listSettlements
};
