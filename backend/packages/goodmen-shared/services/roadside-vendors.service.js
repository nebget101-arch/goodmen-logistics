'use strict';

const db = require('../internal/db').knex;
const dtLogger = require('../utils/logger');

const TABLE = 'roadside_vendors';

/**
 * Build the WHERE clause for tenant scoping.
 * Private vendors are owned by the tenant; marketplace vendors (tenant_id IS NULL)
 * are visible to all authenticated tenants.
 */
function tenantScope(qb, tenantId) {
  return qb.where(function scopeWhere() {
    this.where('tenant_id', tenantId).orWhereNull('tenant_id');
  });
}

async function list({ tenantId, status, limit, offset } = {}) {
  let qb = db(TABLE).select('*').orderBy('name', 'asc');
  if (tenantId) {
    tenantScope(qb, tenantId);
  }
  if (status) {
    qb = qb.where('status', status);
  }
  if (limit != null) {
    qb = qb.limit(Math.min(Math.max(Number(limit) || 50, 1), 200));
  }
  if (offset != null) {
    qb = qb.offset(Math.max(Number(offset) || 0, 0));
  }
  return qb;
}

async function getById(vendorId, tenantId) {
  let qb = db(TABLE).where('vendor_id', vendorId).first();
  if (tenantId) {
    tenantScope(qb, tenantId);
  }
  const row = await qb;
  if (!row) throw new Error(`Vendor ${vendorId} not found`);
  return row;
}

async function create({ tenantId, name, skills, capacity, base_location, status }) {
  if (!name || !String(name).trim()) throw new Error('name is required');
  if (capacity !== undefined && (!Number.isInteger(Number(capacity)) || Number(capacity) < 0)) {
    throw new Error('capacity must be a non-negative integer');
  }
  if (base_location != null) {
    validateLocation(base_location);
  }

  const [row] = await db(TABLE)
    .insert({
      tenant_id: tenantId || null,
      name: String(name).trim(),
      skills: JSON.stringify(Array.isArray(skills) ? skills : []),
      capacity: Number(capacity) || 0,
      base_location: base_location ? JSON.stringify(base_location) : null,
      status: status || 'active',
    })
    .returning('*');

  dtLogger.info('roadside_vendor_created', { vendor_id: row.vendor_id, tenant_id: row.tenant_id });
  return row;
}

async function update(vendorId, tenantId, { name, skills, capacity, base_location }) {
  const existing = await getById(vendorId, tenantId);
  assertOwner(existing, tenantId);

  const updates = { updated_at: db.fn.now() };
  if (name !== undefined) {
    if (!String(name).trim()) throw new Error('name cannot be empty');
    updates.name = String(name).trim();
  }
  if (skills !== undefined) {
    updates.skills = JSON.stringify(Array.isArray(skills) ? skills : []);
  }
  if (capacity !== undefined) {
    if (!Number.isInteger(Number(capacity)) || Number(capacity) < 0) {
      throw new Error('capacity must be a non-negative integer');
    }
    updates.capacity = Number(capacity);
  }
  if (base_location !== undefined) {
    if (base_location === null) {
      updates.base_location = null;
    } else {
      validateLocation(base_location);
      updates.base_location = JSON.stringify(base_location);
    }
  }

  const [row] = await db(TABLE).where('vendor_id', vendorId).update(updates).returning('*');
  dtLogger.info('roadside_vendor_updated', { vendor_id: row.vendor_id });
  return row;
}

async function setStatus(vendorId, tenantId, status) {
  if (!['active', 'suspended'].includes(status)) {
    throw new Error('status must be active or suspended');
  }
  const existing = await getById(vendorId, tenantId);
  assertOwner(existing, tenantId);

  const [row] = await db(TABLE)
    .where('vendor_id', vendorId)
    .update({ status, updated_at: db.fn.now() })
    .returning('*');
  dtLogger.info('roadside_vendor_status_changed', { vendor_id: row.vendor_id, status });
  return row;
}

async function stats(tenantId) {
  const rows = await db(TABLE)
    .select('status')
    .count('* as count')
    .where(function scopeWhere() {
      if (tenantId) {
        this.where('tenant_id', tenantId).orWhereNull('tenant_id');
      }
    })
    .groupBy('status');

  const distribution = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.count);
    distribution[r.status] = n;
    total += n;
  }
  return { total, distribution };
}

function validateLocation(loc) {
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (isNaN(lat) || lat < -90 || lat > 90) throw new Error('base_location.lat must be between -90 and 90');
  if (isNaN(lng) || lng < -180 || lng > 180) throw new Error('base_location.lng must be between -180 and 180');
}

function assertOwner(vendor, tenantId) {
  if (vendor.tenant_id !== null && vendor.tenant_id !== tenantId) {
    throw new Error('Cannot modify a vendor owned by a different tenant');
  }
}

module.exports = { list, getById, create, update, setStatus, stats };
