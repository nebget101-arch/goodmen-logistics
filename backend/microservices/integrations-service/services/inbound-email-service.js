'use strict';

/**
 * Inbound email processor — FN-760
 *
 * Pipeline invoked from the `/api/webhooks/email-inbound` route:
 *   1. Resolve tenant from destination address (`tenants.inbound_email_address`)
 *   2. Log raw payload in `inbound_emails`
 *   3. Primary: extract rate confirmation data from PDF attachments via AI
 *   4. Fallback: create a DRAFT load from the email body when no PDF present
 *   5. Upload originals to R2, record `load_attachments`
 *   6. Emit in-app notifications to tenant dispatchers/admins
 *
 * Defensive: if the FN-759 migration (inbound_email_address column, inbound_emails
 * table) has not yet run, the code skips those steps without crashing so
 * integrations-service keeps booting.
 */

const path = require('path');
const knex = require('@goodmen/shared/config/knex');
const dtLogger = require('@goodmen/shared/utils/logger');
const { extractLoadFromPdf } = require('@goodmen/shared/services/load-ai-extractor');
const { uploadBuffer } = require('@goodmen/shared/storage/r2-storage');
const {
  sendInAppNotificationsToUsers
} = require('@goodmen/shared/services/notification-service');
const {
  parseAddress,
  parseToAddresses,
  buildLoc,
  normalizeDate,
  todayIso,
  tomorrowIso,
  verifyWebhookSecret
} = require('./inbound-email-helpers');

const LOAD_ATTACHMENT_TYPES = new Set([
  'RATE_CONFIRMATION',
  'BOL',
  'LUMPER',
  'OTHER',
  'CONFIRMATION',
  'PROOF_OF_DELIVERY',
  'ROADSIDE_MAINTENANCE_RECEIPT'
]);

// ---------------------------------------------------------------------------
// Tenant + log table helpers (defensive: no-op if schema missing)
// ---------------------------------------------------------------------------

async function tenantHasInboundEmailColumn() {
  return knex.schema.hasColumn('tenants', 'inbound_email_address').catch(() => false);
}

async function resolveTenantByInboundAddress(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return null;
  const hasColumn = await tenantHasInboundEmailColumn();
  if (!hasColumn) return null;

  for (const addr of addresses) {
    const normalized = (addr || '').toString().trim().toLowerCase();
    if (!normalized) continue;
    const row = await knex('tenants')
      .whereRaw('LOWER(inbound_email_address) = ?', [normalized])
      .select('id', 'name', 'inbound_email_address')
      .first()
      .catch(() => null);
    if (row) return row;
  }
  return null;
}

async function insertInboundEmailLog(tenantId, meta) {
  const hasTable = await knex.schema.hasTable('inbound_emails').catch(() => false);
  if (!hasTable) return { id: null, skipped: true };
  try {
    const [row] = await knex('inbound_emails')
      .insert({
        tenant_id: tenantId,
        from_email: meta.from_email || null,
        subject: meta.subject || null,
        body_text: meta.body_text || null,
        body_html: meta.body_html || null,
        processing_status: 'pending'
      })
      .returning(['id']);
    return { id: row?.id ?? row ?? null };
  } catch (err) {
    dtLogger.error('inbound_email_log_insert_failed', err, { tenantId });
    return { id: null, error: err.message };
  }
}

async function updateInboundEmailLog(id, updates) {
  if (!id) return;
  const hasTable = await knex.schema.hasTable('inbound_emails').catch(() => false);
  if (!hasTable) return;
  try {
    await knex('inbound_emails')
      .where({ id })
      .update({
        load_id: updates.load_id ?? null,
        processing_status: updates.processing_status || 'success',
        error_message: updates.error_message || null
      });
  } catch (err) {
    dtLogger.error('inbound_email_log_update_failed', err, { id });
  }
}

// ---------------------------------------------------------------------------
// Load creation (mirrors processSingleRateConfirmation in loads.js but without
// req context — uses explicit tenant/operating-entity args).
// ---------------------------------------------------------------------------

async function generateLoadNumber() {
  const row = await knex('loads')
    .max('load_number as max')
    .whereRaw("load_number ~ '^L[0-9]+$'")
    .first()
    .catch(() => null);

  const existing = row?.max || null;
  let next = 1;
  if (existing) {
    const n = parseInt(existing.replace(/^L/, ''), 10);
    if (Number.isFinite(n)) next = n + 1;
  }
  return `L${String(next).padStart(6, '0')}`;
}

