function normalizeRecurringDeductionPayeeIds(explicitPayeeIds = [], assignment = null) {
  return Array.from(
    new Set(
      [
        ...(Array.isArray(explicitPayeeIds) ? explicitPayeeIds : []),
        assignment?.primary_payee_id,
        assignment?.additional_payee_id
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

function normalizeRecurringDeductionDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) {
    return isoDate[1];
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function normalizeRecurringResponsibility(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function getExpenseResponsibilityFieldForSourceType(sourceType) {
  const normalizedSourceType = String(sourceType || '').trim().toLowerCase();
  if (!normalizedSourceType) return null;

  const fieldMap = {
    fuel: 'fuel_responsibility',
    insurance: 'insurance_responsibility',
    eld: 'eld_responsibility',
    trailer_rent: 'trailer_rent_responsibility',
    toll: 'toll_responsibility',
    repairs: 'repairs_responsibility'
  };

  return fieldMap[normalizedSourceType] || null;
}

function resolveSpecificExpenseResponsibility(rule = {}, expenseProfile = null) {
  const explicitResponsibility = normalizeRecurringResponsibility(rule?.expense_responsibility);
  if (explicitResponsibility) {
    return explicitResponsibility;
  }

  const fieldName = getExpenseResponsibilityFieldForSourceType(rule?.source_type);
  if (!fieldName) {
    return null;
  }

  return normalizeRecurringResponsibility(expenseProfile?.[fieldName]);
}

function shouldApplyRecurringDeductionForSettlement(rule = {}, applyTo, options = {}) {
  const appliesWhen = String(rule?.applies_when || 'always').trim().toLowerCase();
  if (!applyTo) {
    return false;
  }

  if (appliesWhen === 'always' || !appliesWhen) {
    return true;
  }

  if (appliesWhen === 'has_loads') {
    return Boolean(options?.hasLoadItems);
  }

  if (appliesWhen !== 'specific_expense') {
    return true;
  }

  const responsibility = resolveSpecificExpenseResponsibility(rule, options?.expenseProfile || null);
  if (!responsibility) {
    return false;
  }

  if (applyTo === 'primary_payee') {
    return responsibility === 'driver' || responsibility === 'shared';
  }

  if (applyTo === 'additional_payee') {
    return responsibility === 'owner' || responsibility === 'company' || responsibility === 'shared';
  }

  return false;
}

function shouldIncludeRecurringDeductionRule(rule = {}, periodStart, periodEnd, options = {}) {
  const normalizedPeriodStart = normalizeRecurringDeductionDate(periodStart);
  const normalizedPeriodEnd = normalizeRecurringDeductionDate(periodEnd);
  if (!normalizedPeriodStart || !normalizedPeriodEnd) {
    return false;
  }

  const normalizedRuleStart = normalizeRecurringDeductionDate(rule?.start_date);
  const normalizedRuleEnd = normalizeRecurringDeductionDate(rule?.end_date);
  const historicalBackfillEnd = normalizeRecurringDeductionDate(options?.historicalBackfillEndDate);
  const effectiveRuleStartLimit = historicalBackfillEnd || normalizedPeriodEnd;

  if (!normalizedRuleStart || normalizedRuleStart > effectiveRuleStartLimit) {
    return false;
  }

  if (normalizedRuleEnd && normalizedRuleEnd < normalizedPeriodStart) {
    return false;
  }

  return true;
}

function resolveRecurringDeductionBackfillStartDate(rule = {}, periodEnd, options = {}) {
  const historicalBackfillStart = normalizeRecurringDeductionDate(options?.historicalBackfillStartDate);
  const historicalBackfillEnd = normalizeRecurringDeductionDate(options?.historicalBackfillEndDate);
  const normalizedPeriodEnd = normalizeRecurringDeductionDate(periodEnd);
  const normalizedRuleStart = normalizeRecurringDeductionDate(rule?.start_date);

  if (!historicalBackfillStart || !historicalBackfillEnd || !normalizedPeriodEnd || !normalizedRuleStart) {
    return null;
  }

  if (normalizedRuleStart <= normalizedPeriodEnd) {
    return null;
  }

  if (normalizedRuleStart > historicalBackfillEnd) {
    return null;
  }

  if (historicalBackfillStart >= normalizedRuleStart) {
    return null;
  }

  return historicalBackfillStart;
}

function resolveRecurringDeductionApplyTo(rule = {}, payeeContext = {}) {
  const primaryPayeeId = String(payeeContext?.primaryPayeeId || '').trim();
  const additionalPayeeId = String(payeeContext?.additionalPayeeId || '').trim();
  const rulePayeeId = String(rule?.payee_id || '').trim();

  if (!rulePayeeId) {
    return 'primary_payee';
  }

  if (rulePayeeId === primaryPayeeId) {
    return 'primary_payee';
  }

  if (rulePayeeId === additionalPayeeId) {
    return 'additional_payee';
  }

  return null;
}

function resolveVariableExpenseSplit(expenseType, expenseProfile = {}, amount = 0) {
  const normalizedType = String(expenseType || '').trim().toLowerCase();
  const rawAmount = Number(amount) || 0;
  const absoluteAmount = Math.round(Math.abs(rawAmount) * 100) / 100;

  const responsibilityField = getExpenseResponsibilityFieldForSourceType(normalizedType);
  const responsibility = normalizeRecurringResponsibility(
    responsibilityField ? expenseProfile?.[responsibilityField] : null
  ) || 'company';

  let driverSharePct = 0;
  let ownerSharePct = 0;

  if (responsibility === 'driver') {
    driverSharePct = 1;
  } else if (responsibility === 'owner') {
    ownerSharePct = 1;
  } else if (responsibility === 'shared') {
    const customRules = expenseProfile?.custom_rules || {};
    const rawSplitPct = normalizedType === 'fuel'
      ? Number(customRules.fuel_split_percentage ?? customRules.percentages?.fuel)
      : Number(customRules.toll_split_percentage ?? customRules.percentages?.toll);
    const normalizedSplitPct = (!Number.isNaN(rawSplitPct) && rawSplitPct >= 0 && rawSplitPct <= 100)
      ? rawSplitPct / 100
      : 0.5;
    driverSharePct = normalizedSplitPct;
    ownerSharePct = 1 - normalizedSplitPct;
  }

  const driverAmount = Math.round(absoluteAmount * driverSharePct * 100) / 100;
  const ownerAmount = Math.round(absoluteAmount * ownerSharePct * 100) / 100;

  return {
    responsibility,
    driverSharePct,
    ownerSharePct,
    driverAmount,
    ownerAmount,
    chargeParty: responsibility === 'shared'
      ? 'shared'
      : responsibility === 'owner'
        ? 'owner'
        : responsibility === 'driver'
          ? 'driver'
          : 'company'
  };
}

module.exports = {
  getExpenseResponsibilityFieldForSourceType,
  normalizeRecurringDeductionPayeeIds,
  resolveSpecificExpenseResponsibility,
  resolveRecurringDeductionBackfillStartDate,
  shouldApplyRecurringDeductionForSettlement,
  shouldIncludeRecurringDeductionRule,
  resolveRecurringDeductionApplyTo,
  resolveVariableExpenseSplit
};
