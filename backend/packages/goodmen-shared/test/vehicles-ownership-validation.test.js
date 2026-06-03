'use strict';

/**
 * FN-1386: validateOwnership unit tests.
 *
 * Run: cd backend/packages/goodmen-shared && npx jest test/vehicles-ownership-validation.test.js
 */

const vehicleRouter = require('../routes/vehicles');

describe('vehicles router — ownership validation', () => {
  test('OWNERSHIP_TYPES exposes the enum values', () => {
    expect(vehicleRouter.OWNERSHIP_TYPES).toEqual(['company', 'oo', 'leased']);
  });

  test('returns null when ownership_type is absent (partial PUT)', () => {
    expect(vehicleRouter.validateOwnership({ make: 'Volvo' })).toBeNull();
    expect(vehicleRouter.validateOwnership({ ownership_type: undefined })).toBeNull();
    expect(vehicleRouter.validateOwnership({ ownership_type: '' })).toBeNull();
    expect(vehicleRouter.validateOwnership({ ownership_type: null })).toBeNull();
  });

  test('rejects unknown ownership_type values', () => {
    const err = vehicleRouter.validateOwnership({ ownership_type: 'rental' });
    expect(err).toMatch(/Invalid ownership_type 'rental'/);
  });

  test('company ownership requires no extra fields', () => {
    expect(vehicleRouter.validateOwnership({ ownership_type: 'company' })).toBeNull();
  });

  test('oo ownership requires equipment_owner_name', () => {
    expect(vehicleRouter.validateOwnership({ ownership_type: 'oo' }))
      .toMatch(/equipment_owner_name is required/);
    expect(vehicleRouter.validateOwnership({ ownership_type: 'oo', equipment_owner_name: '' }))
      .toMatch(/equipment_owner_name is required/);
    expect(vehicleRouter.validateOwnership({ ownership_type: 'oo', equipment_owner_name: '   ' }))
      .toMatch(/equipment_owner_name is required/);
    expect(vehicleRouter.validateOwnership({ ownership_type: 'oo', equipment_owner_name: 'Acme Trucking' }))
      .toBeNull();
  });

  test('leased ownership accepts top-level lessor_name (truck path)', () => {
    expect(vehicleRouter.validateOwnership({ ownership_type: 'leased', lessor_name: 'Penske' }))
      .toBeNull();
  });

  test('leased ownership accepts trailer_details.lessor_name (trailer path)', () => {
    expect(vehicleRouter.validateOwnership({
      ownership_type: 'leased',
      trailer_details: { lessor_name: 'Ryder' }
    })).toBeNull();
  });

  test('leased ownership without any lessor field is rejected', () => {
    expect(vehicleRouter.validateOwnership({ ownership_type: 'leased' }))
      .toMatch(/lessor_name/);
    expect(vehicleRouter.validateOwnership({
      ownership_type: 'leased',
      lessor_name: '   ',
      trailer_details: { lessor_name: '' }
    })).toMatch(/lessor_name/);
  });

  test('handles non-object inputs gracefully', () => {
    expect(vehicleRouter.validateOwnership(null)).toBeNull();
    expect(vehicleRouter.validateOwnership(undefined)).toBeNull();
    expect(vehicleRouter.validateOwnership('not-an-object')).toBeNull();
  });
});
