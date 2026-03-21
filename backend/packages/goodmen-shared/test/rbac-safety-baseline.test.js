'use strict';

/**
 * Safety RBAC baseline (FN-132): safety_manager / safety roles must resolve permission codes
 * even when role_permissions rows or user_roles links are missing.
 *
 * Run: cd backend/packages/goodmen-shared && npx jest test/rbac-safety-baseline.test.js
 */

const {
  mergeSafetyBaselineIfApplicable,
  stripFleetVehicleWritesForSafetyRoles,
  SAFETY_ROLE_CODES,
  SAFETY_DEFAULT_PERMISSION_CODES,
  SAFETY_STRIP_FLEET_VEHICLE_WRITE_CODES,
} = require('../services/rbac-service');

describe('mergeSafetyBaselineIfApplicable', () => {
  test('adds all default safety codes for safety_manager', () => {
    const set = new Set();
    mergeSafetyBaselineIfApplicable(['safety_manager'], set);
    SAFETY_DEFAULT_PERMISSION_CODES.forEach((code) => {
      expect(set.has(code)).toBe(true);
    });
    expect(set.size).toBe(SAFETY_DEFAULT_PERMISSION_CODES.length);
  });

  test('adds baseline for legacy safety code', () => {
    const set = new Set();
    mergeSafetyBaselineIfApplicable(['safety'], set);
    expect(set.has('safety.incidents.view')).toBe(true);
    expect(set.has('safety.reports.view')).toBe(true);
  });

  test('merges with existing permissions without removing them', () => {
    const set = new Set(['users.view']);
    mergeSafetyBaselineIfApplicable(['safety_manager'], set);
    expect(set.has('users.view')).toBe(true);
    expect(set.has('safety.claims.view')).toBe(true);
  });

  test('no-op for dispatcher', () => {
    const set = new Set();
    mergeSafetyBaselineIfApplicable(['dispatcher'], set);
    expect(set.size).toBe(0);
  });

  test('no-op for empty role list', () => {
    const set = new Set();
    mergeSafetyBaselineIfApplicable([], set);
    expect(set.size).toBe(0);
  });
});

describe('SAFETY_ROLE_CODES', () => {
  test('includes safety_manager and safety', () => {
    expect(SAFETY_ROLE_CODES.has('safety_manager')).toBe(true);
    expect(SAFETY_ROLE_CODES.has('safety')).toBe(true);
  });
});

describe('stripFleetVehicleWritesForSafetyRoles (FN-133)', () => {
  test('removes vehicles.edit and trailers.edit for safety_manager', () => {
    const set = new Set(['vehicles.view', 'vehicles.edit', 'trailers.view', 'trailers.edit']);
    stripFleetVehicleWritesForSafetyRoles(['safety_manager'], set);
    expect(set.has('vehicles.view')).toBe(true);
    expect(set.has('trailers.view')).toBe(true);
    expect(set.has('vehicles.edit')).toBe(false);
    expect(set.has('trailers.edit')).toBe(false);
  });

  test('no-op for dispatcher', () => {
    const set = new Set(['vehicles.edit']);
    stripFleetVehicleWritesForSafetyRoles(['dispatcher'], set);
    expect(set.has('vehicles.edit')).toBe(true);
  });

  test('strip list includes create and delete', () => {
    expect(SAFETY_STRIP_FLEET_VEHICLE_WRITE_CODES).toContain('vehicles.create');
    expect(SAFETY_STRIP_FLEET_VEHICLE_WRITE_CODES).toContain('vehicles.delete');
  });
});
