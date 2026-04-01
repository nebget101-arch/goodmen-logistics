/**
 * Settlement Engine V2 — FN-499
 *
 * Generates dual settlements per truck per pay period:
 *   - Driver settlement  (settlement_type = 'driver')
 *   - Equipment Owner settlement (settlement_type = 'equipment_owner')
 *
 * Owner Operators get a single settlement with 100% expenses.
 * Negative balances roll forward via carried_balance.
 * Driver quit / termination with negative balance creates a settlement_balance_transfers record.
 */

const { recalculateSettlementTotals } = require('./settlement-calculation');
const {
  getActivePayeeAssignment,
  getEligibleLoads,
  getRecurringDeductionsForPeriod
} = require('./settlement-service');
const {
  buildUniqueSettlementNumber,
  insertSettlementWithRetry,
  sanitizeSettlementNumberToken
} = require('./settlement-numbering');
const { getClient } = require('../internal/db');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value).trim();
  const isoPrefix = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix) return isoPrefix[1];
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function applyTenantFilter(qb, context, column = 'tenant_id') {
  if (context?.tenantId) qb.andWhere(column, context.tenantId);
}

function applyEntityFilter(qb, context, column = 'operating_entity_id') {
  if (context?.operatingEntityId) qb.andWhere(column, context.operatingEntityId);
}

const SETTLEMENT_NUMBER_PREFIX = 'STL2';

async function generateV2Number(knex, driver, settlementType) {
  const driverName = [driver?.first_name, driver?.last_name]
    .filter(Boolean).join('_');
  return buildUniqueSettlementNumber(SETTLEMENT_NUMBER_PREFIX, [
    sanitizeSettlementNumberToken(driverName, 'DRIVER'),
    sanitizeSettlementNumberToken(settlementType || 'driver', 'DRIVER')
  ]);
}

/**
 * Get the active expense responsibility profile for a driver as of a given date.
 */
async function getExpenseProfile(knex, driverId, asOfDate) {
  const d = toDateOnly(asOfDate) || toDateOnly(new Date());
  return knex('expense_responsibility_profiles')
    .where({ driver_id: driverId })
    .whereRaw('effective_start_date <= ?', [d])
    .where(function () {
      this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [d]);
    })
    .orderBy('effective_start_date', 'desc')
    .first();
}

/**
 * Get the active compensation profile for a driver as of a given date.
 */
async function getCompensationProfile(knex, driverId, asOfDate) {
  const d = toDateOnly(asOfDate) || toDateOnly(new Date());
  return knex('driver_compensation_profiles')
    .where({ driver_id: driverId, status: 'active' })
    .whereRaw('effective_start_date <= ?', [d])
    .where(function () {
      this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [d]);
    })
    .orderBy('effective_start_date', 'desc')
    .first();
}

/**
 * Find the most recent prior-period settlement for driver+truck (for negative balance rollover).
 */
async function getPriorSettlement(knex, driverId, truckId, settlementType, periodStart) {
  const q = knex('settlements')
    .where({ driver_id: driverId, settlement_type: settlementType })
    .whereNot('settlement_status', 'void')
    .where('date', '<', toDateOnly(periodStart))
    .orderBy('date', 'desc')
    .first();

  if (truckId) {
    q.where('truck_id', truckId);
  }
  return q;
}

/**
 * Resolve expense split ratios from expense_responsibility_profiles.
 * Returns { driverPct, ownerPct } as fractions (0–1).
 * Defaults to 100% driver if no profile found.
 */
function resolveSplitRatios(expenseProfile) {
  if (!expenseProfile) return { driverPct: 1.0, ownerPct: 0.0 };

  const splitType = expenseProfile.split_type || 'percentage';

  if (splitType === 'percentage') {
    const driverPct = Number(expenseProfile.driver_percentage ?? 100) / 100;
    const ownerPct = Math.max(0, 1 - driverPct);
    return { driverPct, ownerPct };
  }

  // For fixed_amount, we still use driver_percentage as the split ratio (owner gets remainder)
  const driverPct = Number(expenseProfile.driver_percentage ?? 100) / 100;
  return { driverPct, ownerPct: Math.max(0, 1 - driverPct) };
}

