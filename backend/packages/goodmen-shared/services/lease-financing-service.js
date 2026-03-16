'use strict';

const knex = require('../config/knex');

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value).trim();
  const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addFrequency(baseDate, frequency) {
  const d = new Date(`${toDateOnly(baseDate)}T00:00:00.000Z`);
  if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === 'biweekly') d.setUTCDate(d.getUTCDate() + 14);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return toDateOnly(d);
}

function monthsToPeriods(months, frequency) {
  const m = Math.max(Number(months || 0), 1);
  if (frequency === 'weekly') return Math.max(Math.round(m * 52 / 12), 1);
  if (frequency === 'biweekly') return Math.max(Math.round(m * 26 / 12), 1);
  return m;
}

function round2(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

function calcAmortizedPayment(principal, annualRatePct, periods) {
  const p = Number(principal || 0);
  const n = Math.max(Number(periods || 1), 1);
  const annual = Number(annualRatePct || 0) / 100;
  if (annual <= 0) return round2(p / n);
  // Approx period rate by frequency count handled by caller via periods/term.
  const r = annual / 12;
  const payment = p * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return round2(payment);
}

function normalizeStatus(amountDue, amountPaid, dueDate, graceDays = 0) {
  const remaining = round2(amountDue - amountPaid);
  if (remaining <= 0) return 'paid';
  if (amountPaid > 0) return 'partial';
  const due = new Date(`${toDateOnly(dueDate)}T00:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() + Number(graceDays || 0));
  return Date.now() > due.getTime() ? 'overdue' : 'pending';
}

async function logAgreementEvent(trx, agreementId, tenantId, actorId, eventType, payload = null) {
  await trx('lease_agreement_audit_log').insert({
    agreement_id: agreementId,
    tenant_id: tenantId,
    actor_id: actorId || null,
    event_type: eventType,
    payload: payload ? JSON.stringify(payload) : null,
    created_at: trx.fn.now(),
  });
}

async function generateScheduleRows({
  agreementId,
  startDate,
  financedPrincipal,
  totalPayable,
  paymentAmount,
  paymentFrequency,
  termMonths,
  balloonPayment,
}) {
  const rows = [];
  const periods = monthsToPeriods(termMonths, paymentFrequency);
  let dueDate = toDateOnly(startDate);
  let remaining = round2(totalPayable);
  for (let i = 1; i <= periods; i += 1) {
    const isLast = i === periods;
    const due = isLast ? round2(remaining) : round2(paymentAmount);
    remaining = round2(remaining - due);
    rows.push({
      agreement_id: agreementId,
      installment_number: i,
      due_date: dueDate,
      amount_due: due,
      amount_paid: 0,
      remaining_due: due,
      balance_after_payment: Math.max(remaining, 0),
      status: 'pending',
      late_fee_applied: 0,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
    dueDate = addFrequency(dueDate, paymentFrequency);
  }
  if (Number(balloonPayment || 0) > 0 && rows.length > 0) {
    const last = rows[rows.length - 1];
    last.amount_due = round2(Number(last.amount_due) + Number(balloonPayment));
    last.remaining_due = last.amount_due;
    last.balance_after_payment = 0;
  }
  return rows;
}

async function recalcAgreementStatusAndBalance(trx, agreementId) {
  const [balanceRow] = await trx('lease_payment_schedule')
    .where({ agreement_id: agreementId })
    .sum({ remaining: 'remaining_due' });

  const remaining = round2(Number(balanceRow?.remaining || 0));
  const overdueCountRow = await trx('lease_payment_schedule')
    .where({ agreement_id: agreementId, status: 'overdue' })
    .count('* as cnt')
    .first();

  const agreement = await trx('lease_agreements').where({ id: agreementId }).first();
  if (!agreement) return null;

  let nextStatus = agreement.status;
  if (remaining <= 0) nextStatus = 'completed';
  else if (Number(overdueCountRow?.cnt || 0) > 0 && agreement.status === 'active') nextStatus = 'overdue';
  else if (agreement.status === 'overdue' && Number(overdueCountRow?.cnt || 0) === 0) nextStatus = 'active';

  await trx('lease_agreements').where({ id: agreementId }).update({
    remaining_balance: remaining,
    status: nextStatus,
    updated_at: trx.fn.now(),
  });

  if (nextStatus === 'completed') {
    await trx('vehicles').where({ id: agreement.truck_id }).update({
      owner_type: 'driver_owned',
      title_status: 'transfer_ready',
      leased_driver_id: agreement.driver_id,
      updated_at: trx.fn.now(),
    });
  }

  return { remaining, status: nextStatus };
}

async function calculateAndStoreRiskSnapshot(trx, agreementId) {
  const agreement = await trx('lease_agreements').where({ id: agreementId }).first();
  if (!agreement) return null;

  const recent = await trx('lease_payment_schedule')
    .where({ agreement_id: agreementId })
    .orderBy('installment_number', 'desc')
    .limit(8);

  const overdueCount = recent.filter((r) => r.status === 'overdue').length;
  const partialCount = recent.filter((r) => r.status === 'partial').length;
  let consecutiveShortfalls = 0;
  for (const row of recent) {
    if (Number(row.remaining_due || 0) > 0) consecutiveShortfalls += 1;
    else break;
  }

  const settlements = await trx('settlements')
    .where({ driver_id: agreement.driver_id })
    .orderBy('created_at', 'desc')
    .limit(8)
    .select('net_pay_driver');

  const netVals = settlements.map((s) => Number(s.net_pay_driver || 0));
  const avgNet = netVals.length ? round2(netVals.reduce((a, b) => a + b, 0) / netVals.length) : 0;
  const variance = netVals.length
    ? netVals.reduce((acc, v) => acc + Math.pow(v - avgNet, 2), 0) / netVals.length
    : 0;
  const volatility = round2(Math.sqrt(variance));

  let score = 0;
  score += Math.min(overdueCount * 20, 40);
  score += Math.min(partialCount * 10, 20);
  score += Math.min(consecutiveShortfalls * 8, 24);
  score += avgNet < 500 ? 10 : 0;
  score += volatility > 1200 ? 8 : 0;
  score = Math.max(0, Math.min(100, score));

  const riskLevel = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  const reasons = [];
  if (overdueCount > 0) reasons.push('overdue_payments');
  if (partialCount > 1) reasons.push('repeated_partial_payments');
  if (consecutiveShortfalls > 1) reasons.push('consecutive_shortfalls');
  if (avgNet < 500) reasons.push('low_net_settlement_margin');
  if (volatility > 1200) reasons.push('high_settlement_volatility');

  const action = riskLevel === 'high' ? 'contact_driver' : riskLevel === 'medium' ? 'monitor' : 'normal';

  const [snapshot] = await trx('lease_risk_snapshots').insert({
    agreement_id: agreement.id,
    driver_id: agreement.driver_id,
    calculated_at: trx.fn.now(),
    risk_score: score,
    risk_level: riskLevel,
    overdue_count_recent: overdueCount,
    partial_payment_count_recent: partialCount,
    consecutive_shortfalls: consecutiveShortfalls,
    avg_net_settlement_recent: avgNet,
    volatility_metric: volatility,
    reason_codes: JSON.stringify(reasons),
    recommended_action: action,
    created_at: trx.fn.now(),
  }).returning('*');

  return snapshot;
}

async function applyPayment({ trx, agreement, scheduleRow, settlementId, amount, paymentMethod, createdBy, notes, referenceNumber }) {
  const paid = round2(Number(amount || 0));
  if (paid <= 0) return null;

  const remainingBefore = round2(Number(scheduleRow.remaining_due || 0));
  const paidAccum = round2(Number(scheduleRow.amount_paid || 0) + paid);
  const remainingAfter = round2(Math.max(remainingBefore - paid, 0));
  const status = remainingAfter <= 0 ? 'paid' : 'partial';

  await trx('lease_payment_schedule').where({ id: scheduleRow.id }).update({
    amount_paid: paidAccum,
    remaining_due: remainingAfter,
    status,
    paid_at: status === 'paid' ? trx.fn.now() : null,
    updated_at: trx.fn.now(),
  });

  const [txn] = await trx('lease_payment_transactions').insert({
    agreement_id: agreement.id,
    payment_schedule_id: scheduleRow.id,
    settlement_id: settlementId || null,
    amount_paid: paid,
    payment_method: paymentMethod,
    payment_date: toDateOnly(new Date()),
    reference_number: referenceNumber || null,
    notes: notes || null,
    created_by: createdBy || null,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  }).returning('*');

  await recalcAgreementStatusAndBalance(trx, agreement.id);
  await calculateAndStoreRiskSnapshot(trx, agreement.id);
  return txn;
}

async function getNextDueSchedule(trx, agreementId, asOfDate) {
  return trx('lease_payment_schedule')
    .where({ agreement_id: agreementId })
    .whereIn('status', ['pending', 'partial', 'overdue'])
    .andWhere('due_date', '<=', toDateOnly(asOfDate || new Date()))
    .orderBy('due_date', 'asc')
    .orderBy('installment_number', 'asc')
    .first();
}

async function applyLeaseDeductionForSettlement(trx, settlement) {
  const agreement = await trx('lease_agreements')
    .where({
      tenant_id: settlement.tenant_id,
      driver_id: settlement.driver_id,
      auto_deduction_enabled: true,
    })
    .whereIn('status', ['active', 'overdue'])
    .orderBy('created_at', 'desc')
    .first();

  if (!agreement) return null;

  const period = settlement.payroll_period_id
    ? await trx('payroll_periods').where({ id: settlement.payroll_period_id }).first()
    : null;
  const asOfDate = period?.period_end || settlement.date || new Date();

  const schedule = await getNextDueSchedule(trx, agreement.id, asOfDate);
  if (!schedule) return null;

  const existingTxn = await trx('lease_payment_transactions')
    .where({ settlement_id: settlement.id, payment_schedule_id: schedule.id, payment_method: 'settlement_deduction' })
    .first();
  if (existingTxn) return existingTxn;

  const loadRows = await trx('settlement_load_items').where({ settlement_id: settlement.id }).select('driver_pay_amount');
  const grossDriverPay = round2(loadRows.reduce((sum, r) => sum + Number(r.driver_pay_amount || 0), 0));

  const adjustmentRows = await trx('settlement_adjustment_items')
    .where({ settlement_id: settlement.id, item_type: 'deduction' })
    .where(function whereApplicable() {
      this.whereNull('apply_to').orWhere('apply_to', 'primary_payee').orWhere('apply_to', 'settlement');
    })
    .select('amount');
  const existingDeductions = round2(adjustmentRows.reduce((sum, r) => sum + Number(r.amount || 0), 0));

  const available = round2(Math.max(grossDriverPay - existingDeductions, 0));
  const amountDueNow = round2(Number(schedule.remaining_due || schedule.amount_due || 0));
  const deduct = round2(Math.min(amountDueNow, available));
  if (deduct <= 0) return null;

  await trx('settlement_adjustment_items').insert({
    settlement_id: settlement.id,
    item_type: 'deduction',
    source_type: 'lease_payment',
    description: `Lease-to-own payment ${agreement.agreement_number} #${schedule.installment_number}`,
    amount: deduct,
    charge_party: 'driver',
    apply_to: 'primary_payee',
    source_reference_id: schedule.id,
    source_reference_type: 'lease_payment_schedule',
    status: 'applied',
    created_by: settlement.updated_by || settlement.created_by || null,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  });

  const txn = await applyPayment({
    trx,
    agreement,
    scheduleRow: schedule,
    settlementId: settlement.id,
    amount: deduct,
    paymentMethod: 'settlement_deduction',
    createdBy: settlement.updated_by || settlement.created_by || null,
    notes: 'Auto-deducted from settlement'
  });

  await logAgreementEvent(trx, agreement.id, agreement.tenant_id, settlement.updated_by || settlement.created_by || null, 'settlement_deduction_applied', {
    settlement_id: settlement.id,
    payment_schedule_id: schedule.id,
    deducted_amount: deduct,
    shortfall_remaining: round2(amountDueNow - deduct),
  });

  return txn;
}

module.exports = {
  toDateOnly,
  round2,
  monthsToPeriods,
  calcAmortizedPayment,
  generateScheduleRows,
  normalizeStatus,
  logAgreementEvent,
  recalcAgreementStatusAndBalance,
  calculateAndStoreRiskSnapshot,
  applyPayment,
  getNextDueSchedule,
  applyLeaseDeductionForSettlement,
};
