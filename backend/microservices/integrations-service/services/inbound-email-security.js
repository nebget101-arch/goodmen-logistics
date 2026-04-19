'use strict';

/**
 * Inbound email security layer — FN-761
 *
 * Three independent checks run in order after tenant resolution in
 * `processInboundEmail`:
 *
 *   1. Rate limit       — max N emails per tenant per UTC day (default 100)
 *   2. Sender whitelist — optional; if any whitelist rows exist for the
 *                         tenant, the sender must match. If no rows exist,
 *                         the whitelist is inactive (open inbox).
 *   3. Virus scan       — ClamAV INSTREAM via TCP on each PDF attachment.
 *                         Opt-in (requires CLAMAV_HOST/CLAMAV_PORT env vars
 *                         or INBOUND_EMAIL_VIRUS_SCAN=required for hard fail).
 *
 * Each helper is async-safe and schema-defensive: if a table/column is
 * missing (pre-migration), the corresponding check is treated as an empty
 * result (never blocks by surprise).
 */

const net = require('net');
const knex = require('@goodmen/shared/config/knex');
const dtLogger = require('@goodmen/shared/utils/logger');
const { parseAddress } = require('./inbound-email-helpers');

const DEFAULT_DAILY_LIMIT = parseInt(
  process.env.INBOUND_EMAIL_DAILY_LIMIT || '100',
  10
);
const VIRUS_SCAN_MODE = (process.env.INBOUND_EMAIL_VIRUS_SCAN || 'optional')
  .toString()
  .toLowerCase();
const CLAMAV_HOST = process.env.CLAMAV_HOST || null;
const CLAMAV_PORT = parseInt(process.env.CLAMAV_PORT || '3310', 10);
const CLAMAV_TIMEOUT_MS = parseInt(
  process.env.CLAMAV_TIMEOUT_MS || '10000',
  10
);

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

function startOfTodayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Returns `{ allowed, count, limit }`. Counts rows in `inbound_emails` for the
 * tenant since UTC start-of-day (all statuses — including prior rejections —
 * so a flooder can't bypass the limit by forcing failures).
 */
async function checkRateLimit(tenantId, { limit = DEFAULT_DAILY_LIMIT } = {}) {
  if (!tenantId) return { allowed: true, count: 0, limit };
  const hasTable = await knex.schema.hasTable('inbound_emails').catch(() => false);
  if (!hasTable) return { allowed: true, count: 0, limit };
  try {
    const [{ count }] = await knex('inbound_emails')
      .where('tenant_id', tenantId)
      .where('received_at', '>=', startOfTodayIso())
      .count('id as count');
    const n = Number(count) || 0;
    return { allowed: n < limit, count: n, limit };
  } catch (err) {
    dtLogger.error('inbound_email_rate_limit_query_failed', err, { tenantId });
    return { allowed: true, count: 0, limit };
  }
}

// ---------------------------------------------------------------------------
// Whitelist
// ---------------------------------------------------------------------------

async function listWhitelist(tenantId) {
  if (!tenantId) return [];
  const hasTable = await knex.schema
    .hasTable('inbound_email_whitelist')
    .catch(() => false);
  if (!hasTable) return [];
  try {
    return await knex('inbound_email_whitelist')
      .where('tenant_id', tenantId)
      .select('id', 'pattern', 'is_domain', 'created_by_user_id', 'created_at')
      .orderBy('created_at', 'asc');
  } catch (err) {
    dtLogger.error('inbound_email_whitelist_list_failed', err, { tenantId });
    return [];
  }
}

function matchesWhitelist(senderAddress, rows) {
  const addr = (senderAddress || '').toString().trim().toLowerCase();
  if (!addr) return false;
  const atIdx = addr.lastIndexOf('@');
  const senderDomain = atIdx >= 0 ? addr.slice(atIdx) : '';
  for (const row of rows || []) {
    const pattern = (row.pattern || '').toString().trim().toLowerCase();
    if (!pattern) continue;
    if (row.is_domain || pattern.startsWith('@')) {
      const domain = pattern.startsWith('@') ? pattern : `@${pattern}`;
      if (senderDomain === domain) return true;
    } else if (pattern === addr) {
      return true;
    }
  }
  return false;
}

/**
 * Returns `{ enforced, allowed }`.
 *   - `enforced` is false when the tenant has no whitelist rows (open inbox).
 *   - `allowed` is true when a row matches (or when not enforced).
 */
async function checkWhitelist(tenantId, senderAddress) {
  const rows = await listWhitelist(tenantId);
  if (!rows.length) return { enforced: false, allowed: true };
  return { enforced: true, allowed: matchesWhitelist(senderAddress, rows) };
}

async function insertWhitelistEntry(tenantId, pattern, userId) {
  const trimmed = (pattern || '').toString().trim().toLowerCase();
  if (!trimmed) throw new Error('Pattern is required');
  const isDomain = trimmed.startsWith('@');
  const normalized = isDomain ? trimmed : trimmed;
  if (!normalized.includes('@')) {
    throw new Error('Pattern must be an email address or `@domain`');
  }
  const [row] = await knex('inbound_email_whitelist')
    .insert({
      tenant_id: tenantId,
      pattern: normalized,
      is_domain: isDomain,
      created_by_user_id: userId || null
    })
    .returning(['id', 'pattern', 'is_domain', 'created_at']);
  return row;
}

async function deleteWhitelistEntry(tenantId, id) {
  const deleted = await knex('inbound_email_whitelist')
    .where({ tenant_id: tenantId, id })
    .del();
  return deleted > 0;
}

// ---------------------------------------------------------------------------
// Virus scan (ClamAV INSTREAM over TCP)
// ---------------------------------------------------------------------------

function clamAvConfigured() {
  return Boolean(CLAMAV_HOST);
}

/**
 * Scan a single buffer via ClamAV clamd INSTREAM. Returns
 *   { ok: true }                                — clean
 *   { ok: false, signature: 'Eicar-Test-Sig' }  — infected
 * Throws when the connection itself fails so callers can decide whether to
 * fail open (`optional` mode) or hard fail (`required` mode).
 */
function scanBufferWithClamd(buffer) {
  return new Promise((resolve, reject) => {
    if (!clamAvConfigured()) {
      reject(new Error('CLAMAV_HOST not configured'));
      return;
    }
    const socket = new net.Socket();
    let settled = false;
    const chunks = [];

    const cleanup = () => {
      socket.removeAllListeners();
      try { socket.destroy(); } catch (_) {}
    };

    socket.setTimeout(CLAMAV_TIMEOUT_MS);
    socket.on('timeout', () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('ClamAV scan timed out'));
    });
    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      if (settled) return;
      settled = true;
      cleanup();
      const response = Buffer.concat(chunks).toString('utf8').trim();
      // Response format: `stream: OK` or `stream: <signature> FOUND`
      if (/:\s*OK\s*$/.test(response)) {
        resolve({ ok: true, response });
        return;
      }
      const found = response.match(/:\s*(.+?)\s+FOUND/);
      if (found) {
        resolve({ ok: false, signature: found[1], response });
        return;
      }
      reject(new Error(`Unexpected clamd response: ${response}`));
    });

    socket.connect(CLAMAV_PORT, CLAMAV_HOST, () => {
      socket.write('zINSTREAM\0');
      // Send buffer in chunks each prefixed by a 4-byte big-endian length.
      const CHUNK = 64 * 1024;
      let offset = 0;
      while (offset < buffer.length) {
        const end = Math.min(offset + CHUNK, buffer.length);
        const slice = buffer.slice(offset, end);
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(slice.length, 0);
        socket.write(lenBuf);
        socket.write(slice);
        offset = end;
      }
      // Zero-length chunk terminates the stream.
      const terminator = Buffer.alloc(4);
      terminator.writeUInt32BE(0, 0);
      socket.write(terminator);
    });
  });
}

