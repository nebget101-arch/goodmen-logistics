'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();

const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const { uploadBuffer, getSignedDownloadUrl } = require('../storage/r2-storage');
const { loadUserRbac, requireAnyPermission } = require('../middleware/rbac-middleware');
const {
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
} = require('../services/lease-financing-service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const LEASE_ANY_PERMISSION = [
  'lease.financing.view',
  'lease.financing.create',
  'lease.financing.edit',
  'lease.financing.activate',
  'lease.financing.terminate',
  'lease.financing.payments.manage',
  'lease.financing.dashboard.view',
];

const canView = requireAnyPermission(['lease.financing.view', 'lease.financing.dashboard.view']);
const canCreate = requireAnyPermission(['lease.financing.create', 'lease.financing.edit']);
const canEdit = requireAnyPermission(['lease.financing.edit']);
const canActivate = requireAnyPermission(['lease.financing.activate', 'lease.financing.edit']);
const canTerminate = requireAnyPermission(['lease.financing.terminate', 'lease.financing.edit']);
const canPay = requireAnyPermission(['lease.financing.payments.manage', 'lease.financing.edit']);
const canDashboard = requireAnyPermission(['lease.financing.dashboard.view', 'lease.financing.view']);

router.use(loadUserRbac);
router.use(requireAnyPermission(LEASE_ANY_PERMISSION));

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || req.user?.tenant_id || null;
}

function operatingEntityId(req) {
  return req.context?.operatingEntityId || null;
}

function requireTenant(req, res) {
  const tid = tenantId(req);
  if (!tid) {
    res.status(401).json({ error: 'Tenant context required' });
    return null;
  }
  return tid;
}

function mapAgreementFilters(q, req, tid) {
  q.where('la.tenant_id', tid);
  if (operatingEntityId(req)) q.andWhere('la.operating_entity_id', operatingEntityId(req));
  if (req.query.status) q.andWhere('la.status', req.query.status);
  if (String(req.query.active_only || '') === '1' || String(req.query.active_only || '').toLowerCase() === 'true') {
    q.whereIn('la.status', ['active', 'overdue', 'pending_signature']);
  }
  if (req.query.driver_id) q.andWhere('la.driver_id', req.query.driver_id);
  if (req.query.truck_id) q.andWhere('la.truck_id', req.query.truck_id);
  if (req.query.payment_frequency) q.andWhere('la.payment_frequency', req.query.payment_frequency);
  if (req.query.mc_id) q.andWhere('la.mc_id', req.query.mc_id);
}

function applyAgreementScope(query, req, tid, alias = 'lease_agreements') {
  query.where(`${alias}.tenant_id`, tid);
  if (operatingEntityId(req)) query.andWhere(`${alias}.operating_entity_id`, operatingEntityId(req));
  return query;
}

async function findScopedAgreement(req, agreementId, trx = knex) {
  const tid = tenantId(req);
  if (!tid) return null;
  return applyAgreementScope(
    trx('lease_agreements').where({ id: agreementId }),
    req,
    tid
  ).first();
}

async function nextAgreementNumber(tid) {
  const year = new Date().getFullYear();
  const prefix = `LTO-${year}-`;
  const row = await knex('lease_agreements')
    .where('tenant_id', tid)
    .where('agreement_number', 'like', `${prefix}%`)
    .count('* as cnt')
    .first();
  const n = Number(row?.cnt || 0) + 1;
  return `${prefix}${String(n).padStart(5, '0')}`;
}

function buildTermCalculation(body) {
  const purchasePrice = Number(body.purchase_price || 0);
  const downPayment = Number(body.down_payment || 0);
  const principal = round2(Math.max(purchasePrice - downPayment, 0));
  const frequency = ['weekly', 'biweekly', 'monthly'].includes(String(body.payment_frequency || '').toLowerCase())
    ? String(body.payment_frequency).toLowerCase()
    : 'weekly';
  const termMonths = Math.max(Number(body.term_months || 12), 1);
  const periods = monthsToPeriods(termMonths, frequency);
  const interestRate = Number(body.interest_rate || 0);
  const calcPayment = calcAmortizedPayment(principal, interestRate, periods);
  const paymentAmount = body.payment_amount != null && body.allow_payment_override
    ? round2(Number(body.payment_amount || 0))
    : calcPayment;
  const totalPayable = round2(paymentAmount * periods + Number(body.balloon_payment || 0));

  return {
    purchasePrice,
    downPayment,
    financedPrincipal: principal,
    interestRate,
    totalPayable,
    termMonths,
    periods,
    paymentFrequency: frequency,
    paymentAmount,
    balloonPayment: Number(body.balloon_payment || 0),
  };
}

