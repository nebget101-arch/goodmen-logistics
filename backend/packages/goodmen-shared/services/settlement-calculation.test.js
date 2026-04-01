/**
 * Unit tests for settlement calculation engine.
 * Run: node --test services/settlement-calculation.test.js (from goodmen-shared)
 * Or: npm test (if test script added to package.json)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  computeLoadPay,
  computeSubtotals,
  computeNetPay,
  recalculateSettlementTotals
} = require('./settlement-calculation');

describe('computeLoadPay', () => {
  it('per_mile: driver pay = loaded_miles * cents_per_mile / 100', () => {
    const { driverPay } = computeLoadPay({
      payModel: 'per_mile',
      gross: 1000,
      loadedMiles: 500,
      centsPerMile: 50
    });
    assert.strictEqual(driverPay, 250);
  });

  it('percentage: driver pay = gross * percentage_rate / 100', () => {
    const { driverPay } = computeLoadPay({
      payModel: 'percentage',
      gross: 2000,
      percentageRate: 88
    });
    assert.strictEqual(driverPay, 1760);
  });

  it('flat_per_load: driver pay = flat_per_load_amount', () => {
    const { driverPay } = computeLoadPay({
      payModel: 'flat_per_load',
      gross: 1000,
      flatPerLoadAmount: 450
    });
    assert.strictEqual(driverPay, 450);
  });

  it('flat_weekly: per-load contribution is 0', () => {
    const { driverPay } = computeLoadPay({
      payModel: 'flat_weekly',
      gross: 1000
    });
    assert.strictEqual(driverPay, 0);
  });

  it('unknown pay model returns 0', () => {
    const { driverPay } = computeLoadPay({ payModel: 'unknown', gross: 1000 });
    assert.strictEqual(driverPay, 0);
  });

  it('uses equipment owner percentage for additional payee subtotal when present', () => {
    const { driverPay, additionalPayeePay } = computeLoadPay({
      payModel: 'percentage',
      gross: 2000,
      percentageRate: 80,
      hasAdditionalPayee: true,
      equipmentOwnerPercentage: 20,
      additionalPayeeRate: 5
    });

    assert.strictEqual(driverPay, 1600);
    assert.strictEqual(additionalPayeePay, 400);
  });

  it('falls back to additional payee rate when equipment owner percentage is absent', () => {
    const { driverPay, additionalPayeePay } = computeLoadPay({
      payModel: 'percentage',
      gross: 2000,
      percentageRate: 80,
      hasAdditionalPayee: true,
      equipmentOwnerPercentage: null,
      additionalPayeeRate: 5
    });

    assert.strictEqual(driverPay, 1600);
    assert.strictEqual(additionalPayeePay, 100);
  });

  it('allows company-retained remainder when driver and EO percentages do not sum to 100', () => {
    const { driverPay, additionalPayeePay } = computeLoadPay({
      payModel: 'percentage',
      gross: 1700,
      percentageRate: 44,
      hasAdditionalPayee: true,
      equipmentOwnerPercentage: 44
    });

    assert.strictEqual(driverPay, 748);
    assert.strictEqual(additionalPayeePay, 748);
  });
});

describe('computeSubtotals', () => {
  it('sums load items and adds flat_weekly when pay_model is flat_weekly', () => {
    const loadItems = [
      { gross_amount: 1000, driver_pay_amount: 400, additional_payee_amount: 0 },
      { gross_amount: 1500, driver_pay_amount: 600, additional_payee_amount: 0 }
    ];
    const r = computeSubtotals({ loadItems, payModel: 'per_mile', flatWeeklyAmount: 0 });
    assert.strictEqual(r.subtotalGross, 2500);
    assert.strictEqual(r.subtotalDriverPay, 1000);
    assert.strictEqual(r.subtotalAdditionalPayee, 0);

    const r2 = computeSubtotals({ loadItems, payModel: 'flat_weekly', flatWeeklyAmount: 1200 });
    assert.strictEqual(r2.subtotalDriverPay, 1000 + 1200);
  });
});

describe('computeNetPay', () => {
  it('net = subtotal - deductions - advances, never negative', () => {
    const { netPayDriver } = computeNetPay({
      subtotalDriverPay: 2000,
      totalDeductions: 300,
      totalAdvances: 100
    });
    assert.strictEqual(netPayDriver, 1600);
  });

  it('net caps at 0 when deductions exceed subtotal', () => {
    const { netPayDriver } = computeNetPay({
      subtotalDriverPay: 500,
      totalDeductions: 600,
      totalAdvances: 0
    });
    assert.strictEqual(netPayDriver, 0);
  });
});

describe('recalculateSettlementTotals', () => {
  it('totals match load items + flat_weekly and deduction adjustments', () => {
    const settlement = { id: 's1', compensation_profile_id: 'cp1' };
    const loadItems = [
      { gross_amount: 1000, driver_pay_amount: 400, additional_payee_amount: 0 },
      { gross_amount: 1000, driver_pay_amount: 400, additional_payee_amount: 0 }
    ];
    const adjustmentItems = [
      { item_type: 'deduction', amount: 100 },
      { item_type: 'deduction', amount: 50 }
    ];
    const profileSnapshot = { pay_model: 'per_mile', flat_weekly_amount: 0 };
    const totals = recalculateSettlementTotals(settlement, loadItems, adjustmentItems, profileSnapshot);
    assert.strictEqual(totals.subtotal_gross, 2000);
    assert.strictEqual(totals.subtotal_driver_pay, 800);
    assert.strictEqual(totals.total_deductions, 150);
    assert.strictEqual(totals.net_pay_driver, 650);
  });

  it('PDF payload totals consistency: net_pay_driver = subtotal_driver_pay - total_deductions - total_advances', () => {
    const settlement = {};
    const loadItems = [{ gross_amount: 3000, driver_pay_amount: 2640, additional_payee_amount: 0 }];
    const adjustmentItems = [
      { item_type: 'deduction', amount: 200 },
      { item_type: 'advance', amount: 100 }
    ];
    const totals = recalculateSettlementTotals(settlement, loadItems, adjustmentItems, { pay_model: 'percentage' });
    assert.strictEqual(totals.subtotal_driver_pay, 2640);
    assert.strictEqual(totals.total_deductions, 200);
    assert.strictEqual(totals.total_advances, 100);
    assert.strictEqual(totals.net_pay_driver, 2640 - 200 - 100);
  });

  it('tracks equipment owner revenue in additional payee totals', () => {
    const settlement = { settlement_type: 'equipment_owner' };
    const loadItems = [
      { gross_amount: 1700, driver_pay_amount: 0, additional_payee_amount: 561 },
      { gross_amount: 2500, driver_pay_amount: 0, additional_payee_amount: 825 }
    ];
    const adjustmentItems = [
      { item_type: 'deduction', amount: 100 },
      { item_type: 'advance', amount: 25 }
    ];
    const totals = recalculateSettlementTotals(settlement, loadItems, adjustmentItems, { pay_model: 'percentage' });
    assert.strictEqual(totals.subtotal_gross, 4200);
    assert.strictEqual(totals.subtotal_driver_pay, 0);
    assert.strictEqual(totals.subtotal_additional_payee, 1386);
    assert.strictEqual(totals.net_pay_additional_payee, 1386 - 100 - 25);
  });
});
