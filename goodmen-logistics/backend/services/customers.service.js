const db = require('../config/knex');
const dtLogger = require('../utils/dynatrace-logger');

const CUSTOMER_TYPES = ['FLEET', 'WALK_IN', 'INTERNAL', 'WARRANTY'];
const STATUS_TYPES = ['ACTIVE', 'INACTIVE'];
const PAYMENT_TERMS = ['DUE_ON_RECEIPT', 'NET_15', 'NET_30', 'CUSTOM'];
const NOTE_TYPES = ['GENERAL', 'BILLING', 'SERVICE_ISSUE'];

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function normalizeDecimal(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function validateCustomerPayload(payload) {
  const errors = [];
  if (!normalizeText(payload.company_name)) errors.push('company_name is required');
  if (payload.customer_type && !CUSTOMER_TYPES.includes(payload.customer_type)) {
    errors.push('customer_type is invalid');
  }
  if (payload.status && !STATUS_TYPES.includes(payload.status)) {
    errors.push('status is invalid');
  }
  if (payload.payment_terms && !PAYMENT_TERMS.includes(payload.payment_terms)) {
    errors.push('payment_terms is invalid');
  }
  if (payload.payment_terms === 'CUSTOM' && !payload.payment_terms_custom_days) {
    errors.push('payment_terms_custom_days is required for CUSTOM terms');
  }
  return errors;
}

function buildAlerts(customer) {
  const missingBilling = !customer.billing_address_line1 || !customer.billing_city || !customer.billing_state || !customer.billing_zip || !customer.payment_terms;
  const inactive = customer.status === 'INACTIVE';
  return {
    missing_billing_info: missingBilling,
    inactive_warning: inactive,
    credit_limit_exceeded: false
  };
}

function getEffectivePricing(customer, pricingRule) {
  const isWarranty = customer.customer_type === 'WARRANTY';
  const effective = {
    default_labor_rate: pricingRule?.default_labor_rate ?? null,
    parts_discount_percent: pricingRule?.parts_discount_percent ?? null,
    labor_discount_percent: pricingRule?.labor_discount_percent ?? null,
    shop_supplies_percent: pricingRule?.shop_supplies_percent ?? null,
    tax_override_percent: pricingRule?.tax_override_percent ?? null,
    contract_pricing_enabled: pricingRule?.contract_pricing_enabled ?? false,
    warranty_labor_rate_zero: false
  };

  if (isWarranty && effective.default_labor_rate === null) {
    effective.default_labor_rate = 0.0;
    effective.warranty_labor_rate_zero = true;
  }

  return effective;
}

async function logAudit(customerId, field, oldValue, newValue, userId) {
  if (oldValue === newValue) return;
  await db('customer_audit_log').insert({
    customer_id: customerId,
    field,
    old_value: oldValue === undefined || oldValue === null ? null : String(oldValue),
    new_value: newValue === undefined || newValue === null ? null : String(newValue),
    changed_by_user_id: userId || null
  });
}

async function createCustomer(payload, userId) {
  const errors = validateCustomerPayload(payload);
  if (errors.length) {
    return { errors };
  }

  const insertData = {
    company_name: normalizeText(payload.company_name) || normalizeText(payload.name),
    customer_type: payload.customer_type || 'WALK_IN',
    status: payload.status || 'ACTIVE',
    tax_id: normalizeText(payload.tax_id),
    primary_contact_name: normalizeText(payload.primary_contact_name),
    phone: normalizeText(payload.phone),
    email: normalizeText(payload.email),
    secondary_phone: normalizeText(payload.secondary_phone),
    website: normalizeText(payload.website),
    billing_address_line1: normalizeText(payload.billing_address_line1) || normalizeText(payload.address),
    billing_address_line2: normalizeText(payload.billing_address_line2),
    billing_city: normalizeText(payload.billing_city) || normalizeText(payload.city),
    billing_state: normalizeText(payload.billing_state) || normalizeText(payload.state),
    billing_zip: normalizeText(payload.billing_zip) || normalizeText(payload.zip),
    billing_country: normalizeText(payload.billing_country),
    payment_terms: payload.payment_terms || 'DUE_ON_RECEIPT',
    payment_terms_custom_days: payload.payment_terms === 'CUSTOM' ? payload.payment_terms_custom_days : null,
    credit_limit: normalizeDecimal(payload.credit_limit),
    tax_exempt: payload.tax_exempt === true,
    billing_notes: normalizeText(payload.billing_notes),
    default_location_id: normalizeText(payload.default_location_id),
    dot_number: normalizeText(payload.dot_number),
    address: normalizeText(payload.address),
    city: normalizeText(payload.city),
    state: normalizeText(payload.state),
    zip: normalizeText(payload.zip),
    is_deleted: false
  };

  const [customer] = await db('customers').insert(insertData).returning('*');
  dtLogger.info('customer_created', { id: customer.id, company_name: customer.company_name });

  if (payload.pricing_rules) {
    await upsertPricingRules(customer.id, payload.pricing_rules, userId);
  }

  return { customer };
}

async function updateCustomer(id, payload, userId) {
  const customer = await db('customers').where({ id, is_deleted: false }).first();
  if (!customer) return { error: 'Customer not found' };

  const errors = validateCustomerPayload({ ...customer, ...payload });
  if (errors.length) return { errors };

  const updateData = {
    company_name: normalizeText(payload.company_name) ?? normalizeText(payload.name) ?? customer.company_name,
    customer_type: payload.customer_type || customer.customer_type,
    status: payload.status || customer.status,
    tax_id: normalizeText(payload.tax_id) ?? customer.tax_id,
    primary_contact_name: normalizeText(payload.primary_contact_name) ?? customer.primary_contact_name,
    phone: normalizeText(payload.phone) ?? customer.phone,
    email: normalizeText(payload.email) ?? customer.email,
    secondary_phone: normalizeText(payload.secondary_phone) ?? customer.secondary_phone,
    website: normalizeText(payload.website) ?? customer.website,
    billing_address_line1: normalizeText(payload.billing_address_line1) ?? normalizeText(payload.address) ?? customer.billing_address_line1,
    billing_address_line2: normalizeText(payload.billing_address_line2) ?? customer.billing_address_line2,
    billing_city: normalizeText(payload.billing_city) ?? normalizeText(payload.city) ?? customer.billing_city,
    billing_state: normalizeText(payload.billing_state) ?? normalizeText(payload.state) ?? customer.billing_state,
    billing_zip: normalizeText(payload.billing_zip) ?? normalizeText(payload.zip) ?? customer.billing_zip,
    billing_country: normalizeText(payload.billing_country) ?? customer.billing_country,
    payment_terms: payload.payment_terms || customer.payment_terms,
    payment_terms_custom_days: payload.payment_terms === 'CUSTOM'
      ? payload.payment_terms_custom_days
      : (payload.payment_terms ? null : customer.payment_terms_custom_days),
    credit_limit: payload.credit_limit !== undefined ? normalizeDecimal(payload.credit_limit) : customer.credit_limit,
    tax_exempt: payload.tax_exempt !== undefined ? payload.tax_exempt === true : customer.tax_exempt,
    billing_notes: normalizeText(payload.billing_notes) ?? customer.billing_notes,
    default_location_id: payload.default_location_id !== undefined ? normalizeText(payload.default_location_id) : customer.default_location_id,
    dot_number: payload.dot_number !== undefined ? normalizeText(payload.dot_number) : customer.dot_number,
    address: payload.address !== undefined ? normalizeText(payload.address) : customer.address,
    city: payload.city !== undefined ? normalizeText(payload.city) : customer.city,
    state: payload.state !== undefined ? normalizeText(payload.state) : customer.state,
    zip: payload.zip !== undefined ? normalizeText(payload.zip) : customer.zip,
    updated_at: db.fn.now()
  };

  const [updated] = await db('customers').where({ id }).update(updateData).returning('*');

  const auditFields = ['company_name','customer_type','status','tax_id','primary_contact_name','phone','email','secondary_phone','website','billing_address_line1','billing_address_line2','billing_city','billing_state','billing_zip','billing_country','payment_terms','payment_terms_custom_days','credit_limit','tax_exempt','billing_notes','default_location_id'];
  for (const field of auditFields) {
    await logAudit(id, field, customer[field], updated[field], userId);
  }

  if (payload.pricing_rules) {
    await upsertPricingRules(id, payload.pricing_rules, userId);
  }

  dtLogger.info('customer_updated', { id, company_name: updated.company_name });
  return { customer: updated };
}

async function listCustomers({ search, type, status, locationId, dot, paymentTerms, page = 1, pageSize = 20 }) {
  const limit = Math.max(parseInt(pageSize, 10) || 20, 1);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  const baseQuery = db('customers')
    .where(function() {
      this.where('is_deleted', false).orWhereNull('is_deleted');
    })
    .modify(qb => {
      if (dot) {
        qb.andWhere('dot_number', dot);
      } else if (search) {
        qb.andWhere(function() {
          this.where('company_name', 'ilike', `%${search}%`)
            .orWhere('phone', 'ilike', `%${search}%`)
            .orWhere('email', 'ilike', `%${search}%`);
        });
      }
      if (type) qb.andWhere('customer_type', type);
      if (status) qb.andWhere('status', status);
      if (locationId) qb.andWhere('default_location_id', locationId);
      if (paymentTerms) qb.andWhere('payment_terms', paymentTerms);
    });

  const [{ count }] = await baseQuery.clone().count();

  const rows = await baseQuery.clone()
    .select(
      'customers.*',
      db.raw('(SELECT MAX(date_performed) FROM maintenance_records WHERE maintenance_records.customer_id = customers.id) as last_service_date')
    )
    .orderBy('company_name', 'asc')
    .limit(limit)
    .offset(offset);

  return { rows, total: parseInt(count, 10) || 0, page: parseInt(page, 10) || 1, pageSize: limit };
}

async function getCustomerById(id) {
  const customer = await db('customers').where({ id, is_deleted: false }).first();
  if (!customer) return null;

  const pricingRule = await db('customer_pricing_rules').where({ customer_id: id }).first();
  const alerts = buildAlerts(customer);
  const effectivePricing = getEffectivePricing(customer, pricingRule);

  return { customer, pricingRule, effectivePricing, alerts };
}

async function setCustomerStatus(id, status, userId) {
  const customer = await db('customers').where({ id, is_deleted: false }).first();
  if (!customer) return { error: 'Customer not found' };
  if (!STATUS_TYPES.includes(status)) return { error: 'Invalid status' };

  const [updated] = await db('customers').where({ id }).update({ status, updated_at: db.fn.now() }).returning('*');
  await logAudit(id, 'status', customer.status, status, userId);
  return { customer: updated };
}

async function softDeleteCustomer(id, userId) {
  const customer = await db('customers').where({ id, is_deleted: false }).first();
  if (!customer) return { error: 'Customer not found' };
  const [updated] = await db('customers').where({ id }).update({ is_deleted: true, status: 'INACTIVE', updated_at: db.fn.now() }).returning('*');
  await logAudit(id, 'is_deleted', customer.is_deleted, true, userId);
  return { customer: updated };
}

async function addNote(customerId, payload, userId) {
  if (!NOTE_TYPES.includes(payload.note_type)) {
    return { error: 'Invalid note_type' };
  }
  if (!normalizeText(payload.note)) {
    return { error: 'note is required' };
  }
  const [note] = await db('customer_notes').insert({
    customer_id: customerId,
    note_type: payload.note_type,
    note: payload.note,
    created_by_user_id: userId || null
  }).returning('*');

  return { note };
}

async function getNotes(customerId) {
  const notes = await db('customer_notes')
    .where({ customer_id: customerId })
    .orderBy('created_at', 'desc');
  return notes;
}

async function upsertPricingRules(customerId, payload, userId) {
  const existing = await db('customer_pricing_rules').where({ customer_id: customerId }).first();
  const updateData = {
    default_labor_rate: normalizeDecimal(payload.default_labor_rate),
    parts_discount_percent: normalizeDecimal(payload.parts_discount_percent),
    labor_discount_percent: normalizeDecimal(payload.labor_discount_percent),
    shop_supplies_percent: normalizeDecimal(payload.shop_supplies_percent),
    tax_override_percent: normalizeDecimal(payload.tax_override_percent),
    contract_pricing_enabled: payload.contract_pricing_enabled === true,
    updated_at: db.fn.now()
  };

  if (existing) {
    const [updated] = await db('customer_pricing_rules').where({ customer_id: customerId }).update(updateData).returning('*');
    await logAudit(customerId, 'pricing_rules', JSON.stringify(existing), JSON.stringify(updated), userId);
    return updated;
  }

  const [created] = await db('customer_pricing_rules').insert({
    customer_id: customerId,
    ...updateData,
    created_at: db.fn.now()
  }).returning('*');
  await logAudit(customerId, 'pricing_rules', null, JSON.stringify(created), userId);
  return created;
}

async function getCustomerWorkOrders(customerId, { status, from, to, page = 1, pageSize = 20 }) {
  const limit = Math.max(parseInt(pageSize, 10) || 20, 1);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let query = db('maintenance_records')
    .where({ customer_id: customerId })
    .modify(qb => {
      if (status) qb.andWhere('status', status);
      if (from) qb.andWhere('date_performed', '>=', from);
      if (to) qb.andWhere('date_performed', '<=', to);
    });

  const [{ count }] = await query.clone().count();
  const rows = await query
    .orderBy('date_performed', 'desc')
    .limit(limit)
    .offset(offset);

  return { rows, total: parseInt(count, 10) || 0, page: parseInt(page, 10) || 1, pageSize: limit };
}

async function getCustomerServiceHistory(customerId, { from, to, page = 1, pageSize = 20 }) {
  const limit = Math.max(parseInt(pageSize, 10) || 20, 1);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let query = db('maintenance_records')
    .where({ customer_id: customerId })
    .andWhere('status', 'completed')
    .modify(qb => {
      if (from) qb.andWhere('date_performed', '>=', from);
      if (to) qb.andWhere('date_performed', '<=', to);
    });

  const [{ count }] = await query.clone().count();
  const rows = await query
    .orderBy('date_performed', 'desc')
    .limit(limit)
    .offset(offset);

  return { rows, total: parseInt(count, 10) || 0, page: parseInt(page, 10) || 1, pageSize: limit };
}

module.exports = {
  createCustomer,
  updateCustomer,
  listCustomers,
  getCustomerById,
  setCustomerStatus,
  softDeleteCustomer,
  addNote,
  getNotes,
  upsertPricingRules,
  getCustomerWorkOrders,
  getCustomerServiceHistory,
  getEffectivePricing
};