function latestRiskSnapshotIdsQuery() {
  return knex.raw(`
    select distinct on (agreement_id) id
    from lease_risk_snapshots
    order by agreement_id, calculated_at desc, created_at desc
  `);
}

async function refreshOverdueRowsForAgreement(trx, agreement) {
  const rows = await trx('lease_payment_schedule')
    .where({ agreement_id: agreement.id })
    .whereIn('status', ['pending', 'partial', 'overdue']);

  for (const row of rows) {
    const next = normalizeStatus(Number(row.amount_due || 0), Number(row.amount_paid || 0), row.due_date, agreement.grace_period_days);
    const patch = { status: next, updated_at: trx.fn.now() };
    if (next === 'overdue' && !row.overdue_at) patch.overdue_at = trx.fn.now();
    await trx('lease_payment_schedule').where({ id: row.id }).update(patch);
  }
}

router.get('/', canView, (_req, res) => {
  res.json({
    success: true,
    message: 'Lease-to-Own Financing API',
    endpoints: [
      '/api/lease-agreements',
      '/api/lease-financing/dashboard/summary',
      '/api/lease-financing/dashboard/cashflow',
      '/api/lease-financing/dashboard/exposure',
      '/api/lease-financing/dashboard/risk',
    ]
  });
});

router.get('/lease-agreements', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const base = knex('lease_agreements as la')
      .leftJoin('drivers as d', 'd.id', 'la.driver_id')
      .leftJoin('vehicles as v', 'v.id', 'la.truck_id')
      .select(
        'la.*',
        knex.raw("NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), '') as driver_name"),
        knex.raw("COALESCE(v.unit_number, v.license_plate) as truck_label")
      )
      .modify((q) => mapAgreementFilters(q, req, tid))
      .orderBy('la.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const rows = await base;

    const [{ total }] = await knex('lease_agreements as la')
      .modify((q) => mapAgreementFilters(q, req, tid))
      .count('* as total');

    const agreementIds = rows.map((r) => r.id);
    const scheduleRows = agreementIds.length
      ? await knex('lease_payment_schedule').whereIn('agreement_id', agreementIds).whereIn('status', ['pending', 'partial', 'overdue']).orderBy('due_date', 'asc')
      : [];
    const riskRows = agreementIds.length
      ? await knex('lease_risk_snapshots as lrs')
        .whereIn('agreement_id', agreementIds)
        .whereIn('id', latestRiskSnapshotIdsQuery())
      : [];

    const nextByAgreement = new Map();
    for (const s of scheduleRows) {
      if (!nextByAgreement.has(s.agreement_id)) nextByAgreement.set(s.agreement_id, s);
    }
    const riskByAgreement = new Map(riskRows.map((r) => [r.agreement_id, r]));

    res.json({
      rows: rows.map((r) => ({
        ...r,
        next_due_date: nextByAgreement.get(r.id)?.due_date || null,
        risk_level: riskByAgreement.get(r.id)?.risk_level || 'low',
        risk_score: Number(riskByAgreement.get(r.id)?.risk_score || 0),
      })),
      total: Number(total || 0),
      limit,
      offset,
    });
  } catch (err) {
    dtLogger.error('lease_agreements_list_failed', err);
    res.status(500).json({ error: 'Failed to list lease agreements' });
  }
});

router.get('/lease-financing/driver/me', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const driverId = req.user?.driver_id || null;
    if (!driverId) return res.status(404).json({ error: 'Driver lease agreement not found' });

    const row = await knex('lease_agreements as la')
      .leftJoin('drivers as d', 'd.id', 'la.driver_id')
      .leftJoin('vehicles as v', 'v.id', 'la.truck_id')
      .modify((q) => applyAgreementScope(q, req, tid, 'la'))
      .where('la.driver_id', driverId)
      .whereIn('la.status', ['active', 'overdue', 'pending_signature'])
      .select(
        'la.*',
        knex.raw("NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), '') as driver_name"),
        knex.raw("COALESCE(v.unit_number, v.license_plate) as truck_label")
      )
      .orderByRaw("CASE la.status WHEN 'active' THEN 1 WHEN 'overdue' THEN 2 WHEN 'pending_signature' THEN 3 ELSE 4 END")
      .orderBy('la.created_at', 'desc')
      .first();

    if (!row) return res.status(404).json({ error: 'Driver lease agreement not found' });
    res.json(row);
  } catch (err) {
    dtLogger.error('lease_driver_me_failed', err);
    res.status(500).json({ error: 'Failed to fetch driver lease agreement' });
  }
});

