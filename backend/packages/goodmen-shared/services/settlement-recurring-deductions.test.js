const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  getExpenseResponsibilityFieldForSourceType,
  normalizeRecurringDeductionPayeeIds,
  resolveSpecificExpenseResponsibility,
  resolveRecurringDeductionBackfillStartDate,
  resolveScheduledDeductionAmount,
  resolveVariableExpenseSplit,
  shouldApplyRecurringDeductionForSettlement,
  shouldIncludeRecurringDeductionRule,
  resolveRecurringDeductionApplyTo
} = require('./settlement-recurring-deductions');

describe('normalizeRecurringDeductionPayeeIds', () => {
  it('merges explicit payee ids with active assignment ids', () => {
    const payeeIds = normalizeRecurringDeductionPayeeIds(
      ['primary-1', '', 'primary-1'],
      {
        primary_payee_id: 'primary-1',
        additional_payee_id: 'owner-1'
      }
    );

    assert.deepStrictEqual(payeeIds, ['primary-1', 'owner-1']);
  });
});

describe('resolveRecurringDeductionApplyTo', () => {
  it('defaults untargeted rules to primary payee', () => {
    const applyTo = resolveRecurringDeductionApplyTo({}, {
      primaryPayeeId: 'primary-1',
      additionalPayeeId: 'owner-1'
    });

    assert.strictEqual(applyTo, 'primary_payee');
  });

  it('matches additional payee scoped rules', () => {
    const applyTo = resolveRecurringDeductionApplyTo(
      { payee_id: 'owner-1' },
      {
        primaryPayeeId: 'primary-1',
        additionalPayeeId: 'owner-1'
      }
    );

    assert.strictEqual(applyTo, 'additional_payee');
  });

  it('skips unrelated payee scoped rules', () => {
    const applyTo = resolveRecurringDeductionApplyTo(
      { payee_id: 'someone-else' },
      {
        primaryPayeeId: 'primary-1',
        additionalPayeeId: 'owner-1'
      }
    );

    assert.strictEqual(applyTo, null);
  });
});

describe('shouldIncludeRecurringDeductionRule', () => {
  it('includes rules that overlap the settlement period', () => {
    assert.strictEqual(
      shouldIncludeRecurringDeductionRule(
        { start_date: '2026-03-01', end_date: null },
        '2026-03-01',
        '2026-03-08'
      ),
      true
    );
  });

  it('excludes future-dated rules during a normal recalc', () => {
    assert.strictEqual(
      shouldIncludeRecurringDeductionRule(
        { start_date: '2026-03-31', end_date: null },
        '2026-03-01',
        '2026-03-08'
      ),
      false
    );
  });

  it('includes future-dated rules during historical backfill within the selected range', () => {
    assert.strictEqual(
      shouldIncludeRecurringDeductionRule(
        { start_date: '2026-03-31', end_date: null },
        '2026-03-01',
        '2026-03-08',
        { historicalBackfillEndDate: '2026-04-30' }
      ),
      true
    );
  });

  it('still excludes rules that ended before the settlement period', () => {
    assert.strictEqual(
      shouldIncludeRecurringDeductionRule(
        { start_date: '2026-01-01', end_date: '2026-02-01' },
        '2026-03-01',
        '2026-03-08',
        { historicalBackfillEndDate: '2026-04-30' }
      ),
      false
    );
  });
});

describe('resolveRecurringDeductionBackfillStartDate', () => {
  it('returns the requested backfill start date for rules that start after the settlement period', () => {
    assert.strictEqual(
      resolveRecurringDeductionBackfillStartDate(
        { start_date: '2026-03-31' },
        '2026-03-08',
        {
          historicalBackfillStartDate: '2026-01-01',
          historicalBackfillEndDate: '2026-04-30'
        }
      ),
      '2026-01-01'
    );
  });

  it('returns null for normal recalcs without backfill context', () => {
    assert.strictEqual(
      resolveRecurringDeductionBackfillStartDate(
        { start_date: '2026-03-31' },
        '2026-03-08'
      ),
      null
    );
  });

  it('returns null when the rule already overlaps the settlement period', () => {
    assert.strictEqual(
      resolveRecurringDeductionBackfillStartDate(
        { start_date: '2026-03-01' },
        '2026-03-08',
        {
          historicalBackfillStartDate: '2026-01-01',
          historicalBackfillEndDate: '2026-04-30'
        }
      ),
      null
    );
  });
});

