/**
 * Payroll / Settlement APIs: payees, compensation profiles, payee assignments,
 * expense responsibility, recurring deductions, payroll periods, settlements,
 * settlement load items, adjustment items, PDF payload, email.
 */
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const knex = require('../config/knex');
const {
  createDraftSettlement,
  recalcAndUpdateSettlement,
  addLoadToSettlement,
  removeLoadFromSettlement,
  addAdjustment,
  removeAdjustment,
  approveSettlement,
  voidSettlement,
  listSettlements,
  getActiveCompensationProfile,
  getActivePayeeAssignment,
  getEligibleLoads,
  getRecurringDeductionsForPeriod
} = require('../services/settlement-service');
const { getClient } = require('../internal/db');

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = (req.user?.role || '').toString().trim().toLowerCase();
    const allowed = allowedRoles.map((r) => r.toString().trim().toLowerCase());
    if (!allowed.includes(role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

router.use(authMiddleware);
const settlementRoles = ['admin', 'carrier_accountant', 'dispatch_manager'];

// ---------- Payees ----------
router.get('/payees', requireRole(settlementRoles), async (req, res) => {
  try {
    const { type, search, is_active, limit = 50 } = req.query;
    let q = knex('payees');
    if (type) q = q.where('type', type);
    if (is_active !== undefined) q = q.where('is_active', is_active === 'true' || is_active === true);
    if (search) q = q.where('name', 'ilike', `%${search}%`);
    q = q.orderBy('name').limit(Math.min(Number(limit) || 50, 100));
    const rows = await q;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payees', requireRole(settlementRoles), async (req, res) => {
  try {
    const { type, name, contact_id, email, phone, is_active } = req.body;
    const [row] = await knex('payees')
      .insert({
        type: type || 'driver',
        name: name || 'Unnamed',
        contact_id: contact_id || null,
        email: email || null,
        phone: phone || null,
        is_active: is_active !== false
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/payees/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const row = await knex('payees').where({ id: req.params.id }).first();
    if (!row) return res.status(404).json({ error: 'Payee not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/payees/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const { type, name, contact_id, email, phone, is_active } = req.body;
    const [row] = await knex('payees')
      .where({ id: req.params.id })
      .update({
        ...(type != null && { type }),
        ...(name != null && { name }),
        ...(contact_id !== undefined && { contact_id }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(is_active !== undefined && { is_active }),
        updated_at: knex.fn.now()
      })
      .returning('*');
    if (!row) return res.status(404).json({ error: 'Payee not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Compensation profiles ----------
router.get('/drivers/:driverId/compensation-profile', requireRole(settlementRoles), async (req, res) => {
  try {
    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);
    const row = await getActiveCompensationProfile(knex, req.params.driverId, asOf);
    if (!row) return res.status(404).json({ error: 'No active compensation profile' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/drivers/:driverId/compensation-profiles', requireRole(settlementRoles), async (req, res) => {
  try {
    const rows = await knex('driver_compensation_profiles')
      .where({ driver_id: req.params.driverId })
      .orderBy('effective_start_date', 'desc');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drivers/:driverId/compensation-profiles', requireRole(settlementRoles), async (req, res) => {
  try {
    const body = req.body;
    const [row] = await knex('driver_compensation_profiles')
      .insert({
        driver_id: req.params.driverId,
        profile_type: body.profile_type || 'company_driver',
        pay_model: body.pay_model || 'per_mile',
        percentage_rate: body.percentage_rate ?? null,
        cents_per_mile: body.cents_per_mile ?? null,
        flat_weekly_amount: body.flat_weekly_amount ?? null,
        flat_per_load_amount: body.flat_per_load_amount ?? null,
        expense_sharing_enabled: body.expense_sharing_enabled === true,
        effective_start_date: body.effective_start_date || new Date().toISOString().slice(0, 10),
        effective_end_date: body.effective_end_date ?? null,
        status: body.status || 'active',
        notes: body.notes ?? null
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/compensation-profiles/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const body = req.body;
    const [row] = await knex('driver_compensation_profiles')
      .where({ id: req.params.id })
      .update({
        ...(body.profile_type != null && { profile_type: body.profile_type }),
        ...(body.pay_model != null && { pay_model: body.pay_model }),
        ...(body.percentage_rate !== undefined && { percentage_rate: body.percentage_rate }),
        ...(body.cents_per_mile !== undefined && { cents_per_mile: body.cents_per_mile }),
        ...(body.flat_weekly_amount !== undefined && { flat_weekly_amount: body.flat_weekly_amount }),
        ...(body.flat_per_load_amount !== undefined && { flat_per_load_amount: body.flat_per_load_amount }),
        ...(body.expense_sharing_enabled !== undefined && { expense_sharing_enabled: body.expense_sharing_enabled }),
        ...(body.effective_start_date != null && { effective_start_date: body.effective_start_date }),
        ...(body.effective_end_date !== undefined && { effective_end_date: body.effective_end_date }),
        ...(body.status != null && { status: body.status }),
        ...(body.notes !== undefined && { notes: body.notes }),
        updated_at: knex.fn.now()
      })
      .returning('*');
    if (!row) return res.status(404).json({ error: 'Profile not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Driver payee assignments ----------
router.get('/drivers/:driverId/payee-assignment', requireRole(settlementRoles), async (req, res) => {
  try {
    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);
    const row = await getActivePayeeAssignment(knex, req.params.driverId, asOf);
    if (!row) return res.status(404).json({ error: 'No active payee assignment' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drivers/:driverId/payee-assignments', requireRole(settlementRoles), async (req, res) => {
  try {
    const { primary_payee_id, additional_payee_id, rule_type, effective_start_date, effective_end_date } = req.body;
    const [row] = await knex('driver_payee_assignments')
      .insert({
        driver_id: req.params.driverId,
        primary_payee_id: primary_payee_id,
        additional_payee_id: additional_payee_id ?? null,
        rule_type: rule_type || 'custom',
        effective_start_date: effective_start_date || new Date().toISOString().slice(0, 10),
        effective_end_date: effective_end_date ?? null
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Expense responsibility profiles ----------
router.get('/drivers/:driverId/expense-responsibility', requireRole(settlementRoles), async (req, res) => {
  try {
    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);
    const d = asOf.toString().slice(0, 10);
    const row = await knex('expense_responsibility_profiles')
      .where({ driver_id: req.params.driverId })
      .whereRaw('effective_start_date <= ?', [d])
      .where(function () {
        this.whereNull('effective_end_date').orWhereRaw('effective_end_date >= ?', [d]);
      })
      .orderBy('effective_start_date', 'desc')
      .first();
    res.json(row || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drivers/:driverId/expense-responsibility', requireRole(settlementRoles), async (req, res) => {
  try {
    const body = req.body;
    const [row] = await knex('expense_responsibility_profiles')
      .insert({
        driver_id: req.params.driverId,
        compensation_profile_id: body.compensation_profile_id ?? null,
        fuel_responsibility: body.fuel_responsibility ?? null,
        insurance_responsibility: body.insurance_responsibility ?? null,
        eld_responsibility: body.eld_responsibility ?? null,
        trailer_rent_responsibility: body.trailer_rent_responsibility ?? null,
        toll_responsibility: body.toll_responsibility ?? null,
        repairs_responsibility: body.repairs_responsibility ?? null,
        custom_rules: body.custom_rules != null ? JSON.stringify(body.custom_rules) : knex.raw("'{}'::jsonb"),
        effective_start_date: body.effective_start_date || new Date().toISOString().slice(0, 10),
        effective_end_date: body.effective_end_date ?? null
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Recurring deductions ----------
router.get('/recurring-deductions', requireRole(settlementRoles), async (req, res) => {
  try {
    const { driver_id, enabled } = req.query;
    let q = knex('recurring_deduction_rules');
    if (driver_id) q = q.where('driver_id', driver_id);
    if (enabled !== undefined) q = q.where('enabled', enabled === 'true' || enabled === true);
    const rows = await q.orderBy('start_date', 'desc');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/recurring-deductions', requireRole(settlementRoles), async (req, res) => {
  try {
    const body = req.body;
    const [row] = await knex('recurring_deduction_rules')
      .insert({
        driver_id: body.driver_id ?? null,
        payee_id: body.payee_id ?? null,
        equipment_id: body.equipment_id ?? null,
        rule_scope: body.rule_scope || 'driver',
        description: body.description ?? null,
        amount_type: body.amount_type || 'fixed',
        amount: body.amount ?? 0,
        frequency: body.frequency || 'weekly',
        start_date: body.start_date || new Date().toISOString().slice(0, 10),
        end_date: body.end_date ?? null,
        source_type: body.source_type ?? null,
        applies_when: body.applies_when ?? 'always',
        enabled: body.enabled !== false
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/recurring-deductions/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const body = req.body;
    const updates = { updated_at: knex.fn.now() };
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.end_date !== undefined) updates.end_date = body.end_date;
    const [row] = await knex('recurring_deduction_rules').where({ id: req.params.id }).update(updates).returning('*');
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Payroll periods ----------
router.get('/payroll-periods', requireRole(settlementRoles), async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    let q = knex('payroll_periods').orderBy('period_start', 'desc').limit(Math.min(Number(limit) || 50, 100));
    if (status) q = q.where('status', status);
    const rows = await q;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payroll-periods', requireRole(settlementRoles), async (req, res) => {
  try {
    const { period_start, period_end, run_type } = req.body;
    const [row] = await knex('payroll_periods')
      .insert({
        period_start: period_start || new Date().toISOString().slice(0, 10),
        period_end: period_end || new Date().toISOString().slice(0, 10),
        run_type: run_type || 'weekly',
        status: 'draft',
        created_by: req.user?.id ?? null
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/payroll-periods/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const { status } = req.body;
    const [row] = await knex('payroll_periods').where({ id: req.params.id }).update({ status, updated_at: knex.fn.now() }).returning('*');
    if (!row) return res.status(404).json({ error: 'Period not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Eligible loads (preview for settlement) ----------
router.get('/eligible-loads', requireRole(settlementRoles), async (req, res) => {
  try {
    const { driver_id, period_start, period_end, date_basis } = req.query;
    if (!driver_id || !period_start || !period_end) {
      return res.status(400).json({ error: 'driver_id, period_start, period_end required' });
    }
    const client = await getClient();
    try {
      const loads = await getEligibleLoads(knex, client, driver_id, period_start, period_end, date_basis || 'pickup');
      res.json(loads);
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recurring-deductions/preview', requireRole(settlementRoles), async (req, res) => {
  try {
    const { driver_id, period_start, period_end } = req.query;
    if (!driver_id || !period_start || !period_end) {
      return res.status(400).json({ error: 'driver_id, period_start, period_end required' });
    }
    const rows = await getRecurringDeductionsForPeriod(knex, driver_id, period_start, period_end);
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    res.json({ rules: rows, totalDeductions: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Settlements ----------
router.get('/settlements', requireRole(settlementRoles), async (req, res) => {
  try {
    const filters = {
      driver_id: req.query.driver_id,
      payroll_period_id: req.query.payroll_period_id,
      settlement_status: req.query.settlement_status,
      settlement_number: req.query.settlement_number,
      limit: req.query.limit,
      offset: req.query.offset
    };
    const rows = await listSettlements(knex, filters);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settlements/draft', requireRole(settlementRoles), async (req, res) => {
  try {
    const { payroll_period_id, driver_id, date_basis } = req.body;
    if (!payroll_period_id || !driver_id) {
      return res.status(400).json({ error: 'payroll_period_id and driver_id required' });
    }
    const settlement = await createDraftSettlement(
      payroll_period_id,
      driver_id,
      date_basis || 'pickup',
      req.user?.id ?? null,
      knex
    );
    res.status(201).json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/settlements/:id', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });
    const loadItems = await knex('settlement_load_items').where({ settlement_id: req.params.id });
    const adjustmentItems = await knex('settlement_adjustment_items').where({ settlement_id: req.params.id });
    res.json({ ...settlement, load_items: loadItems, adjustment_items: adjustmentItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settlements/:id/recalc', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await recalcAndUpdateSettlement(knex, req.params.id);
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/settlements/:id/loads', requireRole(settlementRoles), async (req, res) => {
  try {
    const { load_id } = req.body;
    if (!load_id) return res.status(400).json({ error: 'load_id required' });
    await addLoadToSettlement(knex, req.params.id, load_id, req.user?.id ?? null);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/settlements/:id/loads/:loadItemId', requireRole(settlementRoles), async (req, res) => {
  try {
    await removeLoadFromSettlement(knex, req.params.id, req.params.loadItemId);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/settlements/:id/adjustments', requireRole(settlementRoles), async (req, res) => {
  try {
    await addAdjustment(knex, req.params.id, req.body, req.user?.id ?? null);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/settlements/:id/adjustments/:adjustmentId', requireRole(settlementRoles), async (req, res) => {
  try {
    await removeAdjustment(knex, req.params.id, req.params.adjustmentId);
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/settlements/:id/approve', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await approveSettlement(knex, req.params.id, req.user?.id ?? null);
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/settlements/:id/void', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await voidSettlement(knex, req.params.id);
    res.json(settlement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- PDF payload (Phase 4) ----------
router.get('/settlements/:id/pdf-payload', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });
    const loadItems = await knex('settlement_load_items as sli')
      .join('loads as l', 'l.id', 'sli.load_id')
      .where('sli.settlement_id', req.params.id)
      .select('sli.*', 'l.load_number');
    const adjustmentItems = await knex('settlement_adjustment_items').where({ settlement_id: req.params.id });
    const driver = await knex('drivers').where({ id: settlement.driver_id }).select('first_name', 'last_name', 'email').first();
    const primaryPayee = await knex('payees').where({ id: settlement.primary_payee_id }).first();
    const period = await knex('payroll_periods').where({ id: settlement.payroll_period_id }).first();
    res.json({
      settlement,
      driver: driver || {},
      primary_payee: primaryPayee || {},
      additional_payee: settlement.additional_payee_id
        ? await knex('payees').where({ id: settlement.additional_payee_id }).first()
        : null,
      period: period || {},
      load_items: loadItems,
      adjustment_items: adjustmentItems
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Send settlement email (Phase 4) ----------
router.post('/settlements/:id/send-email', requireRole(settlementRoles), async (req, res) => {
  try {
    const settlement = await knex('settlements').where({ id: req.params.id }).first();
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });
    const { to_driver, to_additional_payee, cc_internal } = req.body;
    const primaryPayee = await knex('payees').where({ id: settlement.primary_payee_id }).first();
    const driver = await knex('drivers').where({ id: settlement.driver_id }).select('email').first();
    const recipients = [];
    if (to_driver !== false && driver?.email) recipients.push({ email: driver.email, role: 'driver' });
    if (to_additional_payee && settlement.additional_payee_id) {
      const addPayee = await knex('payees').where({ id: settlement.additional_payee_id }).first();
      if (addPayee?.email) recipients.push({ email: addPayee.email, role: 'additional_payee' });
    }
    if (primaryPayee?.email && !recipients.find((r) => r.email === primaryPayee.email)) {
      recipients.push({ email: primaryPayee.email, role: 'primary_payee' });
    }
    // Placeholder: actual SendGrid/mail send would go here; return payload for UI to show "email sent" or integrate with existing email service
    res.json({
      success: true,
      message: 'Email send requested',
      recipients,
      note: 'Configure SendGrid or mail service to send settlement PDF/link to recipients.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Imported expense sources (Phase 4) ----------
router.get('/imported-expense-sources', requireRole(settlementRoles), async (req, res) => {
  try {
    const rows = await knex('imported_expense_sources').orderBy('imported_at', 'desc').limit(100);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/imported-expense-sources', requireRole(settlementRoles), async (req, res) => {
  try {
    const { source_type, file_id, storage_key, parse_status, raw_metadata } = req.body;
    const [row] = await knex('imported_expense_sources')
      .insert({
        source_type: source_type || 'manual_upload',
        file_id: file_id ?? null,
        storage_key: storage_key ?? null,
        parse_status: parse_status ?? 'pending',
        raw_metadata: raw_metadata != null ? JSON.stringify(raw_metadata) : knex.raw("'{}'::jsonb"),
        imported_by: req.user?.id ?? null
      })
      .returning('*');
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/imported-expense-items', requireRole(settlementRoles), async (req, res) => {
  try {
    const { source_id, status, matched_driver_id } = req.query;
    let q = knex('imported_expense_items').orderBy('transaction_date', 'desc').limit(200);
    if (source_id) q = q.where('imported_source_id', source_id);
    if (status) q = q.where('status', status);
    if (matched_driver_id) q = q.where('matched_driver_id', matched_driver_id);
    const rows = await q;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/imported-expense-items/:id/match', requireRole(settlementRoles), async (req, res) => {
  try {
    const { matched_driver_id, matched_payee_id, matched_vehicle_id, match_confidence } = req.body;
    const [row] = await knex('imported_expense_items')
      .where({ id: req.params.id })
      .update({
        matched_driver_id: matched_driver_id ?? null,
        matched_payee_id: matched_payee_id ?? null,
        matched_vehicle_id: matched_vehicle_id ?? null,
        match_confidence: match_confidence ?? null,
        status: 'matched',
        updated_at: knex.fn.now()
      })
      .returning('*');
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/imported-expense-items/:id/apply-to-settlement', requireRole(settlementRoles), async (req, res) => {
  try {
    const { settlement_id } = req.body;
    if (!settlement_id) return res.status(400).json({ error: 'settlement_id required' });
    const item = await knex('imported_expense_items').where({ id: req.params.id }).first();
    if (!item) return res.status(404).json({ error: 'Expense item not found' });
    const [adj] = await knex('settlement_adjustment_items')
      .insert({
        settlement_id,
        item_type: 'deduction',
        source_type: 'imported_fuel',
        description: item.description || 'Imported expense',
        amount: Number(item.amount) || 0,
        charge_party: 'driver',
        apply_to: 'primary_payee',
        source_reference_id: item.id,
        source_reference_type: 'imported_expense_item',
        occurrence_date: item.transaction_date,
        status: 'applied',
        created_by: req.user?.id ?? null
      })
      .returning('*');
    await knex('imported_expense_items').where({ id: req.params.id }).update({
      settlement_adjustment_item_id: adj.id,
      status: 'applied',
      updated_at: knex.fn.now()
    });
    await recalcAndUpdateSettlement(knex, settlement_id);
    res.json(adj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
