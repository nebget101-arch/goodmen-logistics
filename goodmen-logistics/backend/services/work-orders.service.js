const db = require('../config/knex');
const dtLogger = require('../utils/dynatrace-logger');
const { generateInvoiceNumber } = require('../utils/invoice-number');
const { recomputeInvoiceTotals } = require('./invoices.service');
const creditService = require('./credit.service');
const barcodesService = require('./barcodes.service');

const STATUS_TRANSITIONS = {
  DRAFT: ['IN_PROGRESS', 'CANCELED'],
  IN_PROGRESS: ['WAITING_PARTS', 'COMPLETED', 'CANCELED'],
  WAITING_PARTS: ['COMPLETED', 'CANCELED'],
  COMPLETED: ['CLOSED', 'CANCELED'],
  CLOSED: [],
  CANCELED: []
};

async function resolveUserId(trx, userId) {
  if (!userId) return null;
  const user = await trx('users').where({ id: userId }).first();
  return user ? userId : null;
}

async function resolveUserIdByUsername(trx, username) {
  const normalized = (username || '').toString().trim().toLowerCase();
  if (!normalized) return null;
  const user = await trx('users').whereRaw('LOWER(username) = ?', [normalized]).first();
  return user ? user.id : null;
}

async function resolveMechanicUserId(trx, line) {
  const directId = normalizeUuid(line?.mechanicId || line?.mechanic_user_id);
  if (directId) return directId;

  const name = (line?.mechanicName || line?.mechanic_username || line?.username || '').toString().trim().toLowerCase();
  if (!name) return null;

  const user = await trx('users').whereRaw('LOWER(username) = ?', [name]).first();
  return user ? user.id : null;
}

const LEGACY_STATUS_VALUES = ['open', 'in_progress', 'completed', 'closed'];
const STATUS_MAP = {
  DRAFT: 'open',
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  WAITING_PARTS: 'in_progress',
  COMPLETED: 'completed',
  CLOSED: 'closed',
  CANCELED: 'closed'
};

function normalizeDecimal(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number(value);
  return Number.isNaN(num) ? 0 : num;
}

function normalizeStatus(value, fallback) {
  if (!value) return fallback;
  const normalized = String(value).trim();
  if (LEGACY_STATUS_VALUES.includes(normalized)) return normalized;
  const mapped = STATUS_MAP[normalized.toUpperCase()];
  return mapped || fallback;
}

function normalizeUuid(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
}

