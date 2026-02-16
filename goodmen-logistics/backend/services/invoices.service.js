const db = require('../config/knex');
const dtLogger = require('../utils/dynatrace-logger');
const { generateInvoiceNumber } = require('../utils/invoice-number');

function normalizeDecimal(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number(value);
  return Number.isNaN(num) ? 0 : num;
}

function computeDueDate(issuedDate, paymentTerms, customDays) {
  if (!issuedDate) return null;
  const base = new Date(issuedDate);
  let days = 0;
  if (paymentTerms === 'NET_15') days = 15;
  if (paymentTerms === 'NET_30') days = 30;
  if (paymentTerms === 'CUSTOM') days = Number(customDays) || 0;
  if (days <= 0) return issuedDate;
  const due = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return due.toISOString().slice(0, 10);
}

async function recomputeInvoiceTotals(trx, invoiceId) {
  const lineItems = await trx('invoice_line_items').where({ invoice_id: invoiceId });
  const payments = await trx('invoice_payments').where({ invoice_id: invoiceId });
  const invoice = await trx('invoices').where({ id: invoiceId }).first();

  const subtotalLabor = lineItems.filter(l => l.line_type === 'LABOR').reduce((sum, l) => sum + normalizeDecimal(l.line_total), 0);
  const subtotalParts = lineItems.filter(l => l.line_type === 'PART').reduce((sum, l) => sum + normalizeDecimal(l.line_total), 0);
  const subtotalFees = lineItems.filter(l => l.line_type === 'FEE' || l.line_type === 'ADJUSTMENT').reduce((sum, l) => sum + normalizeDecimal(l.line_total), 0);
  const subtotal = subtotalLabor + subtotalParts + subtotalFees;

  const discountType = invoice.discount_type || 'NONE';
  const discountValue = normalizeDecimal(invoice.discount_value);
  const discountAmount = discountType === 'PERCENT' ? subtotal * (discountValue / 100) : (discountType === 'AMOUNT' ? discountValue : 0);

  const taxableSubtotal = lineItems.filter(l => l.taxable).reduce((sum, l) => sum + normalizeDecimal(l.line_total), 0);
  const taxableAfterDiscount = subtotal > 0 ? taxableSubtotal - (discountAmount * (taxableSubtotal / subtotal)) : taxableSubtotal;
  const taxRate = normalizeDecimal(invoice.tax_rate_percent);
  const taxAmount = taxableAfterDiscount * (taxRate / 100);

  const totalAmount = subtotal - discountAmount + taxAmount;
  const amountPaid = payments.reduce((sum, p) => sum + normalizeDecimal(p.amount), 0);
  const balanceDue = totalAmount - amountPaid;

  let status = invoice.status;
  if (status !== 'VOID') {
    if (balanceDue <= 0 && totalAmount > 0) status = 'PAID';
    else if (amountPaid > 0) status = 'PARTIAL';
    else if (status === 'PAID') status = 'DRAFT';
  }

  const [updated] = await trx('invoices')
    .where({ id: invoiceId })
    .update({
      subtotal_labor: subtotalLabor,
      subtotal_parts: subtotalParts,
      subtotal_fees: subtotalFees,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      status,
      updated_at: trx.fn.now()
    })
    .returning('*');

  return { invoice: updated, lineItems, payments };
}

