'use strict';

/**
 * Toll Matching Service (FN-468)
 *
 * Core resolution logic: transponder -> vehicle -> driver.
 *
 * resolveTollTransaction(knex, tenantId, transaction)
 *   Input:  { device_number_masked, plate_number_raw, transaction_date }
 *   Output: { truck_id, driver_id, toll_device_id, matched_status, exceptions[] }
 */

const dtLogger = require('../utils/logger');

/**
 * Resolve a single toll transaction to truck + driver.
 *
 * @param {import('knex').Knex} knex  – Knex instance
 * @param {number|string} tenantId
 * @param {{ device_number_masked?: string, plate_number_raw?: string, transaction_date: string }} transaction
 * @returns {Promise<{ truck_id: number|null, driver_id: number|null, toll_device_id: number|null, matched_status: string, exceptions: Array<{ type: string, message: string }> }>}
 */
async function resolveTollTransaction(knex, tenantId, transaction) {
  const { device_number_masked, plate_number_raw, transaction_date } = transaction;
  const exceptions = [];

  // ── Step 1: Find transponder ──────────────────────────────────────────────
  let device = null;
  if (device_number_masked) {
    device = await knex('toll_devices')
      .where({ tenant_id: tenantId, device_number_masked })
      .first();
  }
  if (!device && plate_number_raw) {
    device = await knex('toll_devices')
      .where({ tenant_id: tenantId, plate_number: plate_number_raw })
      .first();
  }

  if (!device) {
    return {
      truck_id: null,
      driver_id: null,
      toll_device_id: null,
      matched_status: 'unmatched',
      exceptions: [{
        type: 'unmatched_device',
        message: `No toll device found for device_number_masked="${device_number_masked || ''}" or plate="${plate_number_raw || ''}"`
      }]
    };
  }

  // If driver_id override is set on the device, skip vehicle->driver chain
  if (device.driver_id) {
    return {
      truck_id: device.truck_id || null,
      driver_id: device.driver_id,
      toll_device_id: device.id,
      matched_status: 'matched',
      exceptions
    };
  }

  // ── Step 2: Resolve vehicle ───────────────────────────────────────────────
  let truckId = null;

  // Priority A: assignment history with date-range matching
  const assignment = await knex('toll_device_vehicle_assignments')
    .where({ tenant_id: tenantId, toll_device_id: device.id, status: 'active' })
    .where('assigned_date', '<=', transaction_date)
    .where(function () {
      this.whereNull('removed_date').orWhere('removed_date', '>=', transaction_date);
    })
    .orderBy('assigned_date', 'desc')
    .first();

  if (assignment) {
    truckId = assignment.truck_id;
  }

  // Fallback B: toll_devices.truck_id
  if (!truckId && device.truck_id) {
    truckId = device.truck_id;
  }

  // Fallback C: plate match against vehicles table
  if (!truckId && plate_number_raw) {
    const vehicle = await knex('vehicles')
      .where({ tenant_id: tenantId, plate_number: plate_number_raw })
      .first('id');
    if (vehicle) truckId = vehicle.id;
  }

  // ── Step 3: Resolve driver ────────────────────────────────────────────────
  let driverId = null;

  if (truckId) {
    // Priority A: loads table – active load at transaction time
    const load = await knex('loads')
      .where({ tenant_id: tenantId, truck_id: truckId })
      .where('pickup_date', '<=', transaction_date)
      .where(function () {
        this.whereNull('completed_date').orWhere('completed_date', '>=', transaction_date);
      })
      .orderBy('pickup_date', 'desc')
      .first('driver_id');

    if (load && load.driver_id) {
      driverId = load.driver_id;
    }

    // Priority B: drivers table – active driver assigned to truck
    if (!driverId) {
      const driver = await knex('drivers')
        .where({ tenant_id: tenantId, truck_id: truckId, status: 'active' })
        .first('id');
      if (driver) driverId = driver.id;
    }
  }

  // ── Step 4: Build result ──────────────────────────────────────────────────
  if (!driverId && truckId) {
    // Fetch truck info for the exception message
    const truck = await knex('vehicles').where({ id: truckId }).first('id', 'unit_number', 'plate_number');
    exceptions.push({
      type: 'unmatched_driver',
      message: `Vehicle found (truck_id=${truckId}${truck?.unit_number ? `, unit=${truck.unit_number}` : ''}${truck?.plate_number ? `, plate=${truck.plate_number}` : ''}) but no driver could be resolved`
    });
  }

  const matchedStatus = driverId ? 'matched' : (truckId ? 'partial' : 'unmatched');

  return {
    truck_id: truckId,
    driver_id: driverId,
    toll_device_id: device.id,
    matched_status: matchedStatus,
    exceptions
  };
}

module.exports = { resolveTollTransaction };