describe('specific expense helpers', () => {
  it('maps source types to expense responsibility fields', () => {
    assert.strictEqual(getExpenseResponsibilityFieldForSourceType('insurance'), 'insurance_responsibility');
    assert.strictEqual(getExpenseResponsibilityFieldForSourceType('trailer_rent'), 'trailer_rent_responsibility');
    assert.strictEqual(getExpenseResponsibilityFieldForSourceType('unknown'), null);
  });

  it('derives missing expense responsibility from the active expense profile', () => {
    assert.strictEqual(
      resolveSpecificExpenseResponsibility(
        { applies_when: 'specific_expense', source_type: 'insurance', expense_responsibility: null },
        { insurance_responsibility: 'shared' }
      ),
      'shared'
    );
  });

  it('applies specific expense rules to the driver side for shared expense responsibility', () => {
    assert.strictEqual(
      shouldApplyRecurringDeductionForSettlement(
        { applies_when: 'specific_expense', source_type: 'insurance', expense_responsibility: null },
        'primary_payee',
        { expenseProfile: { insurance_responsibility: 'shared' } }
      ),
      true
    );
  });

  it('applies specific expense rules to the owner side for owner responsibility', () => {
    assert.strictEqual(
      shouldApplyRecurringDeductionForSettlement(
        { applies_when: 'specific_expense', source_type: 'trailer_rent', expense_responsibility: null },
        'additional_payee',
        { expenseProfile: { trailer_rent_responsibility: 'owner' } }
      ),
      true
    );
  });

  it('skips specific expense rules when the inferred responsibility does not match the settlement side', () => {
    assert.strictEqual(
      shouldApplyRecurringDeductionForSettlement(
        { applies_when: 'specific_expense', source_type: 'insurance', expense_responsibility: null },
        'primary_payee',
        { expenseProfile: { insurance_responsibility: 'owner' } }
      ),
      false
    );
  });
});

describe('resolveVariableExpenseSplit', () => {
  it('splits shared fuel using the configured driver percentage', () => {
    const split = resolveVariableExpenseSplit(
      'fuel',
      {
        fuel_responsibility: 'shared',
        custom_rules: { fuel_split_percentage: 40 }
      },
      250
    );

    assert.strictEqual(split.responsibility, 'shared');
    assert.strictEqual(split.driverSharePct, 0.4);
    assert.strictEqual(split.ownerSharePct, 0.6);
    assert.strictEqual(split.driverAmount, 100);
    assert.strictEqual(split.ownerAmount, 150);
    assert.strictEqual(split.chargeParty, 'shared');
  });

  it('defaults shared toll to a 50/50 split when no explicit percentage is configured', () => {
    const split = resolveVariableExpenseSplit(
      'toll',
      { toll_responsibility: 'shared', custom_rules: {} },
      177.75
    );

    assert.strictEqual(split.driverAmount, 88.88);
    assert.strictEqual(split.ownerAmount, 88.88);
  });

  it('routes owner-only expenses entirely to the owner side', () => {
    const split = resolveVariableExpenseSplit(
      'fuel',
      { fuel_responsibility: 'owner' },
      245
    );

    assert.strictEqual(split.driverAmount, 0);
    assert.strictEqual(split.ownerAmount, 245);
    assert.strictEqual(split.chargeParty, 'owner');
  });
});

describe('resolveScheduledDeductionAmount', () => {
  it('uses configured fixed amounts from expense responsibility for driver and owner settlements', () => {
    const expenseProfile = {
      custom_rules: {
        fixedAmounts: {
          insurance: { driver: 150, owner: 150 },
          eld: { driver: 30, owner: 30 },
          trailerRent: { driver: 0, owner: 200 }
        }
      }
    };

    assert.strictEqual(
      resolveScheduledDeductionAmount(
        { source_type: 'insurance', amount: 999 },
        'driver',
        expenseProfile,
        { driverPct: 0.33, ownerPct: 0.67 }
      ),
      150
    );

    assert.strictEqual(
      resolveScheduledDeductionAmount(
        { source_type: 'trailer_rent', amount: 999 },
        'equipment_owner',
        expenseProfile,
        { driverPct: 0.33, ownerPct: 0.67 }
      ),
      200
    );
  });

  it('falls back to shared fixed split shares when explicit expense-profile fixed amounts are absent', () => {
    assert.strictEqual(
      resolveScheduledDeductionAmount(
        {
          source_type: 'insurance',
          amount: 300,
          expense_responsibility: 'shared',
          split_type: 'fixed_amount',
          driver_share: 150,
          owner_share: 150
        },
        'equipment_owner',
        null,
        { driverPct: 0.33, ownerPct: 0.67 }
      ),
      150
    );
  });

  it('falls back to percentage split for non-fixed categories', () => {
    assert.strictEqual(
      resolveScheduledDeductionAmount(
        { source_type: 'repairs', amount: 300 },
        'equipment_owner',
        null,
        { driverPct: 0.33, ownerPct: 0.67 }
      ),
      201
    );
  });
});
