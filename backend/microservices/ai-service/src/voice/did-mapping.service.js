'use strict';

/**
 * FN-1222: DID → tenant mapping.
 * Queries the `did_mapping` table (created by FN-1223) to resolve an
 * inbound phone number to a tenantId. Returns null when unmapped so the
 * caller can reject the call with a polite message.
 */

function getKnex() {
  try {
    return require('@goodmen/shared/internal/db').knex;
  } catch (_) {
    return null;
  }
}

async function lookupTenant(did, { db } = {}) {
  const knex = db || getKnex();
  if (!knex) throw new Error('Database not initialised');

  const normalised = normaliseDid(did);
  const row = await knex('did_mapping')
    .where({ did: normalised, is_active: true })
    .first('tenant_id');
  return row ? row.tenant_id : null;
}

function normaliseDid(did) {
  if (!did) return '';
  const digits = String(did).replace(/\D/g, '');
  return digits.startsWith('1') && digits.length === 11
    ? `+${digits}`
    : `+1${digits.slice(-10)}`;
}

module.exports = { lookupTenant, normaliseDid };
