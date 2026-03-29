'use strict';

const dtLogger = require('../utils/logger');

/**
 * Sync toll device drivers when a truck's driver assignment changes.
 *
 * Updates `driver_id` on all toll_devices linked to `truckId` where
 * `is_driver_override` is false (auto-resolved, not manually overridden).
 *
 * This function supports both knex and raw pg client callers:
 *   - Knex: pass `{ knex: trx, tenantId, truckId, newDriverId }`
 *   - Raw pg: pass `{ client, tenantId, truckId, newDriverId }`
 *
 * @param {Object} opts
 * @param {Object} [opts.knex]        - Knex instance or transaction
 * @param {Object} [opts.client]      - Raw pg client (from getClient())
 * @param {string} opts.tenantId      - Tenant UUID
 * @param {string} opts.truckId       - Truck UUID whose devices to update
 * @param {string|null} opts.newDriverId - New driver UUID (null to clear)
 * @returns {Promise<number>} Count of devices updated
 */
async function syncTollDeviceDrivers({ knex, client, tenantId, truckId, newDriverId }) {
  if (!tenantId || !truckId) return 0;

  try {
    let updatedCount = 0;

    if (knex) {
      // Knex / transaction path
      updatedCount = await knex('toll_devices')
        .where({ tenant_id: tenantId, truck_id: truckId, is_driver_override: false })
        .update({ driver_id: newDriverId || null, updated_at: knex.fn ? knex.fn.now() : new Date() });
    } else if (client) {
      // Raw pg client path (used by drivers.js)
      const result = await client.query(
        `UPDATE toll_devices
         SET driver_id = $1, updated_at = NOW()
         WHERE tenant_id = $2
           AND truck_id = $3
           AND is_driver_override = false`,
        [newDriverId || null, tenantId, truckId]
      );
      updatedCount = result.rowCount || 0;
    } else {
      dtLogger.warn('syncTollDeviceDrivers called without knex or client');
      return 0;
    }

    if (updatedCount > 0) {
      dtLogger.info('toll_device_driver_sync_completed', {
        tenantId,
        truckId,
        newDriverId: newDriverId || null,
        devicesUpdated: updatedCount
      });
    }

    return updatedCount;
  } catch (error) {
    dtLogger.error('toll_device_driver_sync_failed', error, {
      tenantId,
      truckId,
      newDriverId: newDriverId || null
    });
    // Non-fatal: don't break the parent operation
    return 0;
  }
}

module.exports = { syncTollDeviceDrivers };