async function resolveSettlementPayees(knex, driver, period, truck, tenantId) {
  const payeeAssignment = await getActivePayeeAssignment(knex, driver.id, period.period_end);

  let primaryPayeeId = payeeAssignment?.primary_payee_id || null;
  const additionalPayeeId = payeeAssignment?.additional_payee_id || null;

  if (!primaryPayeeId) {
    const driverPayee = await knex('payees')
      .where({ type: 'driver', is_active: true })
      .modify((qb) => applyTenantFilter(qb, { tenantId }))
      .first();
    if (driverPayee) primaryPayeeId = driverPayee.id;
  }

  if (!primaryPayeeId) {
    const payeeName = [driver.first_name, driver.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || `Driver ${String(driver.id).slice(0, 8)}`;
    const [newPayee] = await knex('payees')
      .insert({
        tenant_id: tenantId,
        type: 'driver',
        name: payeeName,
        is_active: true
      })
      .returning('id');
    primaryPayeeId = newPayee.id;

    const effectiveStartDate = toDateOnly(period.period_start) || toDateOnly(new Date());
    await knex('driver_payee_assignments').insert({
      tenant_id: tenantId,
      driver_id: driver.id,
      primary_payee_id: primaryPayeeId,
      rule_type: 'company_truck',
      effective_start_date: effectiveStartDate
    });
  }

  return {
    driverPrimaryPayeeId: primaryPayeeId,
    equipmentOwnerPrimaryPayeeId: additionalPayeeId || truck?.equipment_owner_id || null
  };
}

/**
 * Get unlinked fuel transactions for a truck in a period.
 */
async function getFuelTransactions(knex, truckId, periodStart, periodEnd, tenantId) {
  if (!truckId) return [];
  const q = knex('fuel_transactions')
    .where({ truck_id: truckId, settlement_link_status: 'none' })
    .where('transaction_date', '>=', toDateOnly(periodStart))
    .where('transaction_date', '<=', toDateOnly(periodEnd));
  if (tenantId) q.where('tenant_id', tenantId);
  return q.orderBy('transaction_date', 'asc');
}

/**
 * Get unlinked toll transactions for a truck in a period.
 */
async function getTollTransactions(knex, truckId, driverId, periodStart, periodEnd, tenantId) {
  if (!truckId && !driverId) return [];
  const q = knex('toll_transactions')
    .where({ settlement_link_status: 'none' })
    .where('transaction_date', '>=', toDateOnly(periodStart))
    .where('transaction_date', '<=', toDateOnly(periodEnd));
  if (truckId) q.where('truck_id', truckId);
  else if (driverId) q.where('driver_id', driverId);
  if (tenantId) q.where('tenant_id', tenantId);
  return q.orderBy('transaction_date', 'asc');
}

/**
 * Get approved (not yet applied) balance transfers targeting an equipment owner.
 */
async function getPendingBalanceTransfers(knex, equipmentOwnerId, tenantId) {
  if (!equipmentOwnerId) return [];
  const q = knex('settlement_balance_transfers')
    .where({ target_equipment_owner_id: equipmentOwnerId, status: 'approved' });
  if (tenantId) q.where('tenant_id', tenantId);
  return q;
}

/**
 * Insert a fuel deduction adjustment and link the transaction.
 */
async function insertFuelAdjustment(knex, settlementId, fuel, shareAmount, chargeParty, userId) {
  const description = [
    'Fuel',
    fuel.merchant_name || fuel.location || '',
    fuel.transaction_date ? `(${toDateOnly(fuel.transaction_date)})` : ''
  ].filter(Boolean).join(' — ');

  const [adj] = await knex('settlement_adjustment_items')
    .insert({
      settlement_id: settlementId,
      item_type: 'deduction',
      source_type: 'imported_fuel',
      description,
      amount: shareAmount,
      charge_party: chargeParty,
      apply_to: 'primary_payee',
      source_reference_id: fuel.id,
      source_reference_type: 'fuel_transaction',
      occurrence_date: fuel.transaction_date,
      status: 'applied',
      created_by: userId
    })
    .returning('*');

  await knex('fuel_transactions')
    .where({ id: fuel.id })
    .update({
      settlement_id: settlementId,
      settlement_link_status: 'linked',
      updated_at: knex.fn.now()
    });

  return adj;
}

/**
 * Insert a toll deduction adjustment and link the transaction.
 */
async function insertTollAdjustment(knex, settlementId, toll, shareAmount, chargeParty, userId) {
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
      amount: shareAmount,
      charge_party: chargeParty,
      apply_to: 'primary_payee',
      source_reference_id: toll.id,
      source_reference_type: 'toll_transaction',
      occurrence_date: toll.transaction_date,
      status: 'applied',
      created_by: userId
    })
    .returning('*');

  await knex('toll_transactions')
    .where({ id: toll.id })
    .update({
      settlement_id: settlementId,
      settlement_link_status: 'linked',
      updated_at: knex.fn.now()
    });

  return adj;
}

