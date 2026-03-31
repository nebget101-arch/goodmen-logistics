const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  buildUniqueSettlementNumber,
  isSettlementNumberConflict,
  sanitizeSettlementNumberToken
} = require('./settlement-numbering');

describe('settlement-numbering', () => {
  it('sanitizes settlement tokens consistently', () => {
    assert.equal(sanitizeSettlementNumberToken(' John Doe / Truck #12 ', 'X'), 'JOHN_DOE_TRUCK_12');
    assert.equal(sanitizeSettlementNumberToken('', 'FALLBACK'), 'FALLBACK');
  });

  it('builds uppercase settlement numbers with a unique suffix', () => {
    const settlementNumber = buildUniqueSettlementNumber('stl2', ['Jane Doe', 'equipment owner']);
    assert.match(settlementNumber, /^STL2-JANE_DOE-EQUIPMENT_OWNER-[A-F0-9]{12}$/);
  });

  it('recognizes settlement number unique constraint conflicts', () => {
    assert.equal(isSettlementNumberConflict({
      code: '23505',
      constraint: 'idx_settlements_number'
    }), true);

    assert.equal(isSettlementNumberConflict({
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_settlements_number"'
    }), true);

    assert.equal(isSettlementNumberConflict({
      code: '23505',
      constraint: 'some_other_constraint'
    }), false);
  });
});