async function createInvoiceFromWorkOrder(workOrderId, payload, userId) {
  return db.transaction(async trx => {
    let workOrder = await trx('work_orders').where({ id: workOrderId }).first();
    let locationId = workOrder?.location_id || null;
    let customerId = workOrder?.customer_id || null;
    let description = workOrder?.description || 'Work order charges';

    if (!workOrder) {
      const mr = await trx('maintenance_records as mr')
        .join('vehicles as v', 'mr.vehicle_id', 'v.id')
        .select('mr.*', 'v.location_id')
        .where('mr.id', workOrderId)
        .first();
      if (!mr) throw new Error('Work order not found');
      workOrder = mr;
      locationId = mr.location_id;
      customerId = mr.customer_id;
      description = mr.description || 'Work order charges';
    }

    if (!customerId) throw new Error('Work order must have a customer');

    const customer = await trx('customers').where({ id: customerId }).first();
    if (!customer || customer.is_deleted) throw new Error('Customer not found');
    if (customer.status === 'INACTIVE') throw new Error('Inactive customer cannot be invoiced');

    const invoiceNumber = await generateInvoiceNumber(trx);
    const issuedDate = payload.issuedDate || new Date().toISOString().slice(0, 10);
    const paymentTerms = payload.paymentTerms || customer.payment_terms || 'DUE_ON_RECEIPT';
    const dueDate = payload.dueDate || computeDueDate(issuedDate, paymentTerms, customer.payment_terms_custom_days);

    const [invoice] = await trx('invoices').insert({
      invoice_number: invoiceNumber,
      work_order_id: workOrder?.id || null,
      customer_id: customerId,
      location_id: locationId,
      status: 'DRAFT',
      issued_date: issuedDate,
      due_date: dueDate,
      payment_terms: paymentTerms,
      notes: payload.notes || null,
      discount_type: payload.discountType || 'NONE',
      discount_value: payload.discountValue || 0,
      tax_rate_percent: payload.taxRatePercent || 0,
      created_by_user_id: userId || null
    }).returning('*');

    const lineItems = [];

    if (workOrder?.id && workOrder?.description && workOrder?.cost !== undefined) {
      lineItems.push({
        invoice_id: invoice.id,
        line_type: 'LABOR',
        source_ref_type: 'maintenance_records',
        source_ref_id: workOrder.id,
        description,
        quantity: 1,
        unit_price: workOrder.cost,
        taxable: true,
        line_total: workOrder.cost
      });
    }

    if (lineItems.length === 0) {
      lineItems.push({
        invoice_id: invoice.id,
        line_type: 'FEE',
        source_ref_type: 'manual',
        description,
        quantity: 1,
        unit_price: 0,
        taxable: false,
        line_total: 0
      });
    }

    await trx('invoice_line_items').insert(lineItems);

    const updated = await recomputeInvoiceTotals(trx, invoice.id);
    return updated.invoice;
  });
}

async function createManualInvoice(payload, userId) {
  return db.transaction(async trx => {
    const invoiceNumber = await generateInvoiceNumber(trx);
    const issuedDate = payload.issuedDate || new Date().toISOString().slice(0, 10);
    const dueDate = payload.dueDate || computeDueDate(issuedDate, payload.paymentTerms, payload.paymentTermsCustomDays);

    const [invoice] = await trx('invoices').insert({
      invoice_number: invoiceNumber,
      work_order_id: payload.workOrderId || null,
      customer_id: payload.customerId,
      location_id: payload.locationId,
      status: 'DRAFT',
      issued_date: issuedDate,
      due_date: dueDate,
      payment_terms: payload.paymentTerms || 'DUE_ON_RECEIPT',
      notes: payload.notes || null,
      discount_type: payload.discountType || 'NONE',
      discount_value: payload.discountValue || 0,
      tax_rate_percent: payload.taxRatePercent || 0,
      created_by_user_id: userId || null
    }).returning('*');

    const lineItems = (payload.lineItems || []).map(item => ({
      invoice_id: invoice.id,
      line_type: item.line_type,
      source_ref_type: item.source_ref_type || 'manual',
      source_ref_id: item.source_ref_id || null,
      description: item.description,
      quantity: normalizeDecimal(item.quantity) || 1,
      unit_price: normalizeDecimal(item.unit_price),
      taxable: item.taxable === true,
      line_total: normalizeDecimal(item.quantity) * normalizeDecimal(item.unit_price)
    }));

    if (lineItems.length) {
      await trx('invoice_line_items').insert(lineItems);
    }

    const updated = await recomputeInvoiceTotals(trx, invoice.id);
    return updated.invoice;
  });
}

