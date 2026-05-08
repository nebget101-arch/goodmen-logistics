'use strict';

/**
 * FN-1538 — Tests for the state-aware tax engine in work-orders.service.
 *
 * Exercises the pure helper `computeWorkOrderTotals` so we can cover the
 * algorithm without spinning up a DB or a transaction. Each `state_tax_rules`
 * row is constructed inline; the live seed in `07_state_tax_rules_seed.js`
 * is the production source of truth.
 *
 * Scenarios from the FN-1521 acceptance criteria:
 *   - TX (parts taxable @ 6.25%, labor not, fees not)
 *   - CA (everything taxable @ 7.25%)
 *   - MT (no sales tax — rate 0, all flags false)
 *   - FL (parts taxable @ 6%, labor not, fees not)
 *   - manual override (user-supplied rate; per-component flags from rule)
 *   - no rule for a state (legacy 8.5% on per-line `taxable` flags)
 *   - missing location_id (skip tax — rate 0, fallback_reason="no-location")
 *   - missing state on location (legacy 8.5%, fallback_reason="no-state")
 *   - discount apportioned proportionally to taxable subtotal
 *
 * Run: cd backend/packages/goodmen-shared && node --test test/work-orders-tax.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { computeWorkOrderTotals, LEGACY_FALLBACK_TAX_RATE } =
  require('../services/work-orders.service');

function rule({ state_code, state_name = state_code, rate, labor = false, parts = true, fees = false }) {
  return {
    state_code,
    state_name,
    default_sales_tax_rate: rate,
    labor_taxable: labor,
    parts_taxable: parts,
    fees_taxable: fees
  };
}

const LABOR_TAXABLE = [{ line_total: 200, taxable: true }];   // 1 hr @ $200
const PARTS_TAXABLE = [{ line_total: 1000, taxable: true }];  // $1000 in parts
const FEES_TAXABLE = [{ amount: 50, taxable: true }];         // $50 shop fee

const NO_DISCOUNT = { discountType: 'NONE', discountValue: 0 };

function close(actual, expected, eps = 0.005) {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${expected}, got ${actual} (delta ${Math.abs(actual - expected)})`
  );
}

describe('computeWorkOrderTotals — state-aware tax engine', () => {
  it('TX: parts taxable @ 6.25%, labor + fees not taxable', () => {
    const out = computeWorkOrderTotals({
      laborLines: LABOR_TAXABLE,
      partLines: PARTS_TAXABLE,
      feeLines: FEES_TAXABLE,
      ...NO_DISCOUNT,
      taxRatePercent: 0,
      taxRateOverride: false,
      rule: rule({ state_code: 'TX', rate: 0.0625, labor: false, parts: true, fees: false }),
      hasLocation: true,
      hasState: true
    });

    // Only $1000 of parts are taxable. 1000 * 0.0625 = 62.50.
    close(out.taxAmount, 62.5);
    close(out.totalAmount, 200 + 1000 + 50 + 62.5);
    assert.strictEqual(out.taxBreakdown.rule_state, 'TX');
    assert.strictEqual(out.taxBreakdown.labor_taxable, false);
    assert.strictEqual(out.taxBreakdown.parts_taxable, true);
    assert.strictEqual(out.taxBreakdown.fees_taxable, false);
    close(out.taxBreakdown.taxable_subtotal, 1000);
    assert.strictEqual(out.taxBreakdown.fallback_reason, null);
    assert.strictEqual(out.taxBreakdown.override, false);
  });

  it('CA: labor + parts + fees all taxable @ 7.25%', () => {
    const out = computeWorkOrderTotals({
      laborLines: LABOR_TAXABLE,
      partLines: PARTS_TAXABLE,
      feeLines: FEES_TAXABLE,
      ...NO_DISCOUNT,
      taxRatePercent: 0,
      taxRateOverride: false,
      rule: rule({ state_code: 'CA', rate: 0.0725, labor: true, parts: true, fees: true }),
      hasLocation: true,
      hasState: true
    });

    // (200 + 1000 + 50) * 0.0725 = 90.625 → 90.63 after round2.
    close(out.taxAmount, 90.63);
    close(out.totalAmount, 1250 + 90.63);
    close(out.taxBreakdown.taxable_subtotal, 1250);
  });

  it('MT: no sales tax — rate 0, all flags false', () => {
    const out = computeWorkOrderTotals({
      laborLines: LABOR_TAXABLE,
      partLines: PARTS_TAXABLE,
      feeLines: FEES_TAXABLE,
      ...NO_DISCOUNT,
      taxRatePercent: 0,
      taxRateOverride: false,
      rule: rule({ state_code: 'MT', rate: 0, labor: false, parts: false, fees: false }),
      hasLocation: true,
      hasState: true
    });

    assert.strictEqual(out.taxAmount, 0);
    close(out.totalAmount, 1250);
    close(out.taxBreakdown.taxable_subtotal, 0);
    assert.strictEqual(out.taxBreakdown.rate, 0);
  });

  it('FL: parts taxable @ 6%', () => {
    const out = computeWorkOrderTotals({
      laborLines: LABOR_TAXABLE,
      partLines: PARTS_TAXABLE,
      feeLines: FEES_TAXABLE,
      ...NO_DISCOUNT,
      taxRatePercent: 0,
      taxRateOverride: false,
      rule: rule({ state_code: 'FL', rate: 0.06, labor: false, parts: true, fees: false }),
      hasLocation: true,
      hasState: true
    });

    close(out.taxAmount, 60); // 1000 * 0.06
    close(out.totalAmount, 1250 + 60);
  });

  it('manual override: rate from override, per-component flags still come from rule', () => {
    // TX rule says only parts taxable. User overrides rate to 10%.
    // Expected: 1000 * 0.10 = $100 tax (parts only — labor + fees still skipped).
    const out = computeWorkOrderTotals({
      laborLines: LABOR_TAXABLE,
      partLines: PARTS_TAXABLE,
      feeLines: FEES_TAXABLE,
      ...NO_DISCOUNT,
      taxRatePercent: 10,
      taxRateOverride: true,
      rule: rule({ state_code: 'TX', rate: 0.0625, labor: false, parts: true, fees: false }),
      hasLocation: true,
      hasState: true
    });

    close(out.taxAmount, 100);
    assert.strictEqual(out.taxBreakdown.override, true);
    assert.strictEqual(out.taxBreakdown.rate, 0.1);
    assert.strictEqual(out.taxBreakdown.parts_taxable, true);
    assert.strictEqual(out.taxBreakdown.labor_taxable, false);
  });

  it('no rule for state: legacy fallback @ 8.5% on per-line taxable flags', () => {
    // No rule. Per-line flags say only parts is taxable. Legacy rate 8.5%.
    const out = computeWorkOrderTotals({
      laborLines: [{ line_total: 200, taxable: false }],
      partLines: [{ line_total: 1000, taxable: true }],
      feeLines: [{ amount: 50, taxable: false }],
      ...NO_DISCOUNT,
      taxRatePercent: 0,
      taxRateOverride: false,
      rule: null,
      hasLocation: true,
      hasState: true
    });

    close(out.taxAmount, 85); // 1000 * 0.085
    assert.strictEqual(out.taxBreakdown.fallback_reason, 'no-rule-for-state');
    assert.strictEqual(out.taxBreakdown.rate, LEGACY_FALLBACK_TAX_RATE);
    assert.strictEqual(out.taxBreakdown.rule_state, null);
  });

  it('no location_id: skip tax (rate=0), fallback_reason "no-location"', () => {
    const out = computeWorkOrderTotals({
      laborLines: LABOR_TAXABLE,
      partLines: PARTS_TAXABLE,
      feeLines: FEES_TAXABLE,
      ...NO_DISCOUNT,
      taxRatePercent: 0,
      taxRateOverride: false,
      rule: null,
      hasLocation: false,
      hasState: false
    });

    assert.strictEqual(out.taxAmount, 0);
    assert.strictEqual(out.taxBreakdown.fallback_reason, 'no-location');
    assert.strictEqual(out.taxBreakdown.rate, 0);
  });

  it('location with no state: legacy 8.5% with fallback_reason "no-state"', () => {
    const out = computeWorkOrderTotals({
      laborLines: [{ line_total: 200, taxable: false }],
      partLines: [{ line_total: 1000, taxable: true }],
      feeLines: [{ amount: 50, taxable: false }],
      ...NO_DISCOUNT,
      taxRatePercent: 0,
      taxRateOverride: false,
      rule: null,
      hasLocation: true,
      hasState: false
    });

    close(out.taxAmount, 85);
    assert.strictEqual(out.taxBreakdown.fallback_reason, 'no-state');
    assert.strictEqual(out.taxBreakdown.rate, LEGACY_FALLBACK_TAX_RATE);
  });

  it('discount apportioned proportionally against taxable subtotal', () => {
    // TX rule: only parts taxable.
    // Subtotal = 1250. 10% off = 125 discount. Parts share of subtotal = 1000/1250 = 0.8,
    // so taxable_after_discount = 1000 - (125 * 0.8) = 900. Tax = 900 * 0.0625 = 56.25.
    const out = computeWorkOrderTotals({
      laborLines: LABOR_TAXABLE,
      partLines: PARTS_TAXABLE,
      feeLines: FEES_TAXABLE,
      discountType: 'PERCENT',
      discountValue: 10,
      taxRatePercent: 0,
      taxRateOverride: false,
      rule: rule({ state_code: 'TX', rate: 0.0625, labor: false, parts: true, fees: false }),
      hasLocation: true,
      hasState: true
    });

    close(out.discountAmount, 125);
    close(out.taxBreakdown.taxable_after_discount, 900);
    close(out.taxAmount, 56.25);
    close(out.totalAmount, 1250 - 125 + 56.25);
  });

  it('CA with explicit override of 0%: zero tax even though rule rate is 7.25%', () => {
    // Confirms override=true with rate=0 means "user explicitly chose 0%",
    // distinct from override=false where 0 would mean "use the rule".
    const out = computeWorkOrderTotals({
      laborLines: LABOR_TAXABLE,
      partLines: PARTS_TAXABLE,
      feeLines: FEES_TAXABLE,
      ...NO_DISCOUNT,
      taxRatePercent: 0,
      taxRateOverride: true,
      rule: rule({ state_code: 'CA', rate: 0.0725, labor: true, parts: true, fees: true }),
      hasLocation: true,
      hasState: true
    });

    assert.strictEqual(out.taxAmount, 0);
    close(out.totalAmount, 1250);
    assert.strictEqual(out.taxBreakdown.override, true);
    assert.strictEqual(out.taxBreakdown.rate, 0);
  });
});