router.get('/lease-agreements/:id', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const row = await knex('lease_agreements as la')
      .leftJoin('drivers as d', 'd.id', 'la.driver_id')
      .leftJoin('vehicles as v', 'v.id', 'la.truck_id')
      .where('la.id', req.params.id)
      .modify((q) => applyAgreementScope(q, req, tid, 'la'))
      .select(
        'la.*',
        knex.raw("NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), '') as driver_name"),
        knex.raw("COALESCE(v.unit_number, v.license_plate) as truck_label")
      )
      .first();

    if (!row) return res.status(404).json({ error: 'Lease agreement not found' });

    const [schedule, payments, risk, deductions] = await Promise.all([
      knex('lease_payment_schedule').where({ agreement_id: row.id }).orderBy('installment_number', 'asc'),
      knex('lease_payment_transactions').where({ agreement_id: row.id }).orderBy('payment_date', 'desc').limit(100),
      knex('lease_risk_snapshots').where({ agreement_id: row.id }).orderBy('calculated_at', 'desc').first(),
      knex('settlement_adjustment_items as sai')
        .join('settlements as s', 's.id', 'sai.settlement_id')
        .where('sai.source_reference_type', 'lease_payment_schedule')
        .whereIn('sai.source_reference_id', knex('lease_payment_schedule').where({ agreement_id: row.id }).select('id'))
        .select('sai.*', 's.settlement_number', 's.date as settlement_date')
        .orderBy('sai.created_at', 'desc')
        .limit(100)
    ]);

    let documentDownloadUrl = null;
    if (row.document_storage_key) {
      try {
        documentDownloadUrl = await getSignedDownloadUrl(row.document_storage_key);
      } catch (_) {
        documentDownloadUrl = row.document_url || null;
      }
    }

    res.json({
      ...row,
      document_download_url: documentDownloadUrl,
      schedule,
      payments,
      risk_snapshot: risk || null,
      settlement_deductions: deductions,
    });
  } catch (err) {
    dtLogger.error('lease_agreement_get_failed', err);
    res.status(500).json({ error: 'Failed to fetch lease agreement' });
  }
});

router.post('/lease-agreements', canCreate, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }

    const driverId = req.body.driver_id;
    const truckId = req.body.truck_id;
    const startDate = toDateOnly(req.body.agreement_start_date);
    if (!driverId || !truckId || !startDate) {
      await trx.rollback();
      return res.status(400).json({ error: 'driver_id, truck_id, agreement_start_date are required' });
    }

    const driver = await trx('drivers')
      .where({ id: driverId, tenant_id: tid })
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('operating_entity_id', operatingEntityId(req)); })
      .first();
    if (!driver) {
      await trx.rollback();
      return res.status(400).json({ error: 'Driver not found in tenant scope' });
    }

    const truck = await trx('vehicles')
      .where({ id: truckId, tenant_id: tid })
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('operating_entity_id', operatingEntityId(req)); })
      .first();
    if (!truck) {
      await trx.rollback();
      return res.status(400).json({ error: 'Truck not found in tenant scope' });
    }

    const activeOnTruck = await trx('lease_agreements')
      .where({ truck_id: truckId, tenant_id: tid })
      .whereIn('status', ['active', 'pending_signature', 'overdue'])
      .first();
    if (activeOnTruck) {
      await trx.rollback();
      return res.status(409).json({ error: 'Truck already has an active lease-to-own agreement' });
    }

    const calc = buildTermCalculation(req.body);
    const agreementNumber = req.body.agreement_number || await nextAgreementNumber(tid);

    let endDate = startDate;
    for (let i = 0; i < calc.periods; i += 1) {
      endDate = i === 0 ? endDate : (calc.paymentFrequency === 'monthly' ? addMonth(endDate) : addDays(endDate, calc.paymentFrequency === 'weekly' ? 7 : 14));
    }

    const [agreement] = await trx('lease_agreements').insert({
      tenant_id: tid,
      operating_entity_id: operatingEntityId(req) || null,
      company_id: req.body.company_id || tid,
      mc_id: req.body.mc_id || null,
      driver_id: driverId,
      truck_id: truckId,
      agreement_number: agreementNumber,
      purchase_price: calc.purchasePrice,
      down_payment: calc.downPayment,
      financed_principal: calc.financedPrincipal,
      interest_rate: calc.interestRate,
      total_payable: calc.totalPayable,
      term_months: calc.termMonths,
      payment_frequency: calc.paymentFrequency,
      payment_amount: calc.paymentAmount,
      balloon_payment: calc.balloonPayment,
      allow_payment_override: !!req.body.allow_payment_override,
      auto_deduction_enabled: req.body.auto_deduction_enabled !== false,
      grace_period_days: Number(req.body.grace_period_days || 3),
      late_fee_type: req.body.late_fee_type || null,
      late_fee_amount: req.body.late_fee_amount != null ? Number(req.body.late_fee_amount) : null,
      maintenance_responsibility: req.body.maintenance_responsibility || null,
      insurance_responsibility: req.body.insurance_responsibility || null,
      default_rule_config: req.body.default_rule_config ? JSON.stringify(req.body.default_rule_config) : null,
      agreement_start_date: startDate,
      agreement_end_date: req.body.agreement_end_date || null,
      status: req.body.status || 'draft',
      remaining_balance: calc.totalPayable,
      notes: req.body.notes || null,
      created_by: req.user?.id || null,
      updated_by: req.user?.id || null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    }).returning('*');

    const rows = await generateScheduleRows({
      agreementId: agreement.id,
      startDate,
      financedPrincipal: calc.financedPrincipal,
      totalPayable: calc.totalPayable,
      paymentAmount: calc.paymentAmount,
      paymentFrequency: calc.paymentFrequency,
      termMonths: calc.termMonths,
      balloonPayment: calc.balloonPayment,
    });
    if (rows.length) await trx('lease_payment_schedule').insert(rows);

    await logAgreementEvent(trx, agreement.id, tid, req.user?.id || null, 'agreement_created', {
      agreement_number: agreement.agreement_number,
      driver_id: agreement.driver_id,
      truck_id: agreement.truck_id,
      payment_frequency: agreement.payment_frequency,
      payment_amount: agreement.payment_amount,
    });

    await calculateAndStoreRiskSnapshot(trx, agreement.id);

    await trx.commit();
    res.status(201).json(agreement);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('lease_agreement_create_failed', err);
    res.status(500).json({ error: 'Failed to create lease agreement' });
  }
});