async function listInvoices(filters) {
  const {
    search,
    status,
    customerId,
    locationId,
    dateFrom,
    dateTo,
    page = 1,
    pageSize = 20
  } = filters;

  const limit = Math.max(parseInt(pageSize, 10) || 20, 1);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  const baseQuery = db('invoices')
    .join('customers', 'invoices.customer_id', 'customers.id')
    .where({ 'invoices.is_deleted': false })
    .modify(qb => {
      if (search) {
        qb.andWhere(function() {
          this.where('invoices.invoice_number', 'ilike', `%${search}%`)
            .orWhere('customers.company_name', 'ilike', `%${search}%`);
        });
      }
      if (status) qb.andWhere('invoices.status', status);
      if (customerId) qb.andWhere('invoices.customer_id', customerId);
      if (locationId) qb.andWhere('invoices.location_id', locationId);
      if (dateFrom) qb.andWhere('invoices.issued_date', '>=', dateFrom);
      if (dateTo) qb.andWhere('invoices.issued_date', '<=', dateTo);
    });

  const [{ count }] = await baseQuery.clone().count();
  const rows = await baseQuery
    .clone()
    .select('invoices.*', 'customers.company_name')
    .orderBy('invoices.issued_date', 'desc')
    .limit(limit)
    .offset(offset);

  return { rows, total: parseInt(count, 10) || 0, page: parseInt(page, 10) || 1, pageSize: limit };
}

async function getInvoiceById(id) {
  const invoice = await db('invoices').where({ id, is_deleted: false }).first();
  if (!invoice) return null;
  const lineItems = await db('invoice_line_items').where({ invoice_id: id });
  const payments = await db('invoice_payments').where({ invoice_id: id }).orderBy('payment_date', 'desc');
  const documents = await db('invoice_documents').where({ invoice_id: id }).orderBy('created_at', 'desc');
  return { invoice, lineItems, payments, documents };
}

async function updateInvoiceDraft(id, payload, userId) {
  return db.transaction(async trx => {
    const invoice = await trx('invoices').where({ id }).first();
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status !== 'DRAFT') throw new Error('Only DRAFT invoices can be edited');

    await trx('invoices')
      .where({ id })
      .update({
        notes: payload.notes ?? invoice.notes,
        discount_type: payload.discountType ?? invoice.discount_type,
        discount_value: payload.discountValue ?? invoice.discount_value,
        tax_rate_percent: payload.taxRatePercent ?? invoice.tax_rate_percent,
        issued_date: payload.issuedDate ?? invoice.issued_date,
        due_date: payload.dueDate ?? invoice.due_date,
        updated_at: trx.fn.now()
      });

    if (Array.isArray(payload.lineItems)) {
      await trx('invoice_line_items').where({ invoice_id: id }).del();
      if (payload.lineItems.length) {
        const items = payload.lineItems.map(item => ({
          invoice_id: id,
          line_type: item.line_type,
          source_ref_type: item.source_ref_type || 'manual',
          source_ref_id: item.source_ref_id || null,
          description: item.description,
          quantity: normalizeDecimal(item.quantity) || 1,
          unit_price: normalizeDecimal(item.unit_price),
          taxable: item.taxable === true,
          line_total: normalizeDecimal(item.quantity) * normalizeDecimal(item.unit_price)
        }));
        await trx('invoice_line_items').insert(items);
      }
    }

    const updated = await recomputeInvoiceTotals(trx, id);
    return updated.invoice;
  });
}

async function setInvoiceStatus(id, status, reason, userId) {
  return db.transaction(async trx => {
    const invoice = await trx('invoices').where({ id }).first();
    if (!invoice) throw new Error('Invoice not found');

    if (status === 'SENT') {
      if (!invoice.issued_date || !invoice.due_date) throw new Error('issued_date and due_date are required before sending');
    }

    if (status === 'VOID') {
      if (!reason) throw new Error('void reason is required');
      if (invoice.status === 'PAID') throw new Error('Paid invoices cannot be voided');
    }

    await trx('invoices').where({ id }).update({
      status,
      voided_reason: status === 'VOID' ? reason : invoice.voided_reason,
      voided_at: status === 'VOID' ? trx.fn.now() : invoice.voided_at,
      updated_at: trx.fn.now()
    });

    await trx('invoice_events').insert({
      invoice_id: id,
      event_type: 'STATUS_CHANGE',
      from_status: invoice.status,
      to_status: status,
      data_json: reason ? { reason } : null,
      created_by_user_id: userId || null
    });

    const updated = await trx('invoices').where({ id }).first();
    return updated;
  });
}