async function findBrokerByName(brokerName) {
  const bn = (brokerName || '').toString().trim();
  if (!bn) return null;
  const row = await knex('brokers')
    .whereRaw(
      '(COALESCE(legal_name, name) ILIKE ? OR dba_name ILIKE ?)',
      [`%${bn}%`, `%${bn}%`]
    )
    .select('id', 'name', 'legal_name')
    .first()
    .catch(() => null);
  if (!row) return null;
  return { id: row.id, name: row.legal_name || row.name };
}

/**
 * Insert a DRAFT load derived from AI extraction of a single PDF.
 * Returns { loadId }.
 */
async function createDraftLoadFromExtraction({ tenantId, operatingEntityId, data }) {
  const pickup = data.pickup || {};
  const delivery = data.delivery || {};
  const extractedStops =
    Array.isArray(data.stops) && data.stops.length > 0 ? data.stops : null;

  let pickupLocation;
  let deliveryLocation;
  let pickupDate;
  let deliveryDate;
  let stopsToInsert;

  if (extractedStops) {
    const pickups = extractedStops.filter(
      (s) => (s.type || '').toString().toUpperCase() === 'PICKUP'
    );
    const deliveries = extractedStops.filter(
      (s) => (s.type || '').toString().toUpperCase() === 'DELIVERY'
    );
    const firstPickup = pickups[0];
    const lastDelivery = deliveries[deliveries.length - 1];

    pickupLocation = firstPickup ? buildLoc(firstPickup) : buildLoc(pickup);
    deliveryLocation = lastDelivery ? buildLoc(lastDelivery) : buildLoc(delivery);
    pickupDate = normalizeDate(
      firstPickup?.date || pickup.date,
      todayIso()
    );
    deliveryDate = normalizeDate(
      lastDelivery?.date || delivery.date,
      tomorrowIso()
    );
    stopsToInsert = extractedStops.map((s, idx) => {
      const isDelivery = (s.type || '').toString().toUpperCase() === 'DELIVERY';
      return {
        stop_type: isDelivery ? 'DELIVERY' : 'PICKUP',
        stop_date: normalizeDate(s.date, isDelivery ? deliveryDate : pickupDate),
        city: s.city || null,
        state: s.state || null,
        zip: s.zip != null ? String(s.zip).trim() : null,
        address1: s.address1 || null,
        sequence: typeof s.sequence === 'number' ? s.sequence : idx + 1
      };
    });
  } else {
    pickupLocation = buildLoc(pickup);
    deliveryLocation = buildLoc(delivery);
    pickupDate = normalizeDate(pickup.date, todayIso());
    deliveryDate = normalizeDate(delivery.date, tomorrowIso());
    stopsToInsert = [
      {
        stop_type: 'PICKUP',
        stop_date: pickupDate,
        city: pickup.city || null,
        state: pickup.state || null,
        zip: pickup.zip || null,
        address1: null,
        sequence: 1
      },
      {
        stop_type: 'DELIVERY',
        stop_date: deliveryDate,
        city: delivery.city || null,
        state: delivery.state || null,
        zip: delivery.zip || null,
        address1: null,
        sequence: 2
      }
    ];
  }

  const refValue =
    (data.loadId || data.orderId || data.proNumber || data.poNumber || '')
      .toString()
      .trim();
  const poValue =
    (data.poNumber && data.poNumber.toString().trim()) ||
    (data.loadId || data.orderId || data.proNumber || '').toString().trim() ||
    null;

  const brokerName = (data.brokerName || '').toString().trim() || null;
  let brokerId = null;
  let finalBrokerName = brokerName;
  if (brokerName) {
    const broker = await findBrokerByName(brokerName);
    if (broker) {
      brokerId = broker.id;
      finalBrokerName = broker.name || brokerName;
    } else {
      finalBrokerName = null;
    }
  }

  const loadNumber = refValue ? refValue.slice(0, 50) : await generateLoadNumber();

  const hasSourceColumn = await knex.schema.hasColumn('loads', 'source').catch(() => false);

  const insertPayload = {
    tenant_id: tenantId,
    operating_entity_id: operatingEntityId,
    load_number: loadNumber,
    status: 'DRAFT',
    billing_status: 'PENDING',
    broker_id: brokerId,
    broker_name: finalBrokerName,
    po_number: poValue,
    rate: data.rate || 0,
    notes: null,
    pickup_location: pickupLocation,
    delivery_location: deliveryLocation,
    pickup_date: pickupDate,
    delivery_date: deliveryDate
  };
  if (hasSourceColumn) insertPayload.source = 'email';

  // Not every deployment has pickup_location/pickup_date columns yet; drop them
  // if the schema is older.
  for (const column of ['pickup_location', 'delivery_location', 'pickup_date', 'delivery_date']) {
    const has = await knex.schema.hasColumn('loads', column).catch(() => false);
    if (!has) delete insertPayload[column];
  }

  let insertedLoadId = null;
  await knex.transaction(async (trx) => {
    const [row] = await trx('loads').insert(insertPayload).returning(['id']);
    insertedLoadId = row?.id ?? row;

    if (!insertedLoadId) {
      throw new Error('Load insert did not return an id');
    }

    for (const stop of stopsToInsert) {
      await trx('load_stops').insert({
        load_id: insertedLoadId,
        stop_type: stop.stop_type,
        stop_date: stop.stop_date,
        city: stop.city,
        state: stop.state,
        zip: stop.zip,
        address1: stop.address1,
        sequence: stop.sequence
      });
    }
  });

  return { loadId: insertedLoadId };
}

