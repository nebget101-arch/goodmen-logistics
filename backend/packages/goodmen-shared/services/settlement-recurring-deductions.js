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

module.exports = {
  normalizeRecurringDeductionPayeeIds,
  shouldIncludeRecurringDeductionRule,
  resolveRecurringDeductionApplyTo
};