function addDays(dateValue, days) {
  const d = new Date(`${toDateOnly(dateValue)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return toDateOnly(d);
}

function addMonth(dateValue) {
  const d = new Date(`${toDateOnly(dateValue)}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return toDateOnly(d);
}

router.put('/lease-agreements/:id', canEdit, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const existing = await findScopedAgreement(req, req.params.id, trx);
    if (!existing) { await trx.rollback(); return res.status(404).json({ error: 'Lease agreement not found' }); }
    if (['completed', 'defaulted', 'terminated'].includes(existing.status)) {
      await trx.rollback();
      return res.status(400).json({ error: 'Cannot edit completed/defaulted/terminated agreements' });
    }

    const editable = [
      'grace_period_days', 'late_fee_type', 'late_fee_amount', 'maintenance_responsibility',
      'insurance_responsibility', 'default_rule_config', 'notes', 'auto_deduction_enabled', 'status'
    ];
    const patch = { updated_by: req.user?.id || null, updated_at: trx.fn.now() };
    for (const key of editable) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    const [updated] = await applyAgreementScope(
      trx('lease_agreements').where({ id: req.params.id }),
      req,
      tid
    ).update(patch).returning('*');
    await logAgreementEvent(trx, updated.id, tid, req.user?.id || null, 'agreement_updated', patch);
    await trx.commit();
    res.json(updated);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('lease_agreement_update_failed', err);
    res.status(500).json({ error: 'Failed to update lease agreement' });
  }
});

router.post('/lease-agreements/:id/activate', canActivate, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const agreement = await findScopedAgreement(req, req.params.id, trx);
    if (!agreement) { await trx.rollback(); return res.status(404).json({ error: 'Lease agreement not found' }); }
    if (!agreement.signed_at) { await trx.rollback(); return res.status(400).json({ error: 'Agreement must be signed before activation' }); }

    const other = await trx('lease_agreements')
      .where({ tenant_id: tid, truck_id: agreement.truck_id })
      .whereIn('status', ['active', 'overdue'])
      .whereNot('id', agreement.id)
      .first();
    if (other) { await trx.rollback(); return res.status(409).json({ error: 'Truck already has another active lease agreement' }); }

    const [updated] = await trx('lease_agreements')
      .where({ id: agreement.id })
      .update({
        status: 'active',
        activated_at: trx.fn.now(),
        updated_by: req.user?.id || null,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    await trx('vehicles').where({ id: agreement.truck_id }).update({
      owner_type: 'lease_to_own',
      leased_driver_id: agreement.driver_id,
      title_status: 'financing_active',
      updated_at: trx.fn.now(),
    });

    await logAgreementEvent(trx, agreement.id, tid, req.user?.id || null, 'agreement_activated', null);
    await calculateAndStoreRiskSnapshot(trx, agreement.id);

    await trx.commit();
    res.json(updated);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('lease_agreement_activate_failed', err);
    res.status(500).json({ error: 'Failed to activate lease agreement' });
  }
});

