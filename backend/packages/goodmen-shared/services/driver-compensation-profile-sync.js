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

function mergeCompensationProfileWithFallback(profile = null, fallbackProfile = null, driverRow = {}) {
  if (!profile && !fallbackProfile) return null;

  const merged = { ...(profile || {}) };
  const fallback = fallbackProfile || {};

  if ((merged.equipment_owner_percentage == null || merged.equipment_owner_percentage === '')
    && fallback.equipment_owner_percentage != null
    && fallback.equipment_owner_percentage !== '') {
    merged.equipment_owner_percentage = fallback.equipment_owner_percentage;
  }

  const driverPayPct = driverRow?.pay_percentage ?? driverRow?.payPercentage ?? null;
  const mergedPct = Number(merged.percentage_rate);
  const hasDriverPayPct = driverPayPct != null && driverPayPct !== '' && Number.isFinite(Number(driverPayPct));
  const fallbackPct = fallback.percentage_rate != null && fallback.percentage_rate !== ''
    ? Number(fallback.percentage_rate)
    : null;

  if (String(merged.pay_model || '').toLowerCase() === 'percentage') {
    if ((!Number.isFinite(mergedPct) || mergedPct === 0) && Number.isFinite(fallbackPct) && fallbackPct > 0) {
      merged.percentage_rate = fallbackPct;
    }

    if ((!Number.isFinite(Number(merged.percentage_rate)) || Number(merged.percentage_rate) === 0) && hasDriverPayPct) {
      merged.percentage_rate = Number(driverPayPct);
    }
  }

  return merged;
}

module.exports = {
  hasDriverCompensationUpdate,
  pickLatestEquipmentOwnerPercentage,
  resolveCompensationProfileEffectiveStartDate,
  mergeCompensationProfileWithFallback
};
