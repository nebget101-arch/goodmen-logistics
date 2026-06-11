'use strict';

const db = require('../internal/db').knex;
const dtLogger = require('../utils/logger');

const TABLE = 'vendor_positions';
const THROTTLE_MS = 30 * 1000;

async function recordHeartbeat(vendorId, tenantId, { lat, lng }) {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (isNaN(latN) || latN < -90 || latN > 90) throw new Error('lat must be between -90 and 90');
  if (isNaN(lngN) || lngN < -180 || lngN > 180) throw new Error('lng must be between -180 and 180');

  const throttleCutoff = new Date(Date.now() - THROTTLE_MS);
  const recent = await db(TABLE)
    .where({ vendor_id: vendorId })
    .where('recorded_at', '>=', throttleCutoff)
    .orderBy('recorded_at', 'desc')
    .first();

  if (recent) {
    const nextAllowed = new Date(new Date(recent.recorded_at).getTime() + THROTTLE_MS);
    dtLogger.info('vendor_heartbeat_throttled', { vendor_id: vendorId, next_allowed_at: nextAllowed });
    return { throttled: true, next_allowed_at: nextAllowed };
  }

  const [row] = await db(TABLE)
    .insert({
      vendor_id: vendorId,
      tenant_id: tenantId || null,
      lat: latN,
      lng: lngN,
      recorded_at: db.fn.now(),
    })
    .returning('*');

  dtLogger.info('vendor_heartbeat_recorded', { vendor_id: vendorId, lat: latN, lng: lngN });
  return { throttled: false, position: row };
}

async function getLatestPosition(vendorId) {
  return db(TABLE)
    .where({ vendor_id: vendorId })
    .orderBy('recorded_at', 'desc')
    .first();
}

module.exports = { recordHeartbeat, getLatestPosition };
