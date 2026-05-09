'use strict';

/**
 * Loads spreadsheet → import service (FN-1590).
 *
 * Three-phase pipeline:
 *   1. preview  — parse the file, hash it, store it in R2, look up the
 *                 column-mapping cache, optionally call the AI service for a
 *                 mapping suggestion, and create a `load_import_batches` row.
 *   2. stage    — apply a finalized column mapping to every row, write
 *                 normalized per-row outcomes to `load_import_rows`. No AI.
 *   3. commit   — open ONE transaction, walk each `ok` row, fuzzy-match
 *                 broker/driver/truck/trailer, INSERT loads + load_stops,
 *                 record duplicates, route low-confidence rows to DRAFT +
 *                 needs_review. Idempotent: re-committing returns the cached
 *                 result_summary without re-inserting.
 *
 * Phase 1 caps the row count at 500. Anything larger gets a 413 with a
 * Phase 2 pointer (async processing isn't built yet).
 */

const crypto = require('crypto');
const { query, getClient } = require('../internal/db');
const dtLogger = require('../utils/logger');
const { uploadBuffer, downloadBuffer } = require('../storage/r2-storage');
const { parseFileBuffer } = require('./fuel-parser');
const fuzzy = require('./fuzzy-match-service');
const {
  trimOrNull,
  applyColumnMapping,
  buildStopsFromRow,
  coerceRate,
  parseImportDate
} = require('./loads-import-mapper');

const PHASE_1_ROW_CAP = 500;
const SAMPLE_ROW_COUNT = 20;
const AI_CACHE_TTL_DAYS = 7;
const AI_REQUEST_TIMEOUT_MS = 15_000;

