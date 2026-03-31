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
  resolveRecurringDeductionApplyTo
};
