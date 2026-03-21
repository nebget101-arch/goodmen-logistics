'use strict';

/**
 * Safety roles may mutate fleet units (trucks/trailers) for assignments and documentation.
 * Run: cd backend/packages/goodmen-shared && npx jest test/vehicles-role-gate.test.js
 */

const vehicleRouter = require('../routes/vehicles');

describe('vehicles router role gate', () => {
  test('safety roles may read and write', () => {
    expect(vehicleRouter.VEHICLE_READ_ROLES).toContain('safety');
    expect(vehicleRouter.VEHICLE_READ_ROLES).toContain('safety_manager');
    expect(vehicleRouter.VEHICLE_WRITE_ROLES).toContain('safety');
    expect(vehicleRouter.VEHICLE_WRITE_ROLES).toContain('safety_manager');
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
