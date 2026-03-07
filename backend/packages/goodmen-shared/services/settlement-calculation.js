/**
 * Settlement calculation engine.
 * Uses snapshots (compensation profile + pay basis at settlement time) so future
 * profile changes do not alter past settlements.
 *
 * Pay models:
 * - per_mile: driver_pay = loaded_miles * cents_per_mile
 * - percentage: driver_pay = gross * (percentage_rate / 100)
 * - flat_weekly: one earning per period (flat_weekly_amount)
 * - flat_per_load: one earning per load (flat_per_load_amount)
 *
 * Deductions applied per expense_responsibility_profiles and recurring_deduction_rules.
 * Additional payee split: explicit amounts stored on settlement; formulas TBD.
 */

/**
 * Compute driver pay for a single load given pay model snapshot.
 * @param {Object} opts - { payModel, centsPerMile, percentageRate, flatPerLoadAmount, gross, loadedMiles }
 * @returns {{ driverPay: number, additionalPayeePay: number }}
 */
function computeLoadPay(opts) {
  const {
    payModel,
    centsPerMile = 0,
    percentageRate = 0,
    flatPerLoadAmount = 0,
    gross = 0,
    loadedMiles = 0
  } = opts;

  let driverPay = 0;
  const additionalPayeePay = 0; // split logic later

  switch (payModel) {
    case 'per_mile':
      driverPay = (Number(loadedMiles) || 0) * (Number(centsPerMile) || 0) / 100;
      break;
    case 'percentage':
      driverPay = (Number(gross) || 0) * (Number(percentageRate) || 0) / 100;
      break;
    case 'flat_per_load':
      driverPay = Number(flatPerLoadAmount) || 0;
      break;
    case 'flat_weekly':
      // Handled at settlement level (one amount per period), not per load
      driverPay = 0;
      break;
    default:
      driverPay = 0;
  }

  return { driverPay, additionalPayeePay };
}

/**
 * Compute subtotal from load items and flat_weekly if applicable.
 * @param {Object} opts - { loadItems[], payModel, flatWeeklyAmount }
 * @returns {{ subtotalGross: number, subtotalDriverPay: number, subtotalAdditionalPayee: number }}
 */
function computeSubtotals(opts) {
  const { loadItems = [], payModel = 'per_mile', flatWeeklyAmount = 0 } = opts;

  let subtotalGross = 0;
  let subtotalDriverPay = 0;
  let subtotalAdditionalPayee = 0;

  for (const item of loadItems) {
    subtotalGross += Number(item.gross_amount) || 0;
    subtotalDriverPay += Number(item.driver_pay_amount) || 0;
    subtotalAdditionalPayee += Number(item.additional_payee_amount) || 0;
  }

  if (payModel === 'flat_weekly' && flatWeeklyAmount) {
    subtotalDriverPay += Number(flatWeeklyAmount);
  }

  return { subtotalGross, subtotalDriverPay, subtotalAdditionalPayee };
}

/**
 * Apply total_deductions and total_advances to get net pay.
 * @param {Object} opts - { subtotalDriverPay, subtotalAdditionalPayee, totalDeductions, totalAdvances }
 * @returns {{ netPayDriver: number, netPayAdditionalPayee: number }}
 */
function computeNetPay(opts) {
  const {
    subtotalDriverPay = 0,
    subtotalAdditionalPayee = 0,
    totalDeductions = 0,
    totalAdvances = 0
  } = opts;

  const netPayDriver = Math.max(0, Number(subtotalDriverPay) - Number(totalDeductions) - Number(totalAdvances));
  const netPayAdditionalPayee = Math.max(0, Number(subtotalAdditionalPayee));

  return { netPayDriver, netPayAdditionalPayee };
}

/**
 * Recalculate settlement totals from load items + adjustment items.
 * @param {Object} settlement - settlement row with id
 * @param {Array} loadItems - settlement_load_items rows
 * @param {Array} adjustmentItems - settlement_adjustment_items rows
 * @param {Object} profileSnapshot - compensation profile snapshot (flat_weekly_amount, etc.)
 * @returns {Object} updated totals for settlement
 */
function recalculateSettlementTotals(settlement, loadItems, adjustmentItems, profileSnapshot = {}) {
  const payModel = (profileSnapshot && profileSnapshot.pay_model) || 'per_mile';
  const flatWeeklyAmount = profileSnapshot.flat_weekly_amount || 0;

  const { subtotalGross, subtotalDriverPay, subtotalAdditionalPayee } = computeSubtotals({
    loadItems,
    payModel,
    flatWeeklyAmount
  });

  let totalDeductions = 0;
  let totalAdvances = 0;
  for (const adj of adjustmentItems || []) {
    const amt = Math.abs(Number(adj.amount) || 0);
    const type = (adj.item_type || '').toLowerCase();
    if (type === 'deduction') totalDeductions += amt;
    else if (type === 'advance') totalAdvances += amt;
  }

  const { netPayDriver, netPayAdditionalPayee } = computeNetPay({
    subtotalDriverPay,
    subtotalAdditionalPayee,
    totalDeductions,
    totalAdvances
  });

  return {
    subtotal_gross: subtotalGross,
    subtotal_driver_pay: subtotalDriverPay,
    subtotal_additional_payee: subtotalAdditionalPayee,
    total_deductions: totalDeductions,
    total_advances: totalAdvances,
    net_pay_driver: netPayDriver,
    net_pay_additional_payee: netPayAdditionalPayee
  };
}

module.exports = {
  computeLoadPay,
  computeSubtotals,
  computeNetPay,
  recalculateSettlementTotals
};