async function addPayment(invoiceId, payload, userId) {
  return db.transaction(async trx => {
    const invoice = await trx('invoices').where({ id: invoiceId }).first();
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === 'VOID') throw new Error('Cannot pay a void invoice');

    const amount = normalizeDecimal(payload.amount);
    if (amount <= 0) throw new Error('Payment amount must be greater than zero');

    if (amount > normalizeDecimal(invoice.balance_due)) {
      throw new Error('Payment exceeds balance due');
    }

    await trx('invoice_payments').insert({
      invoice_id: invoiceId,
      payment_date: payload.paymentDate,
      amount,
      method: payload.method,
      reference_number: payload.referenceNumber || null,
      memo: payload.memo || null,
      received_by_user_id: userId || null
    });

    const updated = await recomputeInvoiceTotals(trx, invoiceId);
    return updated.invoice;
  });
}

async function deletePayment(invoiceId, paymentId) {
  return db.transaction(async trx => {
    await trx('invoice_payments').where({ id: paymentId, invoice_id: invoiceId }).del();
    const updated = await recomputeInvoiceTotals(trx, invoiceId);
    return updated.invoice;
  });
}

async function addLineItem(invoiceId, payload) {
  return db.transaction(async trx => {
    const invoice = await trx('invoices').where({ id: invoiceId }).first();
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status !== 'DRAFT') throw new Error('Only DRAFT invoices can be edited');

    const [item] = await trx('invoice_line_items').insert({
      invoice_id: invoiceId,
      line_type: payload.line_type,
      source_ref_type: payload.source_ref_type || 'manual',
      source_ref_id: payload.source_ref_id || null,
      description: payload.description,
      quantity: normalizeDecimal(payload.quantity) || 1,
      unit_price: normalizeDecimal(payload.unit_price),
      taxable: payload.taxable === true,
      line_total: normalizeDecimal(payload.quantity) * normalizeDecimal(payload.unit_price)
    }).returning('*');

    await recomputeInvoiceTotals(trx, invoiceId);
    return item;
  });
}

async function updateLineItem(invoiceId, lineItemId, payload) {
  return db.transaction(async trx => {
    const invoice = await trx('invoices').where({ id: invoiceId }).first();
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status !== 'DRAFT') throw new Error('Only DRAFT invoices can be edited');

    const [item] = await trx('invoice_line_items')
      .where({ id: lineItemId, invoice_id: invoiceId })
      .update({
        description: payload.description,
        quantity: normalizeDecimal(payload.quantity) || 1,
        unit_price: normalizeDecimal(payload.unit_price),
        taxable: payload.taxable === true,
        line_total: normalizeDecimal(payload.quantity) * normalizeDecimal(payload.unit_price),
        updated_at: trx.fn.now()
      })
      .returning('*');

    await recomputeInvoiceTotals(trx, invoiceId);
    return item;
  });
}

async function deleteLineItem(invoiceId, lineItemId) {
  return db.transaction(async trx => {
    const invoice = await trx('invoices').where({ id: invoiceId }).first();
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status !== 'DRAFT') throw new Error('Only DRAFT invoices can be edited');

    await trx('invoice_line_items').where({ id: lineItemId, invoice_id: invoiceId }).del();
    await recomputeInvoiceTotals(trx, invoiceId);
  });
}

module.exports = {
  recomputeInvoiceTotals,
  createInvoiceFromWorkOrder,
  createManualInvoice,
  listInvoices,
  getInvoiceById,
  updateInvoiceDraft,
  setInvoiceStatus,
  addPayment,
  deletePayment,
  addLineItem,
  updateLineItem,
  deleteLineItem
};