function normalizeOdometer(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : Math.trunc(num);
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

function computeTotalsFromLines({ laborLines, partLines, feeLines, discountType, discountValue, taxRatePercent }) {
  const laborSubtotal = laborLines.reduce((sum, l) => sum + normalizeDecimal(l.line_total), 0);
  const partsSubtotal = partLines.reduce((sum, l) => sum + normalizeDecimal(l.line_total), 0);
  const feesSubtotal = feeLines.reduce((sum, l) => sum + normalizeDecimal(l.amount), 0);
  const subtotal = laborSubtotal + partsSubtotal + feesSubtotal;

  const discountTypeValue = discountType || 'NONE';
  const discountVal = normalizeDecimal(discountValue);
  const discountAmount = discountTypeValue === 'PERCENT'
    ? subtotal * (discountVal / 100)
    : (discountTypeValue === 'AMOUNT' ? discountVal : 0);

  const taxableSubtotal = laborLines.filter(l => l.taxable)
    .reduce((sum, l) => sum + normalizeDecimal(l.line_total), 0)
    + partLines.filter(l => l.taxable)
      .reduce((sum, l) => sum + normalizeDecimal(l.line_total), 0)
    + feeLines.filter(l => l.taxable)
      .reduce((sum, l) => sum + normalizeDecimal(l.amount), 0);

  const taxRate = normalizeDecimal(taxRatePercent);
  const taxableAfterDiscount = subtotal > 0 ? taxableSubtotal - (discountAmount * (taxableSubtotal / subtotal)) : taxableSubtotal;
  const taxAmount = taxableAfterDiscount * (taxRate / 100);

  const totalAmount = subtotal - discountAmount + taxAmount;

  return {
    laborSubtotal,
    partsSubtotal,
    feesSubtotal,
    discountAmount,
    taxAmount,
    totalAmount
  };
}

async function recomputeWorkOrderTotals(trx, workOrderId) {
  const laborLines = await trx('work_order_labor_items').where({ work_order_id: workOrderId });
  const partLines = await trx('work_order_part_items').where({ work_order_id: workOrderId });
  const feeLines = await trx('work_order_fees').where({ work_order_id: workOrderId });
  const workOrder = await trx('work_orders').where({ id: workOrderId }).first();

  if (!workOrder) throw new Error('Work order not found');

  const totals = computeTotalsFromLines({
    laborLines,
    partLines,
    feeLines,
    discountType: workOrder.discount_type,
    discountValue: workOrder.discount_value,
    taxRatePercent: workOrder.tax_rate_percent
  });

  const [updated] = await trx('work_orders')
    .where({ id: workOrderId })
    .update({
      labor_subtotal: totals.laborSubtotal,
      parts_subtotal: totals.partsSubtotal,
      fees_subtotal: totals.feesSubtotal,
      tax_amount: totals.taxAmount,
      total_amount: totals.totalAmount,
      updated_at: trx.fn.now()
    })
    .returning('*');

  return { workOrder: updated, laborLines, partLines, feeLines, totals };
}

async function listWorkOrders(filters = {}) {
  const {
    search,
    status,
    type,
    priority,
    locationId,
    customerId,
    vehicleId,
    invoiceStatus,
    dateFrom,
    dateTo,
    page = 1,
    pageSize = 20
  } = filters;

  const limit = Math.max(parseInt(pageSize, 10) || 20, 1);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  const latestInvoice = db('invoices as i')
    .select('i.id', 'i.status', 'i.work_order_id')
    .distinctOn('i.work_order_id')
    .orderBy('i.work_order_id')
    .orderBy('i.created_at', 'desc')
    .as('i');

  const baseQuery = db('work_orders as wo')
    .leftJoin('all_vehicles as v', 'wo.vehicle_id', 'v.id')
    .leftJoin('customers as c', 'wo.customer_id', 'c.id')
    .leftJoin('locations as l', 'wo.location_id', 'l.id')
    .leftJoin(latestInvoice, 'wo.id', 'i.work_order_id')
    .select(
      'wo.id',
      'wo.work_order_number',
      'wo.type',
      'wo.description',
      'wo.total_amount',
      'wo.priority',
      'wo.status',
      'wo.created_at',
      'wo.updated_at',
      'v.unit_number as vehicle_unit',
      'v.vin as vehicle_vin',
      db.raw('c.company_name as customer_name'),
      'l.name as location_name',
      'i.status as invoice_status',
      'i.id as invoice_id'
    )
    .modify(qb => {
      if (search) {
        qb.andWhere(function() {
          this.where('wo.work_order_number', 'ilike', `%${search}%`)
            .orWhere('v.unit_number', 'ilike', `%${search}%`)
            .orWhere('v.vin', 'ilike', `%${search}%`)
            .orWhere('c.company_name', 'ilike', `%${search}%`);
        });
      }
      if (status) qb.andWhere('wo.status', status);
      if (type) qb.andWhere('wo.type', type);
      if (priority) qb.andWhere('wo.priority', priority);
      if (locationId) qb.andWhere('wo.location_id', locationId);
      if (customerId) qb.andWhere('wo.customer_id', customerId);
      if (vehicleId) qb.andWhere('wo.vehicle_id', vehicleId);
      if (invoiceStatus) qb.andWhere('i.status', invoiceStatus);
      if (dateFrom) qb.andWhere('wo.created_at', '>=', dateFrom);
      if (dateTo) qb.andWhere('wo.created_at', '<=', dateTo);
    });

  const [{ count }] = await baseQuery.clone().clearSelect().count('wo.id as count');

  const rows = await baseQuery
    .orderBy('wo.created_at', 'desc')
    .limit(limit)
    .offset(offset);

  return { rows, total: parseInt(count, 10) || 0, page: parseInt(page, 10) || 1, pageSize: limit };
}

async function getWorkOrderById(workOrderId) {
  const workOrder = await db('work_orders').where({ id: workOrderId }).first();
  if (!workOrder) return null;

  let requestedBy = null;
  const requestedByUserId = workOrder.requested_by_user_id;
  if (requestedByUserId) {
    const requester = await db('users').where({ id: requestedByUserId }).first();
    if (requester) {
      requestedBy = {
        id: requester.id,
        username: requester.username,
        first_name: requester.first_name || null,
        last_name: requester.last_name || null,
        email: requester.email || null
      };
      workOrder.requested_by_username = requester.username;
    }
  }

  let assignedMechanic = null;
  if (workOrder.assigned_mechanic_user_id) {
    assignedMechanic = await db('users').where({ id: workOrder.assigned_mechanic_user_id }).first();
    if (assignedMechanic) {
      workOrder.assigned_mechanic_username = assignedMechanic.username;
      workOrder.assigned_to = assignedMechanic.username;
    }
  }

  const vehicle = await db('all_vehicles').where({ id: workOrder.vehicle_id }).first();
  const customer = workOrder.customer_id ? await db('customers').where({ id: workOrder.customer_id }).first() : null;
  const location = workOrder.location_id ? await db('locations').where({ id: workOrder.location_id }).first() : null;
  const labor = await db('work_order_labor_items as woli')
    .leftJoin('users as u', 'woli.mechanic_user_id', 'u.id')
    .select('woli.*', 'u.username as mechanic_username', 'u.first_name as mechanic_first_name', 'u.last_name as mechanic_last_name')
    .where({ 'woli.work_order_id': workOrderId })
    .orderBy('woli.created_at');
  if (assignedMechanic) {
    labor.forEach(line => {
      if (!line.mechanic_user_id) {
        line.mechanic_user_id = assignedMechanic.id;
        line.mechanic_username = assignedMechanic.username;
        line.mechanic_first_name = assignedMechanic.first_name || null;
        line.mechanic_last_name = assignedMechanic.last_name || null;
      }
    });
  }
  const parts = await db('work_order_part_items as wopi')
    .leftJoin('parts as p', 'wopi.part_id', 'p.id')
    .select('wopi.*', 'p.sku as part_sku', 'p.name as part_name')
    .where({ 'wopi.work_order_id': workOrderId })
    .orderBy('wopi.created_at');
  const fees = await db('work_order_fees').where({ work_order_id: workOrderId }).orderBy('created_at');
  const invoices = await db('invoices').where({ work_order_id: workOrderId }).orderBy('created_at', 'desc');
  const documents = await db('work_order_documents').where({ work_order_id: workOrderId }).orderBy('created_at', 'desc');

  return { workOrder, vehicle, customer, location, labor, parts, fees, invoices, documents, requestedBy };
}

async function createWorkOrder(payload, userId) {
  return db.transaction(async trx => {
    if (!normalizeUuid(payload.vehicleId) || !normalizeUuid(payload.locationId)) {
      throw new Error('vehicleId and locationId are required');
    }

    if (payload.customerId) {
      const customer = await trx('customers').where({ id: payload.customerId }).first();
      if (!customer || customer.is_deleted) throw new Error('Customer not found');
      if (customer.status === 'INACTIVE') throw new Error('Inactive customers cannot be used for work orders');
    }

    const maxResult = await trx.raw(
      "SELECT MAX(NULLIF(regexp_replace(work_order_number, '\\D', '', 'g'), '')::int) AS max_seq FROM work_orders"
    );
    const maxSeq = maxResult?.rows?.[0]?.max_seq || 0;
    const workOrderNumber = `WO-${maxSeq + 1}`;

    let resolvedUserId = normalizeUuid(userId);
    if (!resolvedUserId) {
      resolvedUserId = await resolveUserIdByUsername(trx, payload.requestedBy || payload.requestedByUsername);
    }

    const resolvedDescription = payload.description || payload.title || 'Work order';
    const [workOrder] = await trx('work_orders').insert({
      work_order_number: workOrderNumber,
      vehicle_id: normalizeUuid(payload.vehicleId),
      customer_id: normalizeUuid(payload.customerId),
      location_id: normalizeUuid(payload.locationId),
      type: payload.type || 'REPAIR',
      priority: payload.priority || 'NORMAL',
      status: normalizeStatus(payload.status, 'open'),
      description: resolvedDescription,
      odometer_miles: normalizeOdometer(payload.odometerMiles),
      assigned_mechanic_user_id: normalizeUuid(payload.assignedMechanicUserId),
      requested_by_user_id: resolvedUserId,
      discount_type: payload.discountType || 'NONE',
      discount_value: payload.discountValue || 0,
      tax_rate_percent: payload.taxRatePercent || 0,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    }).returning('*');

    if (Array.isArray(payload.labor)) {
      for (const line of payload.labor) {
        const hours = normalizeDecimal(line.hours);
        const rate = normalizeDecimal(line.labor_rate ?? line.rate);
        const mechanicUserId = await resolveMechanicUserId(trx, line) || normalizeUuid(payload.assignedMechanicUserId);
        await trx('work_order_labor_items').insert({
          work_order_id: workOrder.id,
          mechanic_user_id: mechanicUserId,
          description: line.description || 'Labor',
          hours,
          labor_rate: rate,
          taxable: line.taxable === true,
          line_total: hours * rate
        });
      }
    }

    if (Array.isArray(payload.fees)) {
      for (const fee of payload.fees) {
        await trx('work_order_fees').insert({
          work_order_id: workOrder.id,
          fee_type: fee.fee_type || fee.feeType || 'MISC',
          amount: normalizeDecimal(fee.amount),
          taxable: fee.taxable === true
        });
      }
    }

    await recomputeWorkOrderTotals(trx, workOrder.id);

    return workOrder;
  });
}

async function updateWorkOrder(workOrderId, payload, userId) {
  return db.transaction(async trx => {
    const workOrder = await trx('work_orders').where({ id: workOrderId }).first();
    if (!workOrder) throw new Error('Work order not found');

    if (payload.customerId) {
      const customer = await trx('customers').where({ id: payload.customerId }).first();
      if (!customer || customer.is_deleted) throw new Error('Customer not found');
      if (customer.status === 'INACTIVE') throw new Error('Inactive customers cannot be used for work orders');
    }

    const vehicleId = normalizeUuid(payload.vehicleId ?? workOrder.vehicle_id);
    const customerId = normalizeUuid(payload.customerId ?? workOrder.customer_id);
    const locationId = normalizeUuid(payload.locationId ?? workOrder.location_id);
    const assignedMechanicId = normalizeUuid(payload.assignedMechanicUserId ?? workOrder.assigned_mechanic_user_id);
    const odometerMiles = normalizeOdometer(payload.odometerMiles ?? workOrder.odometer_miles);

    let resolvedUserId = normalizeUuid(userId);
    if (!resolvedUserId) {
      resolvedUserId = await resolveUserIdByUsername(trx, payload.requestedBy || payload.requestedByUsername);
    }

    await trx('work_orders').where({ id: workOrderId }).update({
      vehicle_id: vehicleId,
      customer_id: customerId,
      location_id: locationId,
      type: payload.type ?? workOrder.type,
      priority: payload.priority ?? workOrder.priority,
      status: normalizeStatus(payload.status, workOrder.status),
      description: payload.description ?? workOrder.description,
      odometer_miles: odometerMiles,
      assigned_mechanic_user_id: assignedMechanicId,
      requested_by_user_id: workOrder.requested_by_user_id || resolvedUserId,
      discount_type: payload.discountType ?? workOrder.discount_type,
      discount_value: payload.discountValue ?? workOrder.discount_value,
      tax_rate_percent: payload.taxRatePercent ?? workOrder.tax_rate_percent,
      updated_at: trx.fn.now()
    });

    if (Array.isArray(payload.labor)) {
      await trx('work_order_labor_items').where({ work_order_id: workOrderId }).del();
      for (const line of payload.labor) {
        const hours = normalizeDecimal(line.hours);
        const rate = normalizeDecimal(line.labor_rate ?? line.rate);
        const mechanicUserId = await resolveMechanicUserId(trx, line) || assignedMechanicId;
        await trx('work_order_labor_items').insert({
          work_order_id: workOrderId,
          mechanic_user_id: mechanicUserId,
          description: line.description || 'Labor',
          hours,
          labor_rate: rate,
          taxable: line.taxable === true,
          line_total: hours * rate
        });
      }
    }

    if (Array.isArray(payload.fees)) {
      await trx('work_order_fees').where({ work_order_id: workOrderId }).del();
      for (const fee of payload.fees) {
        await trx('work_order_fees').insert({
          work_order_id: workOrderId,
          fee_type: fee.fee_type || fee.feeType || 'MISC',
          amount: normalizeDecimal(fee.amount),
          taxable: fee.taxable === true
        });
      }
    }

    const updated = await recomputeWorkOrderTotals(trx, workOrderId);
    return updated.workOrder;
  });
}

async function updateWorkOrderStatus(workOrderId, nextStatus, userRole) {
  return db.transaction(async trx => {
    const workOrder = await trx('work_orders').where({ id: workOrderId }).first();
    if (!workOrder) throw new Error('Work order not found');

    if (nextStatus === 'CANCELED' && userRole !== 'admin') {
      throw new Error('Only admin can cancel work orders');
    }

    const allowed = STATUS_TRANSITIONS[workOrder.status] || [];
    if (nextStatus && allowed.length && !allowed.includes(nextStatus)) {
      throw new Error(`Invalid status transition from ${workOrder.status} to ${nextStatus}`);
    }

    const legacyStatus = normalizeStatus(nextStatus, workOrder.status);

    await trx('work_orders').where({ id: workOrderId }).update({
      status: legacyStatus,
      completed_at: legacyStatus === 'completed' ? trx.fn.now() : workOrder.completed_at,
      updated_at: trx.fn.now()
    });

    // If work order is being completed, sync to service history (maintenance_records)
    if (legacyStatus === 'completed') {
      const existingRecord = await trx('maintenance_records')
        .where({ work_order_id: workOrderId })
        .first();

      if (!existingRecord) {
        // Create a new maintenance record for service history
        await trx('maintenance_records').insert({
          id: require('uuid').v4(),
          vehicle_id: workOrder.vehicle_id,
          customer_id: workOrder.customer_id,
          date_performed: trx.fn.now(),
          status: 'completed',
          description: workOrder.description || `Work Order ${workOrder.work_order_number}`,
          cost: workOrder.total_amount || 0,
          work_order_id: workOrderId,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });
      }
    }

    return await trx('work_orders').where({ id: workOrderId }).first();
  });
}

async function reservePart(workOrderId, payload, userId) {
  return db.transaction(async trx => {
    const workOrder = await trx('work_orders').where({ id: workOrderId }).first();
    if (!workOrder) throw new Error('Work order not found');

    const partId = payload.partId;
    if (!partId) throw new Error('partId is required');

    const locationId = payload.locationId || workOrder.location_id;
    const qtyRequested = normalizeDecimal(payload.qtyRequested);
    if (qtyRequested <= 0) throw new Error('qtyRequested must be greater than zero');

    const part = await trx('parts').where({ id: partId }).first();
    if (!part) throw new Error('Part not found');

    let inventory = await trx('inventory').where({ location_id: locationId, part_id: partId }).first();
    if (!inventory) {
      const [createdInventory] = await trx('inventory')
        .insert({
          location_id: locationId,
          part_id: partId,
          on_hand_qty: part.quantity_on_hand || 0,
          reserved_qty: 0,
          min_stock_level: part.reorder_level || 0,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning('*');
      inventory = createdInventory;
    }

    // Fallback: if inventory is zero but parts catalog shows stock, sync on_hand_qty
    const catalogQty = normalizeDecimal(part.quantity_on_hand);
    if (catalogQty > 0 && normalizeDecimal(inventory.on_hand_qty) < catalogQty) {
      const [updatedInventory] = await trx('inventory')
        .where({ location_id: locationId, part_id: partId })
        .update({ on_hand_qty: catalogQty, updated_at: trx.fn.now() })
        .returning('*');
      if (updatedInventory) {
        inventory = updatedInventory;
      }
    }

    const availableQty = normalizeDecimal(inventory.on_hand_qty) - normalizeDecimal(inventory.reserved_qty);
    const reserveQty = Math.min(availableQty, qtyRequested);
    const backordered = qtyRequested > reserveQty;

    const resolvedUserId = await resolveUserId(trx, userId);

    if (reserveQty > 0) {
      await trx('inventory')
        .where({ location_id: locationId, part_id: partId })
        .increment('reserved_qty', reserveQty)
        .update({ updated_at: trx.fn.now() });

      await trx('inventory_transactions').insert({
        location_id: locationId,
        part_id: partId,
        transaction_type: 'RESERVE',
        qty_change: reserveQty,
        unit_cost_at_time: part.unit_cost || null,
        reference_type: 'WORK_ORDER',
        reference_id: workOrderId,
        performed_by_user_id: resolvedUserId,
        notes: 'Reserved for work order'
      });
    }

    let line;
    if (payload.partLineId) {
      const existingLine = await trx('work_order_part_items')
        .where({ id: payload.partLineId, work_order_id: workOrderId })
        .first();
      if (!existingLine) throw new Error('Part line not found');
      if (existingLine.part_id !== partId) throw new Error('Part line does not match partId');

      const newReserved = normalizeDecimal(existingLine.qty_reserved) + reserveQty;
      const newStatus = newReserved < normalizeDecimal(existingLine.qty_requested) ? 'BACKORDERED' : 'RESERVED';

      const [updatedLine] = await trx('work_order_part_items')
        .where({ id: payload.partLineId, work_order_id: workOrderId })
        .update({
          qty_reserved: newReserved,
          status: newStatus,
          updated_at: trx.fn.now()
        })
        .returning('*');
      line = updatedLine;
    } else {
      const [createdLine] = await trx('work_order_part_items').insert({
        work_order_id: workOrderId,
        part_id: partId,
        location_id: locationId,
        qty_requested: qtyRequested,
        qty_reserved: reserveQty,
        qty_issued: 0,
        unit_price: normalizeDecimal(payload.unitPrice) || part.unit_price || 0,
        taxable: payload.taxable !== undefined ? payload.taxable === true : (part.taxable === true),
        status: backordered ? 'BACKORDERED' : 'RESERVED',
        line_total: 0
      }).returning('*');
      line = createdLine;
    }

    await recomputeWorkOrderTotals(trx, workOrderId);

    return line;
  });
}

async function reservePartsFromBarcodes(workOrderId, payload, userId) {
  const codes = Array.isArray(payload?.codes) ? payload.codes : [];
  const codeCounts = payload?.codeCounts && typeof payload.codeCounts === 'object'
    ? payload.codeCounts
    : null;
  if (!codes.length && (!codeCounts || !Object.keys(codeCounts).length)) {
    throw new Error('codes array is required');
  }

  const locationId = payload.locationId;
  const taxable = payload.taxable !== undefined ? payload.taxable === true : true;
  const buckets = new Map();
  const errors = [];
  const lines = [];

  const counts = new Map();
  if (codeCounts) {
    Object.entries(codeCounts).forEach(([code, count]) => {
      const normalized = String(code || '').trim();
      const qty = Number(count) || 0;
      if (!normalized || qty <= 0) return;
      counts.set(normalized, (counts.get(normalized) || 0) + qty);
    });
  } else {
    codes.forEach(code => {
      const normalized = String(code || '').trim();
      if (!normalized) return;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    });
  }

  for (const [code, count] of counts.entries()) {
    try {
      const barcode = await barcodesService.getBarcodeByCode(code);
      if (!barcode || !barcode.part_id) {
        throw new Error('Barcode not linked to a part');
      }
      const packQty = Number(barcode.pack_qty) || 1;
      const qtyRequested = count * packQty;
      const unitPrice = Number(
        payload.unitPrice ??
        barcode.default_cost ??
        barcode.default_retail_price ??
        0
      );
      const bucketKey = `${barcode.part_id}|${unitPrice}`;
      const existing = buckets.get(bucketKey);
      if (existing) {
        existing.qtyRequested += qtyRequested;
      } else {
        buckets.set(bucketKey, { partId: barcode.part_id, qtyRequested, unitPrice });
      }
    } catch (error) {
      errors.push({ code, error: error.message || 'Lookup failed' });
    }
  }

  for (const bucket of buckets.values()) {
    try {
      const line = await reservePart(workOrderId, {
        partId: bucket.partId,
        qtyRequested: bucket.qtyRequested,
        unitPrice: bucket.unitPrice,
        locationId,
        taxable
      }, userId);
      lines.push(line);
    } catch (error) {
      errors.push({ partId: bucket.partId, error: error.message || 'Reserve failed' });
    }
  }

  return { lines, errors };
}

async function issuePart(workOrderId, partLineId, payload, userId) {
  return db.transaction(async trx => {
    const line = await trx('work_order_part_items').where({ id: partLineId, work_order_id: workOrderId }).first();
    if (!line) throw new Error('Part line not found');

    const qtyToIssue = normalizeDecimal(payload.qtyToIssue);
    if (qtyToIssue <= 0) throw new Error('qtyToIssue must be greater than zero');

    if (qtyToIssue > normalizeDecimal(line.qty_reserved)) {
      throw new Error('Cannot issue more than reserved quantity');
    }

    await trx('inventory')
      .where({ location_id: line.location_id, part_id: line.part_id })
      .decrement('reserved_qty', qtyToIssue)
      .decrement('on_hand_qty', qtyToIssue)
      .update({ last_issued_at: trx.fn.now(), updated_at: trx.fn.now() });

    const resolvedUserId = await resolveUserId(trx, userId);

    await trx('inventory_transactions').insert({
      location_id: line.location_id,
      part_id: line.part_id,
      transaction_type: 'ISSUE',
      qty_change: -qtyToIssue,
      unit_cost_at_time: line.unit_price,
      reference_type: 'WORK_ORDER',
      reference_id: workOrderId,
      performed_by_user_id: resolvedUserId,
      notes: 'Issued to work order'
    });

    const newIssued = normalizeDecimal(line.qty_issued) + qtyToIssue;
    const newReserved = normalizeDecimal(line.qty_reserved) - qtyToIssue;
    const newStatus = newIssued >= normalizeDecimal(line.qty_requested) ? 'ISSUED' : line.status;
    const lineTotal = newIssued * normalizeDecimal(line.unit_price);

    await trx('work_order_part_items')
      .where({ id: partLineId })
      .update({
        qty_issued: newIssued,
        qty_reserved: newReserved,
        status: newStatus,
        line_total: lineTotal,
        updated_at: trx.fn.now()
      });

    const updated = await recomputeWorkOrderTotals(trx, workOrderId);
    return updated;
  });
}

async function returnPart(workOrderId, partLineId, payload, userId) {
  return db.transaction(async trx => {
    const line = await trx('work_order_part_items').where({ id: partLineId, work_order_id: workOrderId }).first();
    if (!line) throw new Error('Part line not found');

    const qtyToReturn = normalizeDecimal(payload.qtyToReturn);
    if (qtyToReturn <= 0) throw new Error('qtyToReturn must be greater than zero');
    if (qtyToReturn > normalizeDecimal(line.qty_issued)) {
      throw new Error('Cannot return more than issued quantity');
    }

    await trx('inventory')
      .where({ location_id: line.location_id, part_id: line.part_id })
      .increment('on_hand_qty', qtyToReturn)
      .update({ updated_at: trx.fn.now() });

    const resolvedUserId = await resolveUserId(trx, userId);

    await trx('inventory_transactions').insert({
      location_id: line.location_id,
      part_id: line.part_id,
      transaction_type: 'RETURN',
      qty_change: qtyToReturn,
      unit_cost_at_time: line.unit_price,
      reference_type: 'WORK_ORDER',
      reference_id: workOrderId,
      performed_by_user_id: resolvedUserId,
      notes: 'Returned from work order'
    });

    const newIssued = normalizeDecimal(line.qty_issued) - qtyToReturn;
    const newStatus = newIssued <= 0 ? 'RETURNED' : line.status;
    const lineTotal = newIssued * normalizeDecimal(line.unit_price);

    await trx('work_order_part_items')
      .where({ id: partLineId })
      .update({
        qty_issued: newIssued,
        status: newStatus,
        line_total: lineTotal,
        updated_at: trx.fn.now()
      });

    const updated = await recomputeWorkOrderTotals(trx, workOrderId);
    return updated;
  });
}

async function updateCharges(workOrderId, payload) {
  return db.transaction(async trx => {
    const workOrder = await trx('work_orders').where({ id: workOrderId }).first();
    if (!workOrder) throw new Error('Work order not found');

    if (Array.isArray(payload.fees)) {
      await trx('work_order_fees').where({ work_order_id: workOrderId }).del();
      for (const fee of payload.fees) {
        await trx('work_order_fees').insert({
          work_order_id: workOrderId,
          fee_type: fee.fee_type || fee.feeType || 'MISC',
          amount: normalizeDecimal(fee.amount),
          taxable: fee.taxable === true
        });
      }
    }

    await trx('work_orders').where({ id: workOrderId }).update({
      discount_type: payload.discountType ?? workOrder.discount_type,
      discount_value: payload.discountValue ?? workOrder.discount_value,
      tax_rate_percent: payload.taxRatePercent ?? workOrder.tax_rate_percent,
      updated_at: trx.fn.now()
    });

    const updated = await recomputeWorkOrderTotals(trx, workOrderId);
    return updated.workOrder;
  });
}

async function addLaborLine(workOrderId, payload) {
  return db.transaction(async trx => {
    const workOrder = await trx('work_orders').where({ id: workOrderId }).first();
    if (!workOrder) throw new Error('Work order not found');

    const hours = normalizeDecimal(payload.hours);
    const rate = normalizeDecimal(payload.laborRate || payload.labor_rate || payload.rate);
    const mechanicUserId = await resolveMechanicUserId(trx, payload);
    const [line] = await trx('work_order_labor_items').insert({
      work_order_id: workOrderId,
      mechanic_user_id: mechanicUserId,
      description: payload.description || 'Labor',
      hours,
      labor_rate: rate,
      taxable: payload.taxable === true,
      line_total: hours * rate
    }).returning('*');

    await recomputeWorkOrderTotals(trx, workOrderId);
    return line;
  });
}

async function updateLaborLine(workOrderId, laborId, payload) {
  return db.transaction(async trx => {
    const line = await trx('work_order_labor_items').where({ id: laborId, work_order_id: workOrderId }).first();
    if (!line) throw new Error('Labor line not found');

    const hours = normalizeDecimal(payload.hours ?? line.hours);
    const rate = normalizeDecimal(payload.laborRate ?? payload.labor_rate ?? payload.rate ?? line.labor_rate);
    const mechanicUserId = payload.mechanicId || payload.mechanicName || payload.mechanic_username
      ? await resolveMechanicUserId(trx, payload)
      : line.mechanic_user_id;
    const [updated] = await trx('work_order_labor_items')
      .where({ id: laborId })
      .update({
        description: payload.description ?? line.description,
        mechanic_user_id: mechanicUserId,
        hours,
        labor_rate: rate,
        taxable: payload.taxable ?? line.taxable,
        line_total: hours * rate,
        updated_at: trx.fn.now()
      })
      .returning('*');

    await recomputeWorkOrderTotals(trx, workOrderId);
    return updated;
  });
}

async function deleteLaborLine(workOrderId, laborId) {
  return db.transaction(async trx => {
    await trx('work_order_labor_items').where({ id: laborId, work_order_id: workOrderId }).del();
    await recomputeWorkOrderTotals(trx, workOrderId);
  });
}

async function generateInvoiceForWorkOrder(workOrderId, userId, payload = {}) {
  return db.transaction(async trx => {
    const workOrder = await trx('work_orders').where({ id: workOrderId }).first();
    if (!workOrder) throw new Error('Work order not found');
    const normalizedStatus = normalizeStatus(workOrder.status, workOrder.status);
    if (normalizedStatus !== 'completed') {
      throw new Error('Only completed work orders can be invoiced');
    }

    let customer = null;
    if (workOrder.customer_id) {
      customer = await trx('customers').where({ id: workOrder.customer_id }).first();
      if (!customer || customer.is_deleted) throw new Error('Customer not found');
      if (customer.status === 'INACTIVE') throw new Error('Inactive customer cannot be invoiced');
    } else {
      throw new Error('Work order must have a customer to invoice');
    }

    const existingInvoice = await trx('invoices').where({ work_order_id: workOrderId }).first();
    if (existingInvoice) {
      if (payload.regenerate) {
        const laborLines = await trx('work_order_labor_items').where({ work_order_id: workOrderId });
        const partLines = await trx('work_order_part_items').where({ work_order_id: workOrderId });
        const feeLines = await trx('work_order_fees').where({ work_order_id: workOrderId });

        const partCatalog = partLines.length
          ? await trx('parts').whereIn('id', partLines.map(p => p.part_id))
          : [];
        const partNameById = partCatalog.reduce((acc, p) => {
          acc[p.id] = p.name || p.sku || p.id;
          return acc;
        }, {});

        await trx('invoice_line_items').where({ invoice_id: existingInvoice.id }).del();

        const invoiceLines = [];

        for (const labor of laborLines) {
          invoiceLines.push({
            invoice_id: existingInvoice.id,
            line_type: 'LABOR',
            source_ref_type: 'work_order_labor',
            source_ref_id: labor.id,
            description: labor.description || 'Labor',
            quantity: labor.hours || 0,
            unit_price: labor.labor_rate || 0,
            taxable: labor.taxable === true,
            line_total: labor.line_total || 0
          });
        }

        for (const part of partLines) {
          const qty = normalizeDecimal(part.qty_issued);
          if (qty <= 0) continue;
          invoiceLines.push({
            invoice_id: existingInvoice.id,
            line_type: 'PART',
            source_ref_type: 'work_order_part',
            source_ref_id: part.id,
            description: partNameById[part.part_id] || 'Part (unknown)',
            quantity: qty,
            unit_price: part.unit_price || 0,
            taxable: part.taxable === true,
            line_total: qty * normalizeDecimal(part.unit_price)
          });
        }

        for (const fee of feeLines) {
          invoiceLines.push({
            invoice_id: existingInvoice.id,
            line_type: 'FEE',
            source_ref_type: 'work_order_fee',
            source_ref_id: fee.id,
            description: fee.fee_type,
            quantity: 1,
            unit_price: fee.amount || 0,
            taxable: fee.taxable === true,
            line_total: fee.amount || 0
          });
        }

        if (invoiceLines.length) {
          await trx('invoice_line_items').insert(invoiceLines);
        }

        const issuedDate = existingInvoice.issued_date || new Date().toISOString().slice(0, 10);
        const paymentTerms = customer.payment_terms || 'DUE_ON_RECEIPT';
        const dueDate = computeDueDate(issuedDate, paymentTerms, customer.payment_terms_custom_days);

        await trx('invoices')
          .where({ id: existingInvoice.id })
          .update({
            issued_date: issuedDate,
            due_date: dueDate,
            payment_terms: paymentTerms,
            updated_at: trx.fn.now()
          });

        const totals = await recomputeInvoiceTotals(trx, existingInvoice.id);
        const totalAmount = normalizeDecimal(totals?.invoice?.total_amount);

        if (payload.useCredit && workOrder.customer_id && totalAmount > 0) {
          const creditStatus = await creditService.canUseCredit(workOrder.customer_id, totalAmount);
          if (!creditStatus.canUse) {
            throw new Error(`Insufficient credit. Available: $${creditStatus.availableCredit.toFixed(2)}, Required: $${creditStatus.requiredAmount.toFixed(2)}, Shortfall: $${creditStatus.shortfall.toFixed(2)}`);
          }
          await creditService.applyInvoiceToCredit(workOrder.customer_id, existingInvoice.id, totalAmount, userId);
          const [updatedInvoice] = await trx('invoices')
            .where({ id: existingInvoice.id })
            .update({ status: 'INVOICED', updated_at: trx.fn.now() })
            .returning('*');
          return updatedInvoice || totals?.invoice || existingInvoice;
        }

        return totals?.invoice || existingInvoice;
      }

      if (payload.useCredit && workOrder.customer_id) {
        const totals = await recomputeInvoiceTotals(trx, existingInvoice.id);
        const totalAmount = normalizeDecimal(totals?.invoice?.total_amount);
        if (totalAmount > 0) {
          const creditStatus = await creditService.canUseCredit(workOrder.customer_id, totalAmount);
          if (!creditStatus.canUse) {
            throw new Error(`Insufficient credit. Available: $${creditStatus.availableCredit.toFixed(2)}, Required: $${creditStatus.requiredAmount.toFixed(2)}, Shortfall: $${creditStatus.shortfall.toFixed(2)}`);
          }
          await creditService.applyInvoiceToCredit(workOrder.customer_id, existingInvoice.id, totalAmount, userId);
          const [updatedInvoice] = await trx('invoices')
            .where({ id: existingInvoice.id })
            .update({ status: 'INVOICED', updated_at: trx.fn.now() })
            .returning('*');
          return updatedInvoice || existingInvoice;
        }
      }
      return existingInvoice;
    }

    const invoiceNumber = await generateInvoiceNumber(trx);

    const issuedDate = new Date().toISOString().slice(0, 10);
    const paymentTerms = customer.payment_terms || 'DUE_ON_RECEIPT';
    const dueDate = computeDueDate(issuedDate, paymentTerms, customer.payment_terms_custom_days);

    const [invoice] = await trx('invoices').insert({
      invoice_number: invoiceNumber,
      work_order_id: workOrderId,
      customer_id: workOrder.customer_id,
      location_id: workOrder.location_id,
      status: 'DRAFT',
      issued_date: issuedDate,
      due_date: dueDate,
      payment_terms: paymentTerms,
      notes: workOrder.description || null,
      discount_type: workOrder.discount_type || 'NONE',
      discount_value: workOrder.discount_value || 0,
      tax_rate_percent: workOrder.tax_rate_percent || 0,
      created_by_user_id: userId || null
    }).returning('*');

    const laborLines = await trx('work_order_labor_items').where({ work_order_id: workOrderId });
    const partLines = await trx('work_order_part_items').where({ work_order_id: workOrderId });
    const feeLines = await trx('work_order_fees').where({ work_order_id: workOrderId });

    const partCatalog = partLines.length
      ? await trx('parts').whereIn('id', partLines.map(p => p.part_id))
      : [];
    const partNameById = partCatalog.reduce((acc, p) => {
      acc[p.id] = p.name || p.sku || p.id;
      return acc;
    }, {});

    const invoiceLines = [];

    for (const labor of laborLines) {
      invoiceLines.push({
        invoice_id: invoice.id,
        line_type: 'LABOR',
        source_ref_type: 'work_order_labor',
        source_ref_id: labor.id,
        description: labor.description || 'Labor',
        quantity: labor.hours || 0,
        unit_price: labor.labor_rate || 0,
        taxable: labor.taxable === true,
        line_total: labor.line_total || 0
      });
    }

    for (const part of partLines) {
      const qty = normalizeDecimal(part.qty_issued);
      if (qty <= 0) continue;
      invoiceLines.push({
        invoice_id: invoice.id,
        line_type: 'PART',
        source_ref_type: 'work_order_part',
        source_ref_id: part.id,
        description: partNameById[part.part_id] || 'Part (unknown)',
        quantity: qty,
        unit_price: part.unit_price || 0,
        taxable: part.taxable === true,
        line_total: qty * normalizeDecimal(part.unit_price)
      });
    }

    for (const fee of feeLines) {
      invoiceLines.push({
        invoice_id: invoice.id,
        line_type: 'FEE',
        source_ref_type: 'work_order_fee',
        source_ref_id: fee.id,
        description: fee.fee_type,
        quantity: 1,
        unit_price: fee.amount || 0,
        taxable: fee.taxable === true,
        line_total: fee.amount || 0
      });
    }

    if (invoiceLines.length) {
      await trx('invoice_line_items').insert(invoiceLines);
    }

    const totals = await recomputeInvoiceTotals(trx, invoice.id);
    await trx('invoices').where({ id: invoice.id }).update({ updated_at: trx.fn.now() });

    // Apply credit if requested
    if (payload.useCredit && workOrder.customer_id) {
      const totalAmount = normalizeDecimal(totals?.invoice?.total_amount);
      if (totalAmount <= 0) return totals?.invoice || invoice;
      const creditStatus = await creditService.canUseCredit(workOrder.customer_id, totalAmount);
      if (!creditStatus.canUse) {
        throw new Error(`Insufficient credit. Available: $${creditStatus.availableCredit.toFixed(2)}, Required: $${creditStatus.requiredAmount.toFixed(2)}, Shortfall: $${creditStatus.shortfall.toFixed(2)}`);
      }
      await creditService.applyInvoiceToCredit(workOrder.customer_id, invoice.id, totalAmount, userId);
      await trx('invoices')
        .where({ id: invoice.id })
        .update({ status: 'INVOICED', updated_at: trx.fn.now() });
    }

    return totals?.invoice || invoice;
  });
}

async function uploadDocument(workOrderId, file, userId) {
  return db.transaction(async trx => {
    const workOrder = await trx('work_orders').where({ id: workOrderId }).first();
    if (!workOrder) throw new Error('Work order not found');

    const [doc] = await trx('work_order_documents').insert({
      work_order_id: workOrderId,
      file_name: file.originalname,
      mime_type: file.mimetype,
      file_size_bytes: file.size,
      storage_key: file.storage_key,
      uploaded_by_user_id: userId || null
    }).returning('*');

    return doc;
  });
}

module.exports = {
  listWorkOrders,
  getWorkOrderById,
  createWorkOrder,
  updateWorkOrder,
  updateWorkOrderStatus,
  reservePart,
  reservePartsFromBarcodes,
  issuePart,
  returnPart,
  updateCharges,
  addLaborLine,
  updateLaborLine,
  deleteLaborLine,
  recomputeWorkOrderTotals,
  generateInvoiceForWorkOrder,
  uploadDocument
};