router.post('/lease-agreements/:id/terminate', canTerminate, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const agreement = await findScopedAgreement(req, req.params.id, trx);
    if (!agreement) { await trx.rollback(); return res.status(404).json({ error: 'Lease agreement not found' }); }

    const [updated] = await trx('lease_agreements').where({ id: agreement.id }).update({
      status: 'terminated',
      updated_by: req.user?.id || null,
      updated_at: trx.fn.now(),
    }).returning('*');

    await trx('vehicles').where({ id: agreement.truck_id }).update({
      owner_type: 'company_owned',
      leased_driver_id: null,
      title_status: 'retained',
      updated_at: trx.fn.now(),
    });

    await logAgreementEvent(trx, agreement.id, tid, req.user?.id || null, 'agreement_terminated', {
      reason: req.body?.reason || null,
      notes: req.body?.notes || null,
    });

    await trx.commit();
    res.json(updated);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('lease_agreement_terminate_failed', err);
    res.status(500).json({ error: 'Failed to terminate lease agreement' });
  }
});

router.post('/lease-agreements/:id/upload-contract', canEdit, upload.single('file'), async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const agreement = await findScopedAgreement(req, req.params.id, trx);
    if (!agreement) { await trx.rollback(); return res.status(404).json({ error: 'Lease agreement not found' }); }

    if (!req.file) { await trx.rollback(); return res.status(400).json({ error: 'Contract file is required' }); }

    const key = `lease-financing/${tid}/${agreement.id}/${Date.now()}-${String(req.file.originalname || 'contract.pdf').replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    await uploadBuffer({
      buffer: req.file.buffer,
      contentType: req.file.mimetype || 'application/pdf',
      key,
      prefix: 'lease-financing',
      fileName: req.file.originalname || 'contract.pdf'
    });

    const signedUrl = await getSignedDownloadUrl(key).catch(() => null);

    const [updated] = await trx('lease_agreements').where({ id: agreement.id }).update({
      document_storage_key: key,
      document_url: signedUrl,
      generated_at: trx.fn.now(),
      sent_for_signature_at: trx.fn.now(),
      status: agreement.status === 'draft' ? 'pending_signature' : agreement.status,
      updated_by: req.user?.id || null,
      updated_at: trx.fn.now(),
    }).returning('*');

    await logAgreementEvent(trx, agreement.id, tid, req.user?.id || null, 'contract_uploaded', { key });
    await trx.commit();

    res.json({ ...updated, document_download_url: signedUrl });
  } catch (err) {
    await trx.rollback();
    dtLogger.error('lease_contract_upload_failed', err);
    res.status(500).json({ error: 'Failed to upload contract' });
  }
});

router.get('/lease-agreements/:id/payment-schedule', canView, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const agreement = await findScopedAgreement(req, req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Lease agreement not found' });

    await knex.transaction(async (trx) => {
      await refreshOverdueRowsForAgreement(trx, agreement);
      await recalcAgreementStatusAndBalance(trx, agreement.id);
    });

    const rows = await knex('lease_payment_schedule').where({ agreement_id: agreement.id }).orderBy('installment_number', 'asc');
    res.json(rows);
  } catch (err) {
    dtLogger.error('lease_schedule_get_failed', err);
    res.status(500).json({ error: 'Failed to get payment schedule' });
  }
});

router.post('/lease-agreements/:id/manual-payment', canPay, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const agreement = await findScopedAgreement(req, req.params.id, trx);
    if (!agreement) { await trx.rollback(); return res.status(404).json({ error: 'Lease agreement not found' }); }
    if (['completed', 'terminated', 'defaulted'].includes(agreement.status)) {
      await trx.rollback();
      return res.status(400).json({ error: 'Agreement is not payable in current status' });
    }

    await refreshOverdueRowsForAgreement(trx, agreement);

    const amount = round2(Number(req.body?.amount_paid || 0));
    if (amount <= 0) {
      await trx.rollback();
      return res.status(400).json({ error: 'amount_paid must be greater than zero' });
    }

    const schedule = req.body?.payment_schedule_id
      ? await trx('lease_payment_schedule').where({ id: req.body.payment_schedule_id, agreement_id: agreement.id }).first()
      : await getNextDueSchedule(trx, agreement.id, req.body?.payment_date || new Date());

    if (!schedule) {
      await trx.rollback();
      return res.status(400).json({ error: 'No pending/overdue schedule row available to apply payment' });
    }

    const remainingDue = round2(Number(schedule.remaining_due || 0));
    if (amount > remainingDue) {
      await trx.rollback();
      return res.status(400).json({ error: 'Overpayment is not allowed for a single schedule row' });
    }

    const txn = await applyPayment({
      trx,
      agreement,
      scheduleRow: schedule,
      settlementId: req.body?.settlement_id || null,
      amount,
      paymentMethod: req.body?.payment_method || 'manual',
      createdBy: req.user?.id || null,
      notes: req.body?.notes || null,
      referenceNumber: req.body?.reference_number || null,
    });

    await logAgreementEvent(trx, agreement.id, tid, req.user?.id || null, 'manual_payment_recorded', {
      payment_schedule_id: schedule.id,
      amount_paid: amount,
      method: req.body?.payment_method || 'manual',
    });

    await trx.commit();
    res.status(201).json(txn);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('lease_manual_payment_failed', err);
    res.status(500).json({ error: 'Failed to record manual payment' });
  }
});

router.post('/lease-agreements/:id/sign', canEdit, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const agreement = await findScopedAgreement(req, req.params.id, trx);
    if (!agreement) { await trx.rollback(); return res.status(404).json({ error: 'Lease agreement not found' }); }

    const [updated] = await trx('lease_agreements').where({ id: agreement.id }).update({
      signed_at: trx.fn.now(),
      status: agreement.status === 'draft' ? 'pending_signature' : agreement.status,
      driver_signature_meta: req.body?.driver_signature_meta ? JSON.stringify(req.body.driver_signature_meta) : agreement.driver_signature_meta,
      company_signature_meta: req.body?.company_signature_meta ? JSON.stringify(req.body.company_signature_meta) : agreement.company_signature_meta,
      updated_by: req.user?.id || null,
      updated_at: trx.fn.now(),
    }).returning('*');

    await logAgreementEvent(trx, agreement.id, tid, req.user?.id || null, 'agreement_signed', {
      has_driver_signature_meta: !!req.body?.driver_signature_meta,
      has_company_signature_meta: !!req.body?.company_signature_meta,
    });

    await trx.commit();
    res.json(updated);
  } catch (err) {
    await trx.rollback();
    dtLogger.error('lease_sign_failed', err);
    res.status(500).json({ error: 'Failed to sign agreement' });
  }
});

router.get('/lease-financing/dashboard/summary', canDashboard, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;
    const q = knex('lease_agreements').where({ tenant_id: tid });
    if (operatingEntityId(req)) q.andWhere('operating_entity_id', operatingEntityId(req));

    const rows = await q.select('status', 'financed_principal', 'remaining_balance');
    const paidRow = await knex('lease_payment_transactions as lpt')
      .join('lease_agreements as la', 'la.id', 'lpt.agreement_id')
      .where('la.tenant_id', tid)
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('la.operating_entity_id', operatingEntityId(req)); })
      .sum('lpt.amount_paid as amount')
      .first();

    const overdueAmountRow = await knex('lease_payment_schedule as lps')
      .join('lease_agreements as la', 'la.id', 'lps.agreement_id')
      .where('la.tenant_id', tid)
      .andWhere('lps.status', 'overdue')
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('la.operating_entity_id', operatingEntityId(req)); })
      .sum('lps.remaining_due as amount')
      .first();

    const totalFinanced = round2(rows.reduce((sum, r) => sum + Number(r.financed_principal || 0), 0));
    const outstanding = round2(rows.reduce((sum, r) => sum + Number(r.remaining_balance || 0), 0));
    const counts = {
      active: rows.filter((r) => r.status === 'active').length,
      overdue: rows.filter((r) => r.status === 'overdue').length,
      defaulted: rows.filter((r) => r.status === 'defaulted').length,
      completed: rows.filter((r) => r.status === 'completed').length,
    };

    res.json({
      total_financed_amount: totalFinanced,
      current_outstanding_principal: outstanding,
      payments_collected_to_date: round2(Number(paidRow?.amount || 0)),
      overdue_amount: round2(Number(overdueAmountRow?.amount || 0)),
      active_agreements: counts.active,
      overdue_agreements: counts.overdue,
      defaulted_agreements: counts.defaulted,
      completed_agreements: counts.completed,
      portfolio_size: rows.length,
    });
  } catch (err) {
    dtLogger.error('lease_dashboard_summary_failed', err);
    res.status(500).json({ error: 'Failed to load financing summary' });
  }
});

router.get('/lease-financing/dashboard/cashflow', canDashboard, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;

    const startDate = toDateOnly(req.query.startDate) || addDays(new Date(), -180);
    const endDate = toDateOnly(req.query.endDate) || toDateOnly(new Date());

    const rows = await knex.raw(`
      WITH scheduled AS (
        SELECT date_trunc('month', lps.due_date)::date AS month,
          COALESCE(SUM(lps.amount_due),0)::numeric AS scheduled_amount,
          COALESCE(SUM(CASE WHEN lps.status='overdue' THEN lps.remaining_due ELSE 0 END),0)::numeric AS overdue_unpaid
        FROM lease_payment_schedule lps
        JOIN lease_agreements la ON la.id = lps.agreement_id
        WHERE la.tenant_id = ?
          ${operatingEntityId(req) ? 'AND la.operating_entity_id = ?' : ''}
          AND lps.due_date BETWEEN ? AND ?
        GROUP BY 1
      ),
      collected AS (
        SELECT date_trunc('month', lpt.payment_date)::date AS month,
          COALESCE(SUM(lpt.amount_paid),0)::numeric AS collected_amount
        FROM lease_payment_transactions lpt
        JOIN lease_agreements la ON la.id = lpt.agreement_id
        WHERE la.tenant_id = ?
          ${operatingEntityId(req) ? 'AND la.operating_entity_id = ?' : ''}
          AND lpt.payment_date BETWEEN ? AND ?
        GROUP BY 1
      ),
      latefees AS (
        SELECT date_trunc('month', lps.due_date)::date AS month,
          COALESCE(SUM(lps.late_fee_applied),0)::numeric AS late_fees_collected
        FROM lease_payment_schedule lps
        JOIN lease_agreements la ON la.id = lps.agreement_id
        WHERE la.tenant_id = ?
          ${operatingEntityId(req) ? 'AND la.operating_entity_id = ?' : ''}
          AND lps.due_date BETWEEN ? AND ?
        GROUP BY 1
      )
      SELECT COALESCE(s.month, c.month, lf.month) AS month,
             COALESCE(s.scheduled_amount,0)::numeric AS scheduled_payments,
             COALESCE(c.collected_amount,0)::numeric AS collected_payments,
             COALESCE(s.overdue_unpaid,0)::numeric AS overdue_unpaid_amount,
             COALESCE(lf.late_fees_collected,0)::numeric AS late_fees_collected,
             (COALESCE(c.collected_amount,0) - COALESCE(s.scheduled_amount,0))::numeric AS expected_vs_actual,
             (COALESCE(c.collected_amount,0) + COALESCE(lf.late_fees_collected,0))::numeric AS net_financing_inflow
      FROM scheduled s
      FULL OUTER JOIN collected c ON c.month = s.month
      FULL OUTER JOIN latefees lf ON lf.month = COALESCE(s.month, c.month)
      ORDER BY 1 ASC
    `, [
      tid,
      ...(operatingEntityId(req) ? [operatingEntityId(req)] : []),
      startDate,
      endDate,
      tid,
      ...(operatingEntityId(req) ? [operatingEntityId(req)] : []),
      startDate,
      endDate,
      tid,
      ...(operatingEntityId(req) ? [operatingEntityId(req)] : []),
      startDate,
      endDate,
    ]);

    res.json({ rows: rows.rows || [], startDate, endDate });
  } catch (err) {
    dtLogger.error('lease_dashboard_cashflow_failed', err);
    res.status(500).json({ error: 'Failed to load financing cashflow' });
  }
});

router.get('/lease-financing/dashboard/exposure', canDashboard, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;

    const [portfolio] = await knex('lease_agreements')
      .where({ tenant_id: tid })
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('operating_entity_id', operatingEntityId(req)); })
      .sum({ total_financed: 'financed_principal', remaining_exposure: 'remaining_balance' });

    const topDrivers = await knex('lease_agreements as la')
      .leftJoin('drivers as d', 'd.id', 'la.driver_id')
      .where('la.tenant_id', tid)
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('la.operating_entity_id', operatingEntityId(req)); })
      .groupBy('la.driver_id', 'd.first_name', 'd.last_name')
      .select(
        'la.driver_id',
        knex.raw("NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), '') as driver_name"),
        knex.raw('COALESCE(SUM(la.remaining_balance),0)::numeric as remaining_balance')
      )
      .orderBy('remaining_balance', 'desc')
      .limit(10);

    const topTrucks = await knex('lease_agreements as la')
      .leftJoin('vehicles as v', 'v.id', 'la.truck_id')
      .where('la.tenant_id', tid)
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('la.operating_entity_id', operatingEntityId(req)); })
      .groupBy('la.truck_id', 'v.unit_number', 'v.license_plate')
      .select(
        'la.truck_id',
        knex.raw("COALESCE(v.unit_number, v.license_plate) as truck_label"),
        knex.raw('COALESCE(SUM(la.remaining_balance),0)::numeric as remaining_balance')
      )
      .orderBy('remaining_balance', 'desc')
      .limit(10);

    const nearingCompletion = await knex('lease_agreements')
      .where({ tenant_id: tid })
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('operating_entity_id', operatingEntityId(req)); })
      .whereIn('status', ['active', 'overdue'])
      .andWhereRaw('total_payable > 0')
      .andWhereRaw('(remaining_balance / NULLIF(total_payable,0)) <= 0.15')
      .orderBy('remaining_balance', 'asc')
      .limit(10);

    const atRisk = await knex('lease_risk_snapshots as lrs')
      .join('lease_agreements as la', 'la.id', 'lrs.agreement_id')
      .where('la.tenant_id', tid)
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('la.operating_entity_id', operatingEntityId(req)); })
      .where('lrs.risk_level', 'high')
      .whereIn('lrs.id', latestRiskSnapshotIdsQuery())
      .select('lrs.*')
      .orderBy('lrs.risk_score', 'desc')
      .limit(20);

    res.json({
      total_amount_financed: round2(Number(portfolio?.total_financed || 0)),
      remaining_exposure: round2(Number(portfolio?.remaining_exposure || 0)),
      top_drivers_by_remaining_balance: topDrivers,
      top_trucks_by_remaining_balance: topTrucks,
      agreements_nearing_completion: nearingCompletion,
      agreements_at_risk: atRisk,
    });
  } catch (err) {
    dtLogger.error('lease_dashboard_exposure_failed', err);
    res.status(500).json({ error: 'Failed to load financing exposure' });
  }
});

router.get('/lease-financing/dashboard/risk', canDashboard, async (req, res) => {
  try {
    const tid = requireTenant(req, res); if (!tid) return;

    const rows = await knex('lease_risk_snapshots as lrs')
      .join('lease_agreements as la', 'la.id', 'lrs.agreement_id')
      .leftJoin('drivers as d', 'd.id', 'lrs.driver_id')
      .where('la.tenant_id', tid)
      .modify((qb) => {
        if (operatingEntityId(req)) qb.andWhere('la.operating_entity_id', operatingEntityId(req));
        if (req.query.risk_level) qb.andWhere('lrs.risk_level', req.query.risk_level);
      })
      .whereIn('lrs.id', latestRiskSnapshotIdsQuery())
      .select(
        'lrs.*',
        'la.agreement_number',
        'la.remaining_balance',
        'la.status as agreement_status',
        knex.raw("NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), '') as driver_name")
      )
      .orderBy('lrs.risk_score', 'desc');

    const counts = {
      low: rows.filter((r) => r.risk_level === 'low').length,
      medium: rows.filter((r) => r.risk_level === 'medium').length,
      high: rows.filter((r) => r.risk_level === 'high').length,
    };

    res.json({
      counts,
      high_risk_agreements: rows.filter((r) => r.risk_level === 'high'),
      rows,
    });
  } catch (err) {
    dtLogger.error('lease_dashboard_risk_failed', err);
    res.status(500).json({ error: 'Failed to load financing risk data' });
  }
});

router.post('/lease-financing/refresh-risk', canDashboard, async (req, res) => {
  const trx = await knex.transaction();
  try {
    const tid = requireTenant(req, res); if (!tid) { await trx.rollback(); return; }
    const agreements = await trx('lease_agreements')
      .where({ tenant_id: tid })
      .modify((qb) => { if (operatingEntityId(req)) qb.andWhere('operating_entity_id', operatingEntityId(req)); })
      .whereIn('status', ['active', 'overdue']);

    for (const agreement of agreements) {
      await refreshOverdueRowsForAgreement(trx, agreement);
      await recalcAgreementStatusAndBalance(trx, agreement.id);
      await calculateAndStoreRiskSnapshot(trx, agreement.id);
    }

    await trx.commit();
    res.json({ success: true, refreshed: agreements.length });
  } catch (err) {
    await trx.rollback();
    dtLogger.error('lease_refresh_risk_failed', err);
    res.status(500).json({ error: 'Failed to refresh risk snapshots' });
  }
});

module.exports = router;