/**
 * Scan a list of PDF attachments. Returns `{ allClean, infected }` where
 * `infected` is an array of `{ filename, signature }`.
 *
 * Scan mode:
 *   - `disabled`  — skip entirely (clean).
 *   - `optional`  (default) — if CLAMAV_HOST unset or scan errors, treat as clean.
 *   - `required`  — if CLAMAV_HOST unset or scan errors, hard fail (blocks processing).
 */
async function scanPdfAttachments(files = []) {
  const pdfs = (files || []).filter(
    (f) =>
      f &&
      f.buffer &&
      (f.mimetype === 'application/pdf' ||
        (f.originalname || '').toLowerCase().endsWith('.pdf'))
  );

  if (VIRUS_SCAN_MODE === 'disabled' || pdfs.length === 0) {
    return { allClean: true, infected: [], scanned: 0, mode: VIRUS_SCAN_MODE };
  }

  if (!clamAvConfigured()) {
    if (VIRUS_SCAN_MODE === 'required') {
      throw new Error('Virus scan required but CLAMAV_HOST not configured');
    }
    return { allClean: true, infected: [], scanned: 0, mode: VIRUS_SCAN_MODE };
  }

  const infected = [];
  let scanned = 0;
  for (const pdf of pdfs) {
    try {
      const result = await scanBufferWithClamd(pdf.buffer);
      scanned += 1;
      if (!result.ok) {
        infected.push({
          filename: pdf.originalname || 'attachment.pdf',
          signature: result.signature
        });
      }
    } catch (err) {
      dtLogger.error('inbound_email_virus_scan_failed', err, {
        filename: pdf.originalname,
        mode: VIRUS_SCAN_MODE
      });
      if (VIRUS_SCAN_MODE === 'required') throw err;
      // `optional`: swallow scan failure and keep processing
    }
  }

  return { allClean: infected.length === 0, infected, scanned, mode: VIRUS_SCAN_MODE };
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{ ok: boolean, rejection?: { reason: string, detail?: string } }>}
 */
async function applySecurityChecks({ tenantId, fromEmail, files } = {}) {
  // Rate limit
  const rate = await checkRateLimit(tenantId);
  if (!rate.allowed) {
    return {
      ok: false,
      rejection: {
        reason: 'rate_limit_exceeded',
        detail: `Daily limit ${rate.limit} reached (count=${rate.count})`
      }
    };
  }

  // Whitelist
  const senderAddress = parseAddress(fromEmail) || fromEmail;
  const whitelist = await checkWhitelist(tenantId, senderAddress);
  if (whitelist.enforced && !whitelist.allowed) {
    return {
      ok: false,
      rejection: {
        reason: 'sender_not_whitelisted',
        detail: `Sender ${senderAddress || '(unknown)'} is not on the tenant whitelist`
      }
    };
  }

  // Virus scan
  let scan;
  try {
    scan = await scanPdfAttachments(files);
  } catch (err) {
    return {
      ok: false,
      rejection: {
        reason: 'virus_scan_error',
        detail: err?.message || 'Virus scan unavailable'
      }
    };
  }
  if (!scan.allClean) {
    const signatures = scan.infected.map((i) => `${i.filename}:${i.signature}`).join(', ');
    return {
      ok: false,
      rejection: {
        reason: 'attachment_infected',
        detail: `Blocked infected attachment(s): ${signatures}`
      }
    };
  }

  return { ok: true };
}

module.exports = {
  applySecurityChecks,
  checkRateLimit,
  checkWhitelist,
  listWhitelist,
  insertWhitelistEntry,
  deleteWhitelistEntry,
  matchesWhitelist,
  scanPdfAttachments,
  scanBufferWithClamd,
  clamAvConfigured,
  DEFAULT_DAILY_LIMIT
};
