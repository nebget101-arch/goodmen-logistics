const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  ELIGIBLE_SETTLEMENT_LOAD_STATUSES,
  isEligibleSettlementLoadStatus,
  normalizeLoadStatus
} = require('./settlement-load-status');

describe('settlement-load-status', () => {
  it('includes both delivered and completed terminal statuses', () => {
    assert.deepEqual(ELIGIBLE_SETTLEMENT_LOAD_STATUSES, ['DELIVERED', 'COMPLETED']);
  });

  it('normalizes load statuses before checking eligibility', () => {
    assert.equal(normalizeLoadStatus(' completed '), 'COMPLETED');
    assert.equal(isEligibleSettlementLoadStatus('completed'), true);
    assert.equal(isEligibleSettlementLoadStatus('DELIVERED'), true);
    assert.equal(isEligibleSettlementLoadStatus('in_transit'), false);
  });
});
