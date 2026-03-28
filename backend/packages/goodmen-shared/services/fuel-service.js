'use strict';

/**
 * Fuel domain service.
 * Orchestrates: parsing, validation, duplicate-detection, entity-matching,
 * batch commit, exception creation, and re-processing.
 */

const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const { parseFileBuffer, buildAutoMapping, applyMapping, validateRow } = require('./fuel-parser');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function toDecimal(str) {
  const n = parseFloat(String(str || '').replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

function toInt(str) {
  const n = parseInt(String(str || ''), 10);
  return isNaN(n) ? null : n;
}

function maskCard(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\s/g, '');
  if (s.length <= 4) return s;
  return '****' + s.slice(-4);
}

// ─── Entity lookup helpers ────────────────────────────────────────────────────

/**
 * Try to find a truck by unit number within tenant scope.
 */
async function findTruckByUnit(tenantId, unitRaw) {
  if (!unitRaw) return null;
  const unit = unitRaw.toString().trim();
  // Try vehicles table (the existing trucks/trailers table)
  const row = await knex('vehicles')
    .where({ tenant_id: tenantId, vehicle_type: 'truck' })
    .whereRaw('LOWER(TRIM(unit_number)) = LOWER(?)', [unit])
    .first('id');
  return row?.id || null;
}

/**
 * Try to find a driver by name within tenant scope.
 */
async function findDriverByName(tenantId, nameRaw) {
  if (!nameRaw) return null;
  const name = nameRaw.toString().trim();
  // Split on space to get first/last
  const parts = name.split(/\s+/);
  let query = knex('drivers').where({ tenant_id: tenantId });

  if (parts.length >= 2) {
    query = query.whereRaw(
      `LOWER(TRIM(first_name)) || ' ' || LOWER(TRIM(last_name)) = LOWER(?)`,
      [name]
    );
  } else {
    query = query.whereRaw(
      `LOWER(TRIM(last_name)) = LOWER(?) OR LOWER(TRIM(first_name)) = LOWER(?)`,
      [name, name]
    );
  }

  const row = await query.first('id');
  return row?.id || null;
}

/**
 * Try to find a fuel card account by matching card_number_masked or provider.
 */
async function findFuelCard(tenantId, cardMasked, providerName) {
  if (!cardMasked && !providerName) return null;

  let q = knex('fuel_card_accounts').where({ tenant_id: tenantId, status: 'active' });
  if (cardMasked) {
    const last4 = cardMasked.slice(-4);
    q = q.whereRaw(`account_number_masked LIKE ?`, [`%${last4}`]);
  } else if (providerName) {
    q = q.whereRaw('LOWER(provider_name) = LOWER(?)', [providerName]);
  }
  const row = await q.first('id');
  return row?.id || null;
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

/**
 * Check if a transaction with identical key fields already exists for this tenant.
 * Returns boolean.
 */
async function isDuplicateTransaction(tenantId, normalized) {
  const date = toDate(normalized.transaction_date);
  if (!date) return false;

  const gallons = toDecimal(normalized.gallons);
  const amount = toDecimal(normalized.amount);
  const productType = normalized.product_type || 'diesel';

  const dupeQuery = knex('fuel_transactions')
    .where({ tenant_id: tenantId })
    .whereRaw('transaction_date = ?', [date.toISOString().slice(0, 10)])
    .whereRaw('ABS(gallons::numeric - ?) < 0.01', [gallons || 0])
    .whereRaw('ABS(amount::numeric - ?) < 0.01', [amount || 0]);

  // Include product_type so split rows (same date/amount, different product) aren't flagged as dupes
  dupeQuery.whereRaw('COALESCE(product_type, ?) = ?', ['diesel', productType]);

  if (normalized.vendor_name) {
    dupeQuery.whereRaw('LOWER(vendor_name) = LOWER(?)', [normalized.vendor_name]);
  }
  if (normalized.card_number_masked) {
    const last4 = normalized.card_number_masked.slice(-4);
    dupeQuery.whereRaw(`card_number_masked LIKE ?`, [`%${last4}`]);
  }

  // Also check by external_transaction_id + product_type (compound check for split rows)
  if (normalized.external_transaction_id) {
    const extExists = await knex('fuel_transactions')
      .where({ tenant_id: tenantId, external_transaction_id: normalized.external_transaction_id })
      .whereRaw('COALESCE(product_type, ?) = ?', ['diesel', productType])
      .first('id');
    if (extExists) return true;
  }

  const row = await dupeQuery.first('id');
  return !!row;
}

// ─── Audit log helper ─────────────────────────────────────────────────────────

async function writeAuditLog(tenantId, userId, action, entityType, entityId, details = {}) {
  try {
    await knex('audit_logs').insert({
      tenant_id: tenantId,
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: JSON.stringify(details),
      created_at: new Date()
    });
  } catch {
    // Audit log is best-effort – never block the main operation
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a file buffer and auto-map columns based on provider template.
 * Returns parsed rows + suggested mapping (does NOT persist anything).
 */
async function previewImport({ buffer, fileName, providerKey }) {
  const { headers, rows } = parseFileBuffer(buffer, fileName);
  const autoMapping = buildAutoMapping(headers, providerKey || 'generic');
  const preview = rows.slice(0, 20).map((rawRow, i) => ({
    rowNumber: i + 1,
    raw: rawRow,
    normalized: applyMapping(rawRow, autoMapping)
  }));
  return { headers, autoMapping, preview, totalRows: rows.length };
}

/**
 * Create a new import batch record and validate/stage all rows.
 * Does NOT commit fuel_transactions yet.
 */
async function stageBatch({
  tenantId,
  operatingEntityId,
  cardAccountId,
  providerName,
  fileName,
  fileStorageKey,
  buffer,
  columnMap,
  importedByUserId
}) {
  const { rows: rawRows } = parseFileBuffer(buffer, fileName);

  // Create the batch record
  const [batch] = await knex('fuel_import_batches').insert({
    tenant_id: tenantId,
    operating_entity_id: operatingEntityId || null,
    fuel_card_account_id: cardAccountId || null,
    provider_name: providerName,
    source_file_name: fileName,
    source_file_storage_key: fileStorageKey || null,
    import_status: 'validating',
    total_rows: rawRows.length,
    imported_by_user_id: importedByUserId || null,
    started_at: new Date()
  }).returning('*');

  const batchId = batch.id;

  // Collect existing external IDs for duplicate detection within file itself
  const seenExtIds = new Set();
  let successCount = 0;
  let warningCount = 0;
  let failedCount = 0;

  const rowInserts = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rawRow = rawRows[i];
    const normalized = applyMapping(rawRow, columnMap);
    const { errors, warnings } = validateRow(normalized, seenExtIds);

    if (normalized.external_transaction_id) {
      if (seenExtIds.has(normalized.external_transaction_id)) {
        warnings.push(`Duplicate external ID within this file: "${normalized.external_transaction_id}"`);
      } else {
        seenExtIds.add(normalized.external_transaction_id);
      }
    }

    // Check DB-level duplicates
    if (errors.length === 0) {
      const isDupe = await isDuplicateTransaction(tenantId, normalized);
      if (isDupe) {
        warnings.push('Possible duplicate – a matching transaction already exists in the database');
      }
    }

    let resolutionStatus = 'valid';
    if (errors.length > 0) {
      resolutionStatus = 'failed';
      failedCount++;
    } else if (warnings.length > 0) {
      resolutionStatus = 'warning';
      warningCount++;
    } else {
      successCount++;
    }

    rowInserts.push({
      batch_id: batchId,
      row_number: i + 1,
      raw_payload: JSON.stringify(rawRow),
      normalized_payload: JSON.stringify(normalized),
      validation_errors: JSON.stringify(errors),
      warnings: JSON.stringify(warnings),
      match_result: null,
      resolution_status: resolutionStatus
    });
  }

  // Bulk insert batch rows in chunks to avoid parameter limits
  const CHUNK = 100;
  for (let i = 0; i < rowInserts.length; i += CHUNK) {
    await knex('fuel_import_batch_rows').insert(rowInserts.slice(i, i + CHUNK));
  }

  // Update batch summary
  await knex('fuel_import_batches').where({ id: batchId }).update({
    import_status: 'validated',
    success_rows: successCount,
    warning_rows: warningCount,
    failed_rows: failedCount
  });

  dtLogger.info('fuel_batch_staged', { batchId, tenantId, total: rawRows.length, success: successCount, warning: warningCount, failed: failedCount });

  return { batchId, totalRows: rawRows.length, successCount, warningCount, failedCount };
}

/**
 * Commit all validated rows from a batch into fuel_transactions.
 * Performs entity matching and creates exceptions for unmatched rows.
 */
async function commitBatch({ batchId, tenantId, operatingEntityId = null, importedByUserId, importWarnings = false }) {
  const batch = await knex('fuel_import_batches')
    .where({ id: batchId, tenant_id: tenantId })
    .modify((qb) => {
      if (operatingEntityId) qb.where('operating_entity_id', operatingEntityId);
    })
    .first();
  if (!batch) throw Object.assign(new Error('Batch not found'), { status: 404 });
  if (!['validated', 'failed'].includes(batch.import_status)) {
    throw Object.assign(new Error(`Batch is in status "${batch.import_status}" and cannot be committed`), { status: 409 });
  }

  await knex('fuel_import_batches').where({ id: batchId }).update({ import_status: 'importing' });

  const rows = await knex('fuel_import_batch_rows')
    .where({ batch_id: batchId })
    .whereIn('resolution_status', importWarnings ? ['valid', 'warning'] : ['valid']);

  let imported = 0;
  let exceptions = 0;

  for (const batchRow of rows) {
    const normalized = typeof batchRow.normalized_payload === 'string'
      ? JSON.parse(batchRow.normalized_payload)
      : batchRow.normalized_payload;

    const transDate = toDate(normalized.transaction_date);
    if (!transDate) continue;

    // ─── Entity matching ────────────────────────────────────────────────────────
    const truckId = await findTruckByUnit(tenantId, normalized.unit_number_raw);
    const driverId = await findDriverByName(tenantId, normalized.driver_name_raw);
    const cardId = await findFuelCard(tenantId, normalized.card_number_masked, batch.provider_name);

    const matchedParts = [];
    if (truckId) matchedParts.push('truck');
    if (driverId) matchedParts.push('driver');
    if (cardId) matchedParts.push('card');

    let matchedStatus = 'unmatched';
    if (matchedParts.length === 3) matchedStatus = 'matched';
    else if (matchedParts.length > 0) matchedStatus = 'partial';

    const gallons = toDecimal(normalized.gallons) || 0;
    const amount = toDecimal(normalized.amount) || 0;
    const ppg = toDecimal(normalized.price_per_gallon) || (gallons > 0 ? amount / gallons : null);

    const [txn] = await knex('fuel_transactions').insert({
      tenant_id: tenantId,
      operating_entity_id: batch.operating_entity_id || null,
      provider_name: batch.provider_name,
      fuel_card_account_id: cardId || batch.fuel_card_account_id || null,
      external_transaction_id: normalized.external_transaction_id || null,
      transaction_date: transDate.toISOString().slice(0, 10),
      posted_date: toDate(normalized.posted_date)?.toISOString().slice(0, 10) || null,
      truck_id: truckId,
      driver_id: driverId,
      unit_number_raw: normalized.unit_number_raw || null,
      driver_name_raw: normalized.driver_name_raw || null,
      card_number_masked: maskCard(normalized.card_number_masked),
      vendor_name: normalized.vendor_name || null,
      city: normalized.city || null,
      state: normalized.state ? normalized.state.toUpperCase().slice(0, 2) : null,
      jurisdiction_state: normalized.state ? normalized.state.toUpperCase().slice(0, 2) : null,
      gallons,
      amount,
      price_per_gallon: ppg,
      currency: 'USD',
      odometer: toInt(normalized.odometer),
      product_type: normalized.product_type || 'diesel',
      category: normalized.category || 'fuel',
      source_transaction_id: normalized.source_transaction_id || null,
      matched_status: matchedStatus,
      validation_status: 'valid',
      settlement_link_status: 'none',
      source_batch_id: batchId,
      source_row_number: batchRow.row_number,
      created_by: importedByUserId || null
    }).returning('*');

    // Mark batch row as imported
    await knex('fuel_import_batch_rows').where({ id: batchRow.id }).update({
      resolution_status: 'imported',
      match_result: JSON.stringify({ truckId, driverId, cardId, matchedParts, matchedStatus })
    });

    // ─── Create exceptions for unmatched entities ────────────────────────────────
    if (matchedStatus !== 'matched') {
      const exceptionTypes = [];
      if (!truckId && normalized.unit_number_raw) exceptionTypes.push('unmatched_truck');
      if (!driverId && normalized.driver_name_raw) exceptionTypes.push('unmatched_driver');
      if (!cardId) exceptionTypes.push('unmatched_card');

      for (const excType of exceptionTypes) {
        await knex('fuel_transaction_exceptions').insert({
          fuel_transaction_id: txn.id,
          tenant_id: tenantId,
          exception_type: excType,
          exception_message: buildExceptionMessage(excType, normalized),
          resolution_status: 'open'
        });
        exceptions++;
      }
    }

    imported++;
  }

  await knex('fuel_import_batches').where({ id: batchId }).update({
    import_status: 'completed',
    completed_at: new Date(),
    success_rows: imported
  });

  await writeAuditLog(tenantId, importedByUserId, 'fuel_batch_committed', 'fuel_import_batches', batchId, {
    imported, exceptions
  });

  dtLogger.info('fuel_batch_committed', { batchId, tenantId, imported, exceptions });

  return { imported, exceptions };
}

function buildExceptionMessage(type, normalized) {
  if (type === 'unmatched_truck') return `Could not match truck unit "${normalized.unit_number_raw}" to any vehicle in the system`;
  if (type === 'unmatched_driver') return `Could not match driver "${normalized.driver_name_raw}" to any driver record`;
  if (type === 'unmatched_card') return `No fuel card account matched for this transaction`;
  return `Unresolved exception: ${type}`;
}

/**
 * Resolve a single exception – assign truck/driver manually.
 */
async function resolveException({ exceptionId, tenantId, operatingEntityId = null, resolvedBy, truckId, driverId, resolutionNotes, ignore }) {
  const exc = await knex('fuel_transaction_exceptions as e')
    .join('fuel_transactions as ft', 'ft.id', 'e.fuel_transaction_id')
    .where({ 'e.id': exceptionId, 'e.tenant_id': tenantId })
    .modify((qb) => {
      if (operatingEntityId) qb.where('ft.operating_entity_id', operatingEntityId);
    })
    .select('e.*', 'ft.operating_entity_id as transaction_operating_entity_id')
    .first();
  if (!exc) throw Object.assign(new Error('Exception not found'), { status: 404 });

  if (ignore) {
    await knex('fuel_transaction_exceptions').where({ id: exceptionId }).update({
      resolution_status: 'ignored',
      resolved_by: resolvedBy,
      resolved_at: new Date(),
      resolution_notes: resolutionNotes || 'Marked as ignored'
    });
    return { status: 'ignored' };
  }

  // Apply assignment to the fuel_transaction
  const update = {};
  if (truckId) update.truck_id = truckId;
  if (driverId) update.driver_id = driverId;

  if (Object.keys(update).length > 0) {
    update.matched_status = 'manual';
    update.updated_at = new Date();
    await knex('fuel_transactions').where({ id: exc.fuel_transaction_id, tenant_id: tenantId }).update(update);
  }

  await knex('fuel_transaction_exceptions').where({ id: exceptionId }).update({
    resolution_status: 'resolved',
    resolved_by: resolvedBy,
    resolved_at: new Date(),
    resolution_notes: resolutionNotes || null
  });

  await writeAuditLog(tenantId, resolvedBy, 'fuel_exception_resolved', 'fuel_transaction_exceptions', exceptionId, { truckId, driverId });

  return { status: 'resolved' };
}

/**
 * Bulk resolve exceptions.
 */
async function bulkResolveExceptions({ exceptionIds, tenantId, operatingEntityId = null, resolvedBy, action, resolutionNotes }) {
  if (!Array.isArray(exceptionIds) || exceptionIds.length === 0) return { resolved: 0 };
  const status = action === 'ignore' ? 'ignored' : 'resolved';
  let scopedIds = exceptionIds;
  if (operatingEntityId) {
    scopedIds = await knex('fuel_transaction_exceptions as e')
      .join('fuel_transactions as ft', 'ft.id', 'e.fuel_transaction_id')
      .where('e.tenant_id', tenantId)
      .where('ft.operating_entity_id', operatingEntityId)
      .whereIn('e.id', exceptionIds)
      .pluck('e.id');
  }
  if (scopedIds.length === 0) return { resolved: 0 };
  const count = await knex('fuel_transaction_exceptions')
    .where({ tenant_id: tenantId })
    .whereIn('id', scopedIds)
    .update({ resolution_status: status, resolved_by: resolvedBy, resolved_at: new Date(), resolution_notes: resolutionNotes || null });
  return { resolved: count };
}

/**
 * Re-process unmatched transactions by re-running entity matching.
 * Useful after master data (trucks/drivers) has been fixed.
 */
async function reprocessUnmatched(tenantId, operatingEntityId = null) {
  const unmatched = await knex('fuel_transactions')
    .where({ tenant_id: tenantId })
    .modify((qb) => {
      if (operatingEntityId) qb.where('operating_entity_id', operatingEntityId);
    })
    .whereIn('matched_status', ['unmatched', 'partial']);

  let updated = 0;
  for (const txn of unmatched) {
    const truckId = txn.truck_id || await findTruckByUnit(tenantId, txn.unit_number_raw);
    const driverId = txn.driver_id || await findDriverByName(tenantId, txn.driver_name_raw);
    const cardId = txn.fuel_card_account_id || await findFuelCard(tenantId, txn.card_number_masked, txn.provider_name);

    const matchedParts = [truckId, driverId, cardId].filter(Boolean).length;
    const newStatus = matchedParts >= 3 ? 'matched' : matchedParts > 0 ? 'partial' : 'unmatched';

    if (newStatus !== txn.matched_status || truckId !== txn.truck_id || driverId !== txn.driver_id) {
      await knex('fuel_transactions').where({ id: txn.id }).update({
        truck_id: truckId || txn.truck_id,
        driver_id: driverId || txn.driver_id,
        fuel_card_account_id: cardId || txn.fuel_card_account_id,
        matched_status: newStatus,
        updated_at: new Date()
      });
      // Close resolved exceptions
      if (newStatus !== 'unmatched') {
        await knex('fuel_transaction_exceptions')
          .where({ fuel_transaction_id: txn.id, resolution_status: 'open' })
          .update({ resolution_status: 'reprocessed', resolved_at: new Date() });
      }
      updated++;
    }
  }

  dtLogger.info('fuel_reprocess_unmatched', { tenantId, checked: unmatched.length, updated });
  return { checked: unmatched.length, updated };
}

module.exports = {
  previewImport,
  stageBatch,
  commitBatch,
  resolveException,
  bulkResolveExceptions,
  reprocessUnmatched
};
