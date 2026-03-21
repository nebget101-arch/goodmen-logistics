'use strict';

/**
 * FN-133: Safety roles read-only on /api/vehicles (no POST/PUT/PATCH/DELETE).
 * Run: cd backend/packages/goodmen-shared && npx jest test/vehicles-role-gate.test.js
 */

const vehicleRouter = require('../routes/vehicles');

describe('vehicles router role gate (FN-133)', () => {
  test('safety roles may read but not write', () => {
    expect(vehicleRouter.VEHICLE_READ_ROLES).toContain('safety');
    expect(vehicleRouter.VEHICLE_READ_ROLES).toContain('safety_manager');
    expect(vehicleRouter.VEHICLE_WRITE_ROLES).not.toContain('safety');
    expect(vehicleRouter.VEHICLE_WRITE_ROLES).not.toContain('safety_manager');
  });

  test('dispatch and shop roles may write', () => {
    expect(vehicleRouter.VEHICLE_WRITE_ROLES).toContain('dispatch');
    expect(vehicleRouter.VEHICLE_WRITE_ROLES).toContain('shop_clerk');
  });

  test('isVehicleReadHttpMethod', () => {
    expect(vehicleRouter.isVehicleReadHttpMethod('GET')).toBe(true);
    expect(vehicleRouter.isVehicleReadHttpMethod('HEAD')).toBe(true);
    expect(vehicleRouter.isVehicleReadHttpMethod('OPTIONS')).toBe(true);
    expect(vehicleRouter.isVehicleReadHttpMethod('POST')).toBe(false);
    expect(vehicleRouter.isVehicleReadHttpMethod('PUT')).toBe(false);
    expect(vehicleRouter.isVehicleReadHttpMethod('DELETE')).toBe(false);
    expect(vehicleRouter.isVehicleReadHttpMethod('PATCH')).toBe(false);
  });
});
