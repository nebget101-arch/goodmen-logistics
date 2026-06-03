const ELIGIBLE_SETTLEMENT_LOAD_STATUSES = ['DELIVERED', 'COMPLETED'];

function normalizeLoadStatus(value) {
  return (value || '').toString().trim().toUpperCase();
}

function isEligibleSettlementLoadStatus(value) {
  return ELIGIBLE_SETTLEMENT_LOAD_STATUSES.includes(normalizeLoadStatus(value));
}

module.exports = {
  ELIGIBLE_SETTLEMENT_LOAD_STATUSES,
  isEligibleSettlementLoadStatus,
  normalizeLoadStatus
};