/**
 * Recalculate and persist settlement totals.
 * Falls back gracefully if recalculateSettlementTotals throws (e.g., columns not yet migrated).
 */
async function recalcV2Settlement(knex, settlementId) {
  try {
    const settlement = await knex('settlements').where({ id: settlementId }).first();
    if (!settlement || settlement.settlement_status === 'void') return;

    const loadItems = await knex('settlement_load_items')
      .where({ settlement_id: settlementId });
    const adjustments = await knex('settlement_adjustment_items')
      .where({ settlement_id: settlementId })
      .whereNot('status', 'removed');

    const gross = loadItems.reduce((s, li) => s + (Number(li.gross_amount) || 0), 0);
    const driverRevenue = loadItems.reduce((s, li) => s + (Number(li.driver_pay_amount) || 0), 0);
    const deductions = adjustments
      .filter((a) => a.item_type === 'deduction')
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const advances = adjustments
      .filter((a) => a.item_type === 'advance')
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const carriedBalance = Number(settlement.carried_balance) || 0;
    const netRaw = driverRevenue - deductions + advances - carriedBalance;
    const netPay = Math.max(0, netRaw);
    const newCarried = netRaw < 0 ? Math.abs(netRaw) : 0;

    await knex('settlements')
      .where({ id: settlementId })
      .update({
        subtotal_gross: gross,
        subtotal_driver_pay: driverRevenue,
        total_deductions: deductions,
        total_advances: advances,
        net_pay_driver: netPay,
        updated_at: knex.fn.now()
      });

    return { netPay, newCarried };
  } catch (err) {
    console.error('[SettlementEngineV2] recalcV2Settlement error:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core: Generate Dual Settlements
// ---------------------------------------------------------------------------

/**
 * Generate dual settlements (Driver + Equipment Owner) for one driver in a pay period.
 * For Owner Operators: generates a single settlement with full expenses.
 *
 * @param {string} payrollPeriodId - Payroll period UUID
 * @param {string} driverId        - Driver UUID
 * @param {string} dateBasis       - 'pickup' | 'delivery'
 * @param {string} userId          - Requesting user UUID
 * @param {object} knex            - Knex instance
 * @param {object} context         - { tenantId, operatingEntityId }
 * @returns {{ driverSettlement: object, eoSettlement: object|null }}
 */
async function generateDualSettlements(payrollPeriodId, driverId, dateBasis = 'pickup', userId, knex, context = null) {
  const tenantId = context?.tenantId || null;
  const operatingEntityId = context?.operatingEntityId || null;
  if (!tenantId || !operatingEntityId) {
    throw new Error('Operating entity context is required for V2 settlement generation');
  }

  const client = await getClient();
  try {
    // --- 1. Load period ---
    const period = await knex('payroll_periods')
      .where({ id: payrollPeriodId })
      .modify((qb) => {
        applyTenantFilter(qb, context, 'payroll_periods.tenant_id');
        applyEntityFilter(qb, context, 'payroll_periods.operating_entity_id');
      })
      .first();
    if (!period) throw new Error('Payroll period not found');
    if (!['draft', 'open'].includes(period.status)) throw new Error('Period not open for settlements');

    const periodStart = toDateOnly(period.period_start);
    const periodEnd = toDateOnly(period.period_end);

    // --- 2. Load driver ---
    const driver = await knex('drivers')
      .where({ id: driverId })
      .modify((qb) => applyTenantFilter(qb, context, 'drivers.tenant_id'))
      .select('id', 'first_name', 'last_name', 'driver_type', 'truck_id', 'pay_basis', 'pay_rate', 'pay_percentage', 'hire_date')
      .first();
    if (!driver) throw new Error('Driver not found');

    const isOwnerOperator = (driver.driver_type || '').toLowerCase() === 'owner_operator';
    const truckId = driver.truck_id || null;

    // --- 3. Load truck + equipment owner info ---
    let truck = null;
    let equipmentOwnerId = null;
    let equipmentOwnerName = null;

    if (truckId) {
      truck = await knex('vehicles').where({ id: truckId }).first();
      if (truck) {
        equipmentOwnerId = truck.equipment_owner_id || null;
        equipmentOwnerName = truck.equipment_owner_name || null;
      }
    }

    // --- 4. Load compensation + expense profiles ---
    const compProfile = await getCompensationProfile(knex, driverId, periodEnd);
    const expenseProfile = await getExpenseProfile(knex, driverId, periodEnd);
    const { driverPct, ownerPct } = resolveSplitRatios(expenseProfile);
    const {
      driverPrimaryPayeeId,
      equipmentOwnerPrimaryPayeeId
    } = await resolveSettlementPayees(knex, driver, period, truck, tenantId);

    // --- 5. Get eligible loads ---
    const eligibleLoads = await getEligibleLoads(knex, client, driverId, periodStart, periodEnd, dateBasis, context);
    if (!eligibleLoads.length) {
      throw new Error(`No eligible loads found for driver ${driverId} in period ${periodStart} → ${periodEnd}`);
    }

    const grossTotal = eligibleLoads.reduce((s, l) => s + (Number(l.rate) || 0), 0);

    // --- 6. Get fuel + toll transactions for the truck ---
    const fuelTxns = await getFuelTransactions(knex, truckId, periodStart, periodEnd, tenantId);
    const tollTxns = await getTollTransactions(knex, truckId, driverId, periodStart, periodEnd, tenantId);

    const totalFuel = fuelTxns.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const totalTolls = tollTxns.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    // --- 7. Get recurring deductions ---
    const allRecurring = await getRecurringDeductionsForPeriod(knex, driverId, periodStart, periodEnd, []);

    // --- 8. Get prior carried balance ---
    const priorDriverSettlement = await getPriorSettlement(knex, driverId, truckId, 'driver', periodStart);
    const priorDriverCarried = priorDriverSettlement && Number(priorDriverSettlement.net_pay_driver) < 0
      ? Math.abs(Number(priorDriverSettlement.net_pay_driver))
      : 0;
    const priorDriverCarriedFromId = priorDriverCarried > 0 ? priorDriverSettlement.id : null;

    // --- 9. Determine driver revenue split ---
    let driverRevenueRaw;
    if (isOwnerOperator) {
      // OO gets a single settlement; percentage from comp profile
      const ooRate = Number(compProfile?.percentage_rate || driver.pay_percentage || 88);
      driverRevenueRaw = grossTotal * (ooRate / 100);
    } else {
      driverRevenueRaw = grossTotal * driverPct;
    }
    const driverRevenue = Math.max(0, driverRevenueRaw);

    // --- 10. Create DRIVER settlement ---
    const driverFuelShare = isOwnerOperator ? totalFuel : totalFuel * driverPct;
    const driverTollShare = isOwnerOperator ? totalTolls : totalTolls * driverPct;

    const driverSettlementBasePayload = {
      tenant_id: tenantId,
      operating_entity_id: operatingEntityId,
      payroll_period_id: payrollPeriodId,
      driver_id: driverId,
      compensation_profile_id: compProfile?.id ?? null,
      primary_payee_id: driverPrimaryPayeeId,
      settlement_status: 'preparing',
      settlement_type: 'driver',
      truck_id: truckId,
      equipment_owner_id: equipmentOwnerId,
      date: periodEnd,
      carried_balance: priorDriverCarried,
      carried_balance_from_settlement_id: priorDriverCarriedFromId,
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
      settlement_number: await generateV2Number(knex, driver, 'driver')
    }));

    // Load items for driver settlement
    for (const load of eligibleLoads) {
      const gross = Number(load.rate) || 0;
      let driverLoadPay;
      if (isOwnerOperator) {
        const ooRate = Number(compProfile?.percentage_rate || driver.pay_percentage || 88);
        driverLoadPay = gross * (ooRate / 100);
      } else {
        driverLoadPay = gross * driverPct;
      }
      await knex('settlement_load_items').insert({
        settlement_id: driverSettlement.id,
        load_id: load.id,
        pickup_date: load.pickup_date,
        delivery_date: load.delivery_date,
        loaded_miles: load.loaded_miles ?? null,
        pay_basis_snapshot: {
          pay_model: compProfile?.pay_model || 'percentage',
          percentage_rate: isOwnerOperator
            ? (compProfile?.percentage_rate || driver.pay_percentage || 88)
            : (driverPct * 100),
          settlement_type: 'driver'
        },
        gross_amount: gross,
        driver_pay_amount: driverLoadPay,
        additional_payee_amount: 0,
        included_by: userId
      });
    }

    // Fuel deductions for driver
    for (const fuel of fuelTxns) {
      const share = Math.round((Number(fuel.amount) || 0) * (isOwnerOperator ? 1.0 : driverPct) * 100) / 100;
      if (share === 0) continue;
      await insertFuelAdjustment(knex, driverSettlement.id, fuel, share,
        isOwnerOperator ? 'driver' : (driverPct < 1 ? 'shared' : 'driver'), userId);
    }

    // Toll deductions for driver
    for (const toll of tollTxns) {
      const share = Math.round((Number(toll.amount) || 0) * (isOwnerOperator ? 1.0 : driverPct) * 100) / 100;
      if (share === 0) continue;
      await insertTollAdjustment(knex, driverSettlement.id, toll, share,
        isOwnerOperator ? 'driver' : (driverPct < 1 ? 'shared' : 'driver'), userId);
    }

    // Recurring deductions for driver
    for (const rule of allRecurring) {
      const appliesWhen = (rule.applies_when || 'always').toLowerCase();
      if (appliesWhen === 'equipment_owner_only') continue;
      const amount = Number(rule.amount) || 0;
      if (amount === 0) continue;
      await knex('settlement_adjustment_items').insert({
        settlement_id: driverSettlement.id,
        item_type: 'deduction',
        source_type: 'scheduled_rule',
        description: rule.description || 'Recurring deduction',
        amount: isOwnerOperator ? amount : (amount * driverPct),
        charge_party: 'driver',
        apply_to: 'primary_payee',
        source_reference_id: rule.id,
        source_reference_type: 'recurring_deduction_rule',
        status: 'applied',
        created_by: userId
      });
    }

    // Carried balance deduction (if prior period had negative net)
    if (priorDriverCarried > 0) {
      await knex('settlement_adjustment_items').insert({
        settlement_id: driverSettlement.id,
        item_type: 'deduction',
        source_type: 'carried_balance',
        description: `Carried negative balance from ${priorDriverSettlement.settlement_number || 'prior settlement'}`,
        amount: priorDriverCarried,
        charge_party: 'driver',
        apply_to: 'primary_payee',
        source_reference_id: priorDriverSettlement.id,
        source_reference_type: 'settlement',
        status: 'applied',
        created_by: userId
      });
    }

    const driverRecalc = await recalcV2Settlement(knex, driverSettlement.id);

    const shouldCreateEquipmentOwnerSettlement = Boolean(
      !isOwnerOperator
      && truckId
      && equipmentOwnerId
      && equipmentOwnerPrimaryPayeeId
    );

    // Match the legacy flow: OO drivers and trucks without owner-payee wiring stay single-settlement.
    if (!shouldCreateEquipmentOwnerSettlement) {
      const finalDriver = await knex('settlements').where({ id: driverSettlement.id }).first();
      return { driverSettlement: finalDriver, eoSettlement: null };
    }

    // --- 11. Create EQUIPMENT OWNER settlement ---
    const eoRevenueRaw = grossTotal * ownerPct;
    const eoRevenue = Math.max(0, eoRevenueRaw);
    const eoFuelShare = totalFuel * ownerPct;
    const eoTollShare = totalTolls * ownerPct;

    // Prior EO carried balance
    const priorEoSettlement = await getPriorSettlement(knex, driverId, truckId, 'equipment_owner', periodStart);
    const priorEoCarried = priorEoSettlement && Number(priorEoSettlement.net_pay_driver) < 0
      ? Math.abs(Number(priorEoSettlement.net_pay_driver))
      : 0;
    const priorEoCarriedFromId = priorEoCarried > 0 ? priorEoSettlement.id : null;

    // Approved balance transfers from quit drivers targeting this EO
    const balanceTransfers = await getPendingBalanceTransfers(knex, equipmentOwnerId, tenantId);
    const totalTransfers = balanceTransfers.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    const eoSettlementBasePayload = {
      tenant_id: tenantId,
      operating_entity_id: operatingEntityId,
      payroll_period_id: payrollPeriodId,
      driver_id: driverId,
      compensation_profile_id: compProfile?.id ?? null,
      primary_payee_id: equipmentOwnerPrimaryPayeeId,
      settlement_status: 'preparing',
      settlement_type: 'equipment_owner',
      truck_id: truckId,
      equipment_owner_id: equipmentOwnerId,
      date: periodEnd,
      carried_balance: priorEoCarried,
      carried_balance_from_settlement_id: priorEoCarriedFromId,
      subtotal_gross: 0,
      subtotal_driver_pay: 0,
      subtotal_additional_payee: 0,
      total_deductions: 0,
      total_advances: 0,
      net_pay_driver: 0,
      net_pay_additional_payee: 0,
      created_by: userId
    };

    const eoSettlement = await insertSettlementWithRetry(knex, async () => ({
      ...eoSettlementBasePayload,
      settlement_number: await generateV2Number(knex, driver, 'equipment_owner')
    }));

    // EO load items (owner's revenue share)
    for (const load of eligibleLoads) {
      const gross = Number(load.rate) || 0;
      const eoLoadPay = gross * ownerPct;
      await knex('settlement_load_items').insert({
        settlement_id: eoSettlement.id,
        load_id: load.id,
        pickup_date: load.pickup_date,
        delivery_date: load.delivery_date,
        loaded_miles: load.loaded_miles ?? null,
        pay_basis_snapshot: {
          pay_model: 'percentage',
          percentage_rate: ownerPct * 100,
          settlement_type: 'equipment_owner'
        },
        gross_amount: gross,
        driver_pay_amount: eoLoadPay,
        additional_payee_amount: 0,
        included_by: userId
      });
    }

    // EO fuel deductions (owner's share)
    for (const fuel of fuelTxns) {
      const share = Math.round((Number(fuel.amount) || 0) * ownerPct * 100) / 100;
      if (share === 0) continue;
      await insertFuelAdjustment(knex, eoSettlement.id, fuel, share,
        ownerPct < 1 ? 'shared' : 'equipment_owner', userId);
    }

    // EO toll deductions (owner's share)
    for (const toll of tollTxns) {
      const share = Math.round((Number(toll.amount) || 0) * ownerPct * 100) / 100;
      if (share === 0) continue;
      await insertTollAdjustment(knex, eoSettlement.id, toll, share,
        ownerPct < 1 ? 'shared' : 'equipment_owner', userId);
    }

    // Recurring deductions for EO
    for (const rule of allRecurring) {
      const appliesWhen = (rule.applies_when || 'always').toLowerCase();
      if (appliesWhen === 'driver_only') continue;
      const amount = Number(rule.amount) || 0;
      if (amount === 0) continue;
      const eoShare = appliesWhen === 'equipment_owner_only' ? amount : (amount * ownerPct);
      await knex('settlement_adjustment_items').insert({
        settlement_id: eoSettlement.id,
        item_type: 'deduction',
        source_type: 'scheduled_rule',
        description: rule.description || 'Recurring deduction',
        amount: eoShare,
        charge_party: 'equipment_owner',
        apply_to: 'primary_payee',
        source_reference_id: rule.id,
        source_reference_type: 'recurring_deduction_rule',
        status: 'applied',
        created_by: userId
      });
    }

    // EO carried balance deduction
    if (priorEoCarried > 0) {
      await knex('settlement_adjustment_items').insert({
        settlement_id: eoSettlement.id,
        item_type: 'deduction',
        source_type: 'carried_balance',
        description: `Carried negative balance from ${priorEoSettlement.settlement_number || 'prior settlement'}`,
        amount: priorEoCarried,
        charge_party: 'equipment_owner',
        apply_to: 'primary_payee',
        source_reference_id: priorEoSettlement.id,
        source_reference_type: 'settlement',
        status: 'applied',
        created_by: userId
      });
    }

    // Balance transfers from quit drivers
    for (const transfer of balanceTransfers) {
      const amount = Number(transfer.amount) || 0;
      if (amount === 0) continue;
      await knex('settlement_adjustment_items').insert({
        settlement_id: eoSettlement.id,
        item_type: 'deduction',
        source_type: 'balance_transfer',
        description: `Driver quit balance transfer — ${transfer.reason || 'driver_quit'}`,
        amount,
        charge_party: 'equipment_owner',
        apply_to: 'primary_payee',
        source_reference_id: transfer.id,
        source_reference_type: 'settlement_balance_transfer',
        status: 'applied',
        created_by: userId
      });

      // Mark transfer as applied
      await knex('settlement_balance_transfers')
        .where({ id: transfer.id })
        .update({
          status: 'applied',
          target_settlement_id: eoSettlement.id,
          reviewed_at: knex.fn.now(),
          reviewed_by: userId,
          updated_at: knex.fn.now()
        });
    }

    await recalcV2Settlement(knex, eoSettlement.id);

    const finalDriver = await knex('settlements').where({ id: driverSettlement.id }).first();
    const finalEo = await knex('settlements').where({ id: eoSettlement.id }).first();

    return { driverSettlement: finalDriver, eoSettlement: finalEo };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Balance Transfer CRUD
// ---------------------------------------------------------------------------

/**
 * Create a pending balance transfer (driver quit / terminated with negative balance).
 */
async function createBalanceTransfer(data, userId, knex, context) {
  const tenantId = context?.tenantId;
  if (!tenantId) throw new Error('Tenant context required');

  const { sourceDriverId, sourceSettlementId, targetEquipmentOwnerId, amount, reason } = data;
  if (!amount || Number(amount) <= 0) throw new Error('Transfer amount must be positive');
  if (!reason) throw new Error('Transfer reason is required');

  const [transfer] = await knex('settlement_balance_transfers')
    .insert({
      tenant_id: tenantId,
      source_driver_id: sourceDriverId || null,
      source_settlement_id: sourceSettlementId || null,
      target_equipment_owner_id: targetEquipmentOwnerId || null,
      amount: Number(amount),
      reason,
      status: 'pending_approval',
      requested_at: knex.fn.now(),
      requested_by: userId
    })
    .returning('*');

  return transfer;
}

/**
 * Approve a balance transfer.
 */
async function approveBalanceTransfer(transferId, userId, reviewNotes, knex, context) {
  const tenantId = context?.tenantId;
  const transfer = await knex('settlement_balance_transfers')
    .where({ id: transferId })
    .modify((qb) => { if (tenantId) qb.where('tenant_id', tenantId); })
    .first();

  if (!transfer) throw new Error('Balance transfer not found');
  if (transfer.status !== 'pending_approval') throw new Error(`Cannot approve transfer in status: ${transfer.status}`);

  const [updated] = await knex('settlement_balance_transfers')
    .where({ id: transferId })
    .update({
      status: 'approved',
      reviewed_at: knex.fn.now(),
      reviewed_by: userId,
      review_notes: reviewNotes || null,
      updated_at: knex.fn.now()
    })
    .returning('*');

  return updated;
}

/**
 * Reject a balance transfer.
 */
async function rejectBalanceTransfer(transferId, userId, reviewNotes, knex, context) {
  const tenantId = context?.tenantId;
  const transfer = await knex('settlement_balance_transfers')
    .where({ id: transferId })
    .modify((qb) => { if (tenantId) qb.where('tenant_id', tenantId); })
    .first();

  if (!transfer) throw new Error('Balance transfer not found');
  if (!['pending_approval', 'approved'].includes(transfer.status)) {
    throw new Error(`Cannot reject transfer in status: ${transfer.status}`);
  }

  const [updated] = await knex('settlement_balance_transfers')
    .where({ id: transferId })
    .update({
      status: 'rejected',
      reviewed_at: knex.fn.now(),
      reviewed_by: userId,
      review_notes: reviewNotes || null,
      updated_at: knex.fn.now()
    })
    .returning('*');

  return updated;
}

/**
 * List balance transfers for the tenant, optionally filtered.
 */
async function listBalanceTransfers(filters, knex, context) {
  const tenantId = context?.tenantId;
  const q = knex('settlement_balance_transfers as sbt')
    .select('sbt.*')
    .orderBy('sbt.requested_at', 'desc');

  if (tenantId) q.where('sbt.tenant_id', tenantId);
  if (filters?.status) q.where('sbt.status', filters.status);
  if (filters?.targetEquipmentOwnerId) q.where('sbt.target_equipment_owner_id', filters.targetEquipmentOwnerId);
  if (filters?.sourceDriverId) q.where('sbt.source_driver_id', filters.sourceDriverId);

  return q;
}

module.exports = {
  generateDualSettlements,
  createBalanceTransfer,
  approveBalanceTransfer,
  rejectBalanceTransfer,
  listBalanceTransfers
};