const LOAD_STATUSES = new Set([
  'DRAFT', 'NEW', 'CANCELLED', 'CANCELED', 'TONU', 'DISPATCHED',
  'EN_ROUTE', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'
]);
const BILLING_STATUSES = new Set([
  'PENDING', 'CANCELLED', 'CANCELED', 'BOL_RECEIVED', 'INVOICED',
  'SENT_TO_FACTORING', 'FUNDED', 'PAID'
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Look the column mapping up in `load_ai_extractions` keyed by tenant + file
 * hash. Returns the cached AI result or null on miss / TTL expiry. The cache
 * column is named `pdf_hash` for legacy reasons (FN-741) but stores any
 * SHA-256 hex.
 *
 * Shape-guard (FN-1597): older entries written before the envelope-unwrap fix
 * stored the AI handler's full envelope (`{ success, fallback, data, ... }`)
 * instead of the validated data payload. Those entries lack `columnMapping`
 * at the top level, so callers see all-null mappings on a "cache hit". Treat
 * any cached row missing `columnMapping` as a miss so a fresh AI call repairs
 * the entry on next preview.
 */
async function lookupAiCache(tenantId, fileHash) {
  const result = await query(
    `SELECT extracted_data
       FROM load_ai_extractions
      WHERE tenant_id = $1
        AND pdf_hash = $2
        AND created_at > NOW() - INTERVAL '${AI_CACHE_TTL_DAYS} days'
      LIMIT 1`,
    [tenantId, fileHash]
  );
  if (!result.rows.length) return null;
  const cached = result.rows[0].extracted_data;
  if (!cached || typeof cached !== 'object' || !cached.columnMapping) return null;
  return cached;
}

async function writeAiCache(tenantId, fileHash, extractedData) {
  // Upsert so a stale entry past TTL gets refreshed without 23505 collisions.
  await query(
    `INSERT INTO load_ai_extractions (tenant_id, pdf_hash, extracted_data, extraction_method)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, pdf_hash) DO UPDATE
       SET extracted_data = EXCLUDED.extracted_data,
           extraction_method = EXCLUDED.extraction_method,
           created_at = NOW()`,
    [tenantId, fileHash, JSON.stringify(extractedData), 'spreadsheet-import']
  );
}

/**
 * Call the AI service for column-mapping inference. Returns the unwrapped
 * data payload (`columnMapping`, `statusEnumMapping`, ...) on success, or
 * null on any failure (timeout, unreachable, non-2xx, parse error,
 * `success !== true`, or fallback response).
 *
 * The handler at ai-service `/api/ai/loads/spreadsheet-import` returns an
 * envelope: `{ success, fallback, cacheHit, data, meta }`. Earlier versions
 * of this consumer returned the whole envelope, which left every downstream
 * `aiResult.columnMapping` lookup undefined and silently dropped every AI
 * call (FN-1597). Unwrap to `body.data` here so the rest of the service can
 * read fields directly.
 *
 * Failure is non-fatal: the wizard can fall back to manual mapping.
 */
async function callAiColumnMapping({ tenantId, headers, sampleRows, fileName }) {
  const baseUrl = process.env.AI_SERVICE_URL || 'http://localhost:4100';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/ai/loads/spreadsheet-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, headers, sampleRows, fileName }),
      signal: controller.signal
    });
    if (!response.ok) {
      dtLogger.warn('loads_import_ai_non_2xx', { status: response.status });
      return null;
    }
    const body = await response.json();
    if (!body || body.success !== true || body.fallback === true) {
      dtLogger.warn('loads_import_ai_fallback_or_failed', {
        success: body?.success === true,
        fallback: body?.fallback === true
      });
      return null;
    }
    return body.data || null;
  } catch (err) {
    dtLogger.warn('loads_import_ai_unreachable', {
      error: err.message,
      aborted: err.name === 'AbortError'
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── 1. PREVIEW ───────────────────────────────────────────────────────────────

async function previewImport({
  tenantId,
  operatingEntityId,
  userId,
  buffer,
  fileName,
  fileMime
}) {
  if (!tenantId) throw new HttpError(401, 'Tenant context required');
  if (!userId) throw new HttpError(401, 'User context required');
  if (!buffer || !buffer.length) throw new HttpError(400, 'No file uploaded');

  const fileHash = sha256Hex(buffer);
  const { headers, rows } = parseFileBuffer(buffer, fileName);
  if (!headers.length) throw new HttpError(400, 'Could not parse headers from file');

  if (rows.length > PHASE_1_ROW_CAP) {
    throw new HttpError(
      413,
      `Files >${PHASE_1_ROW_CAP} rows require async processing (Phase 2)`
    );
  }

  // Build the AI sample (first 20 rows, header → value object form).
  const sampleRows = rows.slice(0, SAMPLE_ROW_COUNT);

  // R2 storage (best-effort: a missing R2 config shouldn't kill the upload).
  let storageKey = null;
  try {
    const uploaded = await uploadBuffer({
      buffer,
      contentType: fileMime || 'application/octet-stream',
      prefix: `loads/import/${tenantId}`,
      fileName
    });
    storageKey = uploaded.key;
  } catch (err) {
    dtLogger.warn('loads_import_r2_upload_failed', { error: err.message });
  }

  // AI cache: hit returns immediately, miss calls the AI service.
  // `aiResult` from either path is the unwrapped data payload (columnMapping,
  // statusEnumMapping, ...) — never the AI handler envelope. callAiColumnMapping
  // returns null on fallback / failure, so any non-null value is safe to cache.
  let aiResult = await lookupAiCache(tenantId, fileHash);
  const cacheHit = !!aiResult;
  let aiUnavailable = false;
  if (!cacheHit) {
    aiResult = await callAiColumnMapping({ tenantId, headers, sampleRows, fileName });
    if (aiResult) {
      try { await writeAiCache(tenantId, fileHash, aiResult); }
      catch (err) { dtLogger.warn('loads_import_ai_cache_write_failed', { error: err.message }); }
    } else {
      aiUnavailable = true;
    }
  }

  // Persist the batch row in 'pending' state.
  const insertResult = await query(
    `INSERT INTO load_import_batches (
       tenant_id, operating_entity_id, file_name, file_hash, file_size_bytes,
       storage_key, row_count, status, ai_metadata, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)
     RETURNING id`,
    [
      tenantId,
      operatingEntityId || null,
      fileName,
      fileHash,
      buffer.length,
      storageKey,
      rows.length,
      aiResult ? JSON.stringify(aiResult) : null,
      userId
    ]
  );
  const batchId = insertResult.rows[0].id;

  return {
    batchId,
    headers,
    sampleRows,
    totalRows: rows.length,
    fileHash,
    cacheHit,
    aiUnavailable,
    columnMapping: aiResult?.columnMapping || null,
    statusEnumMapping: aiResult?.statusEnumMapping || null,
    billingStatusEnumMapping: aiResult?.billingStatusEnumMapping || null,
    multiStopPattern: aiResult?.multiStopPattern || null,
    overallConfidence: aiResult?.overallConfidence ?? null,
    warnings: aiResult?.warnings || []
  };
}

// ─── 2. STAGE ─────────────────────────────────────────────────────────────────

async function getBatch(batchId, tenantId) {
  const result = await query(
    `SELECT id, tenant_id, operating_entity_id, file_name, file_hash,
            storage_key, row_count, status, ai_metadata, result_summary,
            created_by, created_at, committed_at
       FROM load_import_batches
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1`,
    [batchId, tenantId]
  );
  return result.rows[0] || null;
}

async function getBatchOrThrow(batchId, tenantId) {
  const batch = await getBatch(batchId, tenantId);
  if (!batch) throw new HttpError(404, 'Batch not found');
  return batch;
}

async function stageBatch({
  tenantId,
  operatingEntityId,
  batchId,
  columnMapping,
  statusEnumMapping = {},
  billingStatusEnumMapping = {},
  multiStopPattern = 'single',
  groupByColumn = null
}) {
  if (!tenantId) throw new HttpError(401, 'Tenant context required');
  if (!batchId) throw new HttpError(400, 'batchId is required');
  if (!columnMapping || typeof columnMapping !== 'object') {
    throw new HttpError(400, 'columnMapping is required');
  }

  const batch = await getBatchOrThrow(batchId, tenantId);
  if (batch.status === 'committed') throw new HttpError(409, 'Batch already committed');
  if (!batch.storage_key) throw new HttpError(409, 'Batch has no stored file (preview failed)');

  // Pull the file back from R2 and re-parse it. We reparse rather than
  // trusting an in-memory cache because stage may run in a different request
  // (and even a different process behind the gateway).
  let fileBuffer;
  try {
    fileBuffer = await downloadBuffer(batch.storage_key);
  } catch (err) {
    throw new HttpError(502, `Failed to read uploaded file from storage: ${err.message}`);
  }

  const { rows } = parseFileBuffer(fileBuffer, batch.file_name);
  if (rows.length === 0) {
    await query(
      `UPDATE load_import_batches
          SET status='staged',
              ai_metadata = COALESCE(ai_metadata, '{}'::jsonb) || $1::jsonb
        WHERE id = $2`,
      [JSON.stringify({ stagedAt: new Date().toISOString(), staged: true }), batchId]
    );
    return { batchId, totalRows: 0, ok: 0, needsReview: 0, errors: 0 };
  }

  // Wipe any prior staging output (idempotent re-stage).
  await query(`DELETE FROM load_import_rows WHERE batch_id = $1`, [batchId]);

  // FN-1603: surface AI-emitted batch warnings so applyColumnMapping can
  // split combined "City, ST" cells into discrete sub-fields.
  const batchWarnings = Array.isArray(batch.ai_metadata?.warnings)
    ? batch.ai_metadata.warnings
    : [];

  const summary = { ok: 0, needsReview: 0, errors: 0 };
  const insertSql = `
    INSERT INTO load_import_rows (
      batch_id, source_row_index, raw_values, normalized_values,
      validation_status, error_messages, confidence_score
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
  `;

  // Group-by support for multi_row pattern (one logical load spans N rows).
  // For Phase 1 we still write a row per source line; the grouping signal is
  // recorded in normalized_values so commit can assemble multi-stop loads.
  for (let i = 0; i < rows.length; i += 1) {
    const raw = rows[i];
    const rowWarnings = [];
    const mapped = applyColumnMapping(raw, columnMapping, {
      warnings: batchWarnings,
      rowWarnings
    });
    const errors = [];

    // Required fields per spec: at minimum a load_number OR a po_number.
    if (!mapped.load_number && !mapped.po_number) {
      errors.push('Missing load_number / po_number');
    }

    // FN-1603: combined-cell parser failures degrade the row to needs_review
    // so the user can fix city/state in the wizard before commit.
    if (rowWarnings.length) errors.push(...rowWarnings);

    // Status enum normalization.
    let mappedStatus = null;
    if (mapped.status) {
      const candidate =
        statusEnumMapping[mapped.status] ||
        statusEnumMapping[mapped.status.toUpperCase?.() || ''] ||
        mapped.status.toUpperCase();
      mappedStatus = LOAD_STATUSES.has(candidate) ? candidate : null;
      if (!mappedStatus) errors.push(`Unmappable status "${mapped.status}"`);
    }

    let mappedBilling = null;
    if (mapped.billing_status) {
      const candidate =
        billingStatusEnumMapping[mapped.billing_status] ||
        billingStatusEnumMapping[mapped.billing_status.toUpperCase?.() || ''] ||
        mapped.billing_status.toUpperCase();
      mappedBilling = BILLING_STATUSES.has(candidate) ? candidate : null;
      if (!mappedBilling) errors.push(`Unmappable billing_status "${mapped.billing_status}"`);
    }

    // Multi-stop pattern hint per row — commit reads this to decide stops.
    const stopsHint = {
      pattern: multiStopPattern,
      groupByValue:
        multiStopPattern === 'multi_row' && groupByColumn
          ? trimOrNull(raw[groupByColumn])
          : null
    };

    const normalized = {
      ...mapped,
      _status: mappedStatus,
      _billing_status: mappedBilling,
      _stops_hint: stopsHint
    };

    let validationStatus;
    if (errors.length === 0) {
      validationStatus = 'ok';
      summary.ok += 1;
    } else if (errors.some((m) => m.startsWith('Missing'))) {
      validationStatus = 'error';
      summary.errors += 1;
    } else {
      validationStatus = 'needs_review';
      summary.needsReview += 1;
    }

    await query(insertSql, [
      batchId,
      i,
      JSON.stringify(raw),
      JSON.stringify(normalized),
      validationStatus,
      errors.length ? JSON.stringify(errors) : null,
      null
    ]);
  }

  await query(
    `UPDATE load_import_batches
        SET status='staged',
            row_count = $1,
            ai_metadata = COALESCE(ai_metadata, '{}'::jsonb) || $2::jsonb
      WHERE id = $3`,
    [
      rows.length,
      JSON.stringify({
        stagedAt: new Date().toISOString(),
        finalColumnMapping: columnMapping,
        statusEnumMapping,
        billingStatusEnumMapping,
        multiStopPattern,
        groupByColumn
      }),
      batchId
    ]
  );

  return { batchId, totalRows: rows.length, ...summary };
}

// ─── 3. COMMIT ────────────────────────────────────────────────────────────────

async function checkExistingLoadNumber(client, tenantId, loadNumber) {
  if (!loadNumber) return null;
  const result = await client.query(
    `SELECT id, load_number FROM loads
      WHERE tenant_id = $1 AND load_number = $2
      LIMIT 1`,
    [tenantId, loadNumber]
  );
  return result.rows[0] || null;
}

async function commitBatch({
  tenantId,
  operatingEntityId,
  userId,
  batchId,
  autoThreshold
}) {
  if (!tenantId) throw new HttpError(401, 'Tenant context required');
  if (!batchId) throw new HttpError(400, 'batchId is required');

  const threshold =
    typeof autoThreshold === 'number' && autoThreshold >= 0 && autoThreshold <= 1
      ? autoThreshold
      : Number(process.env.LOADS_IMPORT_AUTO_THRESHOLD || '0.85');

  const batch = await getBatchOrThrow(batchId, tenantId);

  // Idempotency — replay the cached summary instead of inserting again.
  if (batch.status === 'committed' && batch.result_summary) {
    return { batchId, idempotent: true, ...batch.result_summary };
  }
  if (batch.status !== 'staged') {
    throw new HttpError(409, `Batch is in '${batch.status}' status; stage first`);
  }

  const stagedRows = await query(
    `SELECT id, source_row_index, raw_values, normalized_values, validation_status
       FROM load_import_rows
      WHERE batch_id = $1
        AND validation_status IN ('ok', 'needs_review')
      ORDER BY source_row_index ASC`,
    [batchId]
  );

  // Pull stage-time AI artifacts so commit can apply confidences and the
  // statusEnumMapping defensively (FN-1601). `ai_metadata` may be missing
  // for legacy batches; treat missing fields as empty.
  const batchAi = batch.ai_metadata || {};
  const stagedStatusEnumMapping = batchAi.statusEnumMapping || {};
  const finalColumnMapping = batchAi.finalColumnMapping || {};
  const fieldConfidence = (field) => {
    const def = finalColumnMapping[field];
    if (!def || typeof def !== 'object') return null;
    const c = def.confidence;
    return typeof c === 'number' ? c : null;
  };

  const created = { auto: 0, needsReview: 0 };
  const duplicates = [];
  const errors = [];

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE load_import_batches SET status = 'committing' WHERE id = $1`,
      [batchId]
    );

    for (const row of stagedRows.rows) {
      const normalized = row.normalized_values || {};
      const loadNumber = trimOrNull(normalized.load_number) ||
        (trimOrNull(normalized.po_number) ? trimOrNull(normalized.po_number).slice(0, 50) : null);

      if (!loadNumber) {
        errors.push({ rowIndex: row.source_row_index, message: 'No load_number / po_number after staging' });
        await client.query(
          `UPDATE load_import_rows SET validation_status = 'error',
                  error_messages = COALESCE(error_messages, '[]'::jsonb) || $1::jsonb
            WHERE id = $2`,
          [JSON.stringify(['No load_number / po_number after staging']), row.id]
        );
        continue;
      }

      const existing = await checkExistingLoadNumber(client, tenantId, loadNumber);
      if (existing) {
        duplicates.push({
          rowIndex: row.source_row_index,
          loadNumber,
          existingLoadId: existing.id,
          existingLoadKey: existing.load_number
        });
        await client.query(
          `UPDATE load_import_rows SET validation_status = 'duplicate',
                  error_messages = COALESCE(error_messages, '[]'::jsonb) || $1::jsonb
            WHERE id = $2`,
          [JSON.stringify([`Duplicate load_number: ${loadNumber}`]), row.id]
        );
        continue;
      }

      // Fuzzy entity matching (broker / driver / truck / trailer). Failures
      // from the matcher MUST NOT throw — they leave the FK null instead.
      let brokerMatch = null;
      let driverMatch = null;
      let truckMatch = null;
      let trailerMatch = null;
      try {
        brokerMatch = await fuzzy.matchBroker({
          name: normalized.broker_name,
          mcNumber: normalized.broker_mc_number,
          dotNumber: normalized.broker_dot_number
        });
        driverMatch = await fuzzy.matchDriver({
          tenantId, operatingEntityId,
          name: normalized.driver,
          email: normalized.driver_email
        });
        truckMatch = await fuzzy.matchVehicle({
          tenantId, operatingEntityId,
          unit: normalized.truck,
          kind: 'truck'
        });
        trailerMatch = await fuzzy.matchVehicle({
          tenantId, operatingEntityId,
          unit: normalized.trailer,
          kind: 'trailer'
        });
      } catch (err) {
        // Matchers run outside the transaction's main path — surface but
        // continue. The row will be needs_review with no FK.
        dtLogger.warn('loads_import_fuzzy_match_failed', {
          rowIndex: row.source_row_index,
          error: err.message
        });
      }

      // Threshold gating: max(broker, driver) decides auto vs needs-review.
      // FN-1601: this no longer overrides the AI-mapped status — status and
      // FK matching are independent decisions. Low FK confidence still flags
      // the row for review, but a high-confidence "DELIVERED" stays
      // "DELIVERED" rather than being force-DRAFTed.
      const maxScore = Math.max(
        brokerMatch?.score || 0,
        driverMatch?.score || 0
      );
      const aboveThreshold = maxScore >= threshold;

      const rowWarnings = [];

      let finalStatus;
      if (normalized._status) {
        // Stage already mapped + validated against LOAD_STATUSES.
        finalStatus = normalized._status;
      } else if (trimOrNull(normalized.status)) {
        // Stage couldn't map (or row was needs_review). Apply the stashed
        // statusEnumMapping defensively at commit time so we don't lose a
        // perfectly good mapping just because some other field flagged the
        // row at stage. Fall back to DRAFT when the mapped value isn't in
        // the FN load status enum.
        const raw = String(normalized.status).trim();
        const candidate =
          stagedStatusEnumMapping[raw] ||
          stagedStatusEnumMapping[raw.toUpperCase()] ||
          raw.toUpperCase();
        if (LOAD_STATUSES.has(candidate)) {
          finalStatus = candidate;
        } else {
          rowWarnings.push(
            `status "${raw}" → "${candidate}" not in FN load status enum; defaulted to DRAFT`
          );
          finalStatus = 'DRAFT';
        }
      } else if (aboveThreshold) {
        finalStatus = 'NEW';
      } else {
        finalStatus = 'DRAFT';
      }

      const finalBilling = normalized._billing_status || 'PENDING';
      const stops = buildStopsFromRow(normalized);

      let needsReview = !aboveThreshold;
      if (stops.length === 0) needsReview = true;
      if (normalized._stops_hint?.pattern === 'free_text') needsReview = true;

      // Date persistence — the parser handles ISO, MM/DD/YYYY, and JS
      // toString() form; returns null for unparseable values so the DATE
      // column stays valid.
      const pickupDate = parseImportDate(normalized.pickup_date);
      const deliveryDate = parseImportDate(normalized.delivery_date);
      const completedDate = parseImportDate(normalized.completed_date);

      // Driver name fallback — only when no FK match. With a match the SELECT
      // projection's `concat_ws(d.first_name, d.last_name)` populates the
      // displayed name; without one we want the raw mapped string visible
      // instead of the empty string concat_ws returns.
      const driverNameText = driverMatch?.id
        ? null
        : trimOrNull(normalized.driver_name);

      const aiMetadata = {
        source: 'spreadsheet-import',
        batchId,
        sourceRowIndex: row.source_row_index,
        confidences: {
          broker: brokerMatch?.score || null,
          driver: driverMatch?.score || null,
          truck: truckMatch?.score || null,
          trailer: trailerMatch?.score || null,
          pickup_date: fieldConfidence('pickup_date'),
          delivery_date: fieldConfidence('delivery_date'),
          completed_date: fieldConfidence('completed_date'),
          driver_name: fieldConfidence('driver_name'),
          status: fieldConfidence('status')
        },
        matchedOn: {
          broker: brokerMatch?.matchedOn || null,
          driver: driverMatch?.matchedOn || null,
          truck: truckMatch?.matchedOn || null,
          trailer: trailerMatch?.matchedOn || null
        },
        thresholdApplied: threshold,
        warnings: rowWarnings.length ? rowWarnings : []
      };

      let insertResult;
      try {
        insertResult = await client.query(
          `INSERT INTO loads (
             tenant_id, operating_entity_id,
             load_number, status, billing_status, dispatcher_user_id,
             driver_id, truck_id, trailer_id, broker_id, broker_name,
             driver_name, pickup_date, delivery_date, completed_date,
             po_number, rate, notes, needs_review, ai_metadata
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING id`,
          [
            tenantId,
            operatingEntityId || null,
            loadNumber,
            finalStatus,
            finalBilling,
            userId,
            driverMatch?.id || null,
            truckMatch?.id || null,
            trailerMatch?.id || null,
            brokerMatch?.id || null,
            trimOrNull(normalized.broker_name),
            driverNameText,
            pickupDate,
            deliveryDate,
            completedDate,
            trimOrNull(normalized.po_number),
            coerceRate(normalized.rate),
            trimOrNull(normalized.notes),
            needsReview,
            JSON.stringify(aiMetadata)
          ]
        );
      } catch (err) {
        // Constraint violation (e.g. CHECK on status enum) — record per-row,
        // do NOT roll back the whole batch.
        errors.push({ rowIndex: row.source_row_index, message: err.message });
        await client.query(
          `UPDATE load_import_rows SET validation_status = 'error',
                  error_messages = COALESCE(error_messages, '[]'::jsonb) || $1::jsonb
            WHERE id = $2`,
          [JSON.stringify([err.message]), row.id]
        );
        continue;
      }

      const newLoadId = insertResult.rows[0].id;

      for (const stop of stops) {
        await client.query(
          `INSERT INTO load_stops (load_id, stop_type, stop_date, city, state, zip, sequence)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [newLoadId, stop.stopType, stop.stopDate, stop.city, stop.state, stop.zip, stop.sequence]
        );
      }

      await client.query(
        `UPDATE load_import_rows
            SET resulting_load_id = $1,
                validation_status = 'ok',
                confidence_score = $2
          WHERE id = $3`,
        [newLoadId, maxScore, row.id]
      );

      if (needsReview) created.needsReview += 1;
      else created.auto += 1;
    }

    const summary = { created, duplicates, errors };

    await client.query(
      `UPDATE load_import_batches
          SET status = 'committed',
              committed_at = NOW(),
              result_summary = $1::jsonb
        WHERE id = $2`,
      [JSON.stringify(summary), batchId]
    );

    await client.query('COMMIT');
    return { batchId, ...summary };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await query(
      `UPDATE load_import_batches SET status = 'failed' WHERE id = $1`,
      [batchId]
    ).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── LISTING / DETAIL ─────────────────────────────────────────────────────────

async function listBatches({ tenantId, operatingEntityId, limit = 50, offset = 0 }) {
  if (!tenantId) throw new HttpError(401, 'Tenant context required');
  const params = [tenantId];
  let where = `tenant_id = $1`;
  if (operatingEntityId) { params.push(operatingEntityId); where += ` AND operating_entity_id = $${params.length}`; }
  params.push(Math.min(Number(limit) || 50, 200));
  params.push(Math.max(Number(offset) || 0, 0));

  const result = await query(
    `SELECT id, file_name, file_hash, status, row_count, result_summary,
            created_by, created_at, committed_at, operating_entity_id
       FROM load_import_batches
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { batches: result.rows };
}

async function getBatchDetail({ tenantId, batchId }) {
  if (!tenantId) throw new HttpError(401, 'Tenant context required');
  if (!batchId) throw new HttpError(400, 'batchId is required');
  const batch = await getBatchOrThrow(batchId, tenantId);
  const rowsResult = await query(
    `SELECT source_row_index, validation_status, confidence_score,
            resulting_load_id, error_messages
       FROM load_import_rows
      WHERE batch_id = $1
      ORDER BY source_row_index ASC
      LIMIT 1000`,
    [batchId]
  );
  const summary = rowsResult.rows.reduce((acc, row) => {
    acc[row.validation_status] = (acc[row.validation_status] || 0) + 1;
    return acc;
  }, {});
  return { batch, summary, rows: rowsResult.rows };
}

module.exports = {
  PHASE_1_ROW_CAP,
  HttpError,
  previewImport,
  stageBatch,
  commitBatch,
  listBatches,
  getBatchDetail,
  // exposed for tests
  applyColumnMapping,
  buildStopsFromRow,
  callAiColumnMapping,
  lookupAiCache,
  writeAiCache,
  parseImportDate
};
