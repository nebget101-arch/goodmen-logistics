'use strict';

/**
 * FN-1222: GDPR consent capture for voice calls.
 * Persists consent decisions to the `voice_consent` table (created by FN-1223).
 * A call is not recorded until consent is affirmatively granted.
 */

function getKnex() {
  try {
    return require('@goodmen/shared/internal/db').knex;
  } catch (_) {
    return null;
  }
}

const CONSENT_GRANTED = 'granted';
const CONSENT_DECLINED = 'declined';

async function recordConsent(callSid, tenantId, did, granted, { db } = {}) {
  const knex = db || getKnex();
  if (!knex) throw new Error('Database not initialised');

  const status = granted ? CONSENT_GRANTED : CONSENT_DECLINED;
  await knex('voice_consent').insert({
    call_sid: callSid,
    tenant_id: tenantId,
    did,
    status,
    consented_at: knex.fn.now()
  });
  return status;
}

async function getConsent(callSid, { db } = {}) {
  const knex = db || getKnex();
  if (!knex) throw new Error('Database not initialised');

  const row = await knex('voice_consent')
    .where({ call_sid: callSid })
    .orderBy('consented_at', 'desc')
    .first('status');
  return row ? row.status : null;
}

module.exports = {
  recordConsent,
  getConsent,
  CONSENT_GRANTED,
  CONSENT_DECLINED
};
