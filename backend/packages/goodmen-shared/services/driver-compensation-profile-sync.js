function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function hasDriverCompensationUpdate(body = {}) {
  return [
    'payBasis',
    'pay_basis',
    'payRate',
    'pay_rate',
    'payPercentage',
    'pay_percentage',
    'equipmentOwnerPercentage',
    'equipment_owner_percentage'
  ].some((key) => hasOwn(body, key));
}

module.exports = {
  hasDriverCompensationUpdate
};
