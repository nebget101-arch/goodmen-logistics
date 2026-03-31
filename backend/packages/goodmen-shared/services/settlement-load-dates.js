function resolveEligibleLoadDate(dateBasis, metadata = {}) {
  const pickupCandidate = metadata.pickupDate
    || metadata.deliveryDate
    || metadata.completedDate
    || metadata.createdAt
    || null;

  const deliveryCandidate = metadata.deliveryDate
    || metadata.completedDate
    || metadata.createdAt
    || metadata.pickupDate
    || null;

  return dateBasis === 'delivery' ? deliveryCandidate : pickupCandidate;
}

module.exports = {
  resolveEligibleLoadDate
};
