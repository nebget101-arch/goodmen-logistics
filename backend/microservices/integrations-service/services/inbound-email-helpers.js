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
  verifyWebhookSecret
};