/**
 * Minimal DRAFT load for text-only emails (no PDF attachment present).
 * Stores subject + body text in `notes`; stops are left empty.
 */
async function createDraftLoadFromBody({
  tenantId,
  operatingEntityId,
  fromEmail,
  subject,
  bodyText
}) {
  const loadNumber = await generateLoadNumber();
  const hasSourceColumn = await knex.schema.hasColumn('loads', 'source').catch(() => false);

  const notesParts = [];
  if (fromEmail) notesParts.push(`From: ${fromEmail}`);
  if (subject) notesParts.push(`Subject: ${subject}`);
  if (bodyText) notesParts.push('', bodyText.toString().trim().slice(0, 4000));
  const notes = notesParts.join('\n').slice(0, 8000) || null;

  const insertPayload = {
    tenant_id: tenantId,
    operating_entity_id: operatingEntityId,
    load_number: loadNumber,
    status: 'DRAFT',
    billing_status: 'PENDING',
    rate: 0,
    notes
  };
  if (hasSourceColumn) insertPayload.source = 'email';

  const [row] = await knex('loads').insert(insertPayload).returning(['id']);
  return { loadId: row?.id ?? row };
}

/**
 * Upload an attachment buffer to R2 and record it in load_attachments.
 * Gracefully skips if R2 env vars are not configured.
 */
async function persistAttachment({ loadId, file, type = 'RATE_CONFIRMATION' }) {
  if (!loadId || !file?.buffer) return;
  const resolvedType = LOAD_ATTACHMENT_TYPES.has(type) ? type : 'OTHER';
  try {
    const fileExt = path.extname(file.originalname || '').toLowerCase();
    const safeName = `load-${loadId}-${Date.now()}${fileExt || ''}`;
    const { key: storageKey } = await uploadBuffer({
      buffer: file.buffer,
      contentType: file.mimetype,
      prefix: `loads/${loadId}`,
      fileName: safeName
    });
    await knex('load_attachments').insert({
      load_id: loadId,
      type: resolvedType,
      file_name: file.originalname || safeName,
      storage_key: storageKey,
      mime_type: file.mimetype,
      size_bytes: file.size,
      uploaded_by_user_id: null
    });
  } catch (err) {
    // R2 misconfigured in local/test — log and continue. The DRAFT load still
    // gets created so dispatchers can review and re-upload manually.
    dtLogger.error('inbound_email_attachment_upload_failed', err, {
      loadId,
      filename: file.originalname
    });
  }
}

// ---------------------------------------------------------------------------
// Dispatcher notification
// ---------------------------------------------------------------------------

async function listDispatcherUsers(tenantId) {
  const usersHasTenant = await knex.schema
    .hasColumn('users', 'tenant_id')
    .catch(() => false);
  const usersHasActive = await knex.schema
    .hasColumn('users', 'is_active')
    .catch(() => false);

  const targetRoles = ['admin', 'dispatch', 'dispatcher'];
  const rows = await knex('users')
    .whereIn('role', targetRoles)
    .modify((q) => {
      if (usersHasTenant && tenantId) q.where('tenant_id', tenantId);
    })
    .modify((q) => {
      if (usersHasActive) q.whereNot('is_active', false);
    })
    .select('id', 'email')
    .catch(() => []);
  return rows || [];
}

async function notifyDispatchers({ tenantId, loadId, subject, fromEmail }) {
  const users = await listDispatcherUsers(tenantId);
  if (!users.length) return { sent: 0 };

  const title = 'New load draft from email';
  const body = [
    fromEmail ? `From: ${fromEmail}` : null,
    subject ? `Subject: ${subject}` : null,
    loadId ? `Load draft created (review and approve).` : null
  ]
    .filter(Boolean)
    .join('\n');

  await sendInAppNotificationsToUsers(knex, users, {
    type: 'inbound_email_load',
    title,
    body,
    meta: { load_id: loadId, subject, from: fromEmail },
    tenantId
  }).catch((err) => {
    dtLogger.error('inbound_email_notify_failed', err, { tenantId, loadId });
  });

  return { sent: users.length };
}

