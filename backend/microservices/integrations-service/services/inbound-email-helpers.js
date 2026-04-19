'use strict';

/**
 * Pure helpers for the inbound-email pipeline — no DB or external deps so unit
 * tests can exercise them without standing up knex/R2.
 */

const crypto = require('crypto');

function parseAddress(raw) {
  if (!raw) return null;
  const str = raw.toString();
  const angle = str.match(/<([^>]+@[^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = str.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return bare ? bare[0].trim().toLowerCase() : null;
}

function parseToAddresses(toField) {
  if (!toField) return [];
  return toField
    .toString()
    .split(',')
    .map((part) => parseAddress(part))
    .filter(Boolean);
}

function buildLoc(obj = {}) {
  const parts = [(obj.city || '').trim(), (obj.state || '').trim()].filter(Boolean);
  const loc = parts.join(', ');
  const zip = (obj.zip || '').toString().trim();
  return zip ? (loc ? `${loc} ${zip}` : zip) : loc || 'UNKNOWN';
}

function normalizeDate(value, fallback) {
  const str = (value || '').toString().trim();
  if (!str) return fallback;
  return str.slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowIso() {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

const TEST_PENDING_STATUS = 'test_pending';
const TEST_PENDING_WINDOW_MS = 5 * 60 * 1000;

function normalizeSubject(subject) {
  return (subject || '').toString().trim().toLowerCase();
}

/**
 * FN-782 — Pure decision: given a candidate test_pending row and an incoming
 * email's subject + current time, return true iff the candidate should be
 * reconciled (updated in place) rather than letting a fresh log row be
 * inserted. Matching requires: (1) the row is still test_pending, (2) it is
 * within `windowMs` of `nowMs`, and (3) the normalized subject matches the
 * incoming subject exactly.
 */
function matchesTestPendingRow(row, { subject, nowMs, windowMs = TEST_PENDING_WINDOW_MS } = {}) {
  if (!row || row.processing_status !== TEST_PENDING_STATUS) return false;
  const receivedAt = row.received_at ? new Date(row.received_at).getTime() : NaN;
  if (!Number.isFinite(receivedAt)) return false;
  if (!Number.isFinite(nowMs)) return false;
  const delta = nowMs - receivedAt;
  if (delta > windowMs || delta < -windowMs) return false;
  const candidate = normalizeSubject(row.subject);
  if (!candidate) return false;
  return candidate === normalizeSubject(subject);
}

function verifyWebhookSecret(req) {
  const expected = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (!expected) return { ok: true, reason: 'no_secret_configured' };
  const provided =
    (req?.headers?.['x-webhook-secret'] || req?.query?.secret || '').toString();
  if (!provided) return { ok: false, reason: 'missing_secret' };
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: 'bad_secret' };
  try {
    return crypto.timingSafeEqual(a, b)
      ? { ok: true }
      : { ok: false, reason: 'bad_secret' };
  } catch (_err) {
    return { ok: false, reason: 'bad_secret' };
  }
}

module.exports = {
  parseAddress,
  parseToAddresses,
  buildLoc,
  normalizeDate,
  todayIso,
  tomorrowIso,
  verifyWebhookSecret,
  matchesTestPendingRow,
  TEST_PENDING_WINDOW_MS
};
