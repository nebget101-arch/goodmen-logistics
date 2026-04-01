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

function pickLatestEquipmentOwnerPercentage(rows = []) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = row?.equipment_owner_percentage;
    if (value == null || value === '') continue;

    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

function resolveCompensationProfileEffectiveStartDate(mode, driverRow = {}, fallbackDate) {
  const normalizedFallbackDate = String(fallbackDate || '').slice(0, 10) || null;
  const hireDate = driverRow?.hire_date || driverRow?.hireDate || null;
  const normalizedHireDate = hireDate ? String(hireDate).slice(0, 10) : null;

  if (mode === 'create') {
    return normalizedHireDate || normalizedFallbackDate;
  }

  return normalizedFallbackDate;
}

module.exports = {
  hasDriverCompensationUpdate,
  pickLatestEquipmentOwnerPercentage,
  resolveCompensationProfileEffectiveStartDate
};