// ---------------------------------------------------------------------------
// Top-level pipeline
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {string} input.from        - Raw from header
 * @param {string} input.to          - Raw to header (comma-separated OK)
 * @param {string} input.subject
 * @param {string} input.text        - Plain-text body
 * @param {string} input.html        - HTML body
 * @param {Array<{ buffer: Buffer, originalname: string, mimetype: string, size: number }>} input.files
 * @returns {Promise<{ received: boolean, tenantId?: string, loadId?: string, status: string, reason?: string }>}
 */
async function processInboundEmail(input) {
  const fromRaw = (input.from || '').toString();
  const toAddresses = parseToAddresses(input.to);
  const subject = (input.subject || '').toString();
  const textBody = (input.text || '').toString();
  const htmlBody = (input.html || '').toString();
  const files = Array.isArray(input.files) ? input.files : [];

  const tenant = await resolveTenantByInboundAddress(toAddresses);
  if (!tenant) {
    dtLogger.warn('inbound_email_tenant_not_found', {
      to: toAddresses,
      from: parseAddress(fromRaw) || fromRaw
    });
    return { received: false, status: 'rejected', reason: 'tenant_not_found' };
  }

  const logEntry = await insertInboundEmailLog(tenant.id, {
    from_email: parseAddress(fromRaw) || fromRaw,
    subject,
    body_text: textBody,
    body_html: htmlBody
  });

  const defaultEntity = await knex('operating_entities')
    .where({ tenant_id: tenant.id, is_active: true })
    .orderBy('created_at', 'asc')
    .select('id')
    .first()
    .catch(() => null);
  const operatingEntityId = defaultEntity?.id || null;

  const pdfs = files.filter(
    (f) =>
      f.mimetype === 'application/pdf' ||
      (f.originalname || '').toLowerCase().endsWith('.pdf')
  );

  let primaryLoadId = null;
  let processingStatus = 'success';
  let errorMessage = null;
  const createdLoadIds = [];

  try {
    if (pdfs.length > 0) {
      for (const pdf of pdfs) {
        try {
          const data = await extractLoadFromPdf(
            pdf.buffer,
            pdf.originalname || 'rate-con.pdf'
          );
          const { loadId } = await createDraftLoadFromExtraction({
            tenantId: tenant.id,
            operatingEntityId,
            data
          });
          createdLoadIds.push(loadId);
          if (!primaryLoadId) primaryLoadId = loadId;
          await persistAttachment({
            loadId,
            file: pdf,
            type: 'RATE_CONFIRMATION'
          });
        } catch (perFileErr) {
          dtLogger.error('inbound_email_pdf_extract_failed', perFileErr, {
            filename: pdf.originalname,
            tenantId: tenant.id
          });
        }
      }
      if (!primaryLoadId) {
        processingStatus = 'failed';
        errorMessage = 'All PDF extractions failed';
      }
    } else {
      const { loadId } = await createDraftLoadFromBody({
        tenantId: tenant.id,
        operatingEntityId,
        fromEmail: parseAddress(fromRaw) || fromRaw,
        subject,
        bodyText: textBody || htmlBody
      });
      primaryLoadId = loadId;
      createdLoadIds.push(loadId);
    }
  } catch (pipelineErr) {
    dtLogger.error('inbound_email_pipeline_failed', pipelineErr, {
      tenantId: tenant.id
    });
    processingStatus = 'failed';
    errorMessage = pipelineErr?.message || String(pipelineErr);
  }

  await updateInboundEmailLog(logEntry.id, {
    load_id: primaryLoadId,
    processing_status: processingStatus,
    error_message: errorMessage
  });

  if (primaryLoadId) {
    await notifyDispatchers({
      tenantId: tenant.id,
      loadId: primaryLoadId,
      subject,
      fromEmail: parseAddress(fromRaw) || fromRaw
    });
  }

  dtLogger.info('inbound_email_processed', {
    tenantId: tenant.id,
    loadId: primaryLoadId,
    pdfCount: pdfs.length,
    status: processingStatus,
    createdLoadCount: createdLoadIds.length
  });

  return {
    received: true,
    tenantId: tenant.id,
    loadId: primaryLoadId,
    status: processingStatus,
    createdLoadIds
  };
}

module.exports = {
  // public entry points
  processInboundEmail,
  verifyWebhookSecret,

  // exported for unit tests
  parseAddress,
  parseToAddresses,
  buildLoc,
  resolveTenantByInboundAddress,
  insertInboundEmailLog,
  updateInboundEmailLog,
  createDraftLoadFromExtraction,
  createDraftLoadFromBody,
  notifyDispatchers
};
