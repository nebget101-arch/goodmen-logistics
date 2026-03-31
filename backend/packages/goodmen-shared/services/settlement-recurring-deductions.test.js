const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  normalizeRecurringDeductionPayeeIds,
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
