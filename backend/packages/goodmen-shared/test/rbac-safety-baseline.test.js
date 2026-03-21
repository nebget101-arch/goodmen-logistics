'use strict';

/**
 * Safety RBAC baseline (FN-132): safety_manager / safety roles must resolve permission codes
 * even when role_permissions rows or user_roles links are missing.
 *
 * Run: cd backend/packages/goodmen-shared && npx jest test/rbac-safety-baseline.test.js
 */

const {
  mergeSafetyBaselineIfApplicable,
  mergeSafetyFleetUnitBaselineIfApplicable,
  SAFETY_ROLE_CODES,
  SAFETY_DEFAULT_PERMISSION_CODES,
  SAFETY_FLEET_UNIT_BASELINE_CODES,
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

describe('mergeSafetyFleetUnitBaselineIfApplicable', () => {
  test('adds vehicles.create/edit and documents for safety_manager', () => {
    const set = new Set(['vehicles.view']);
    mergeSafetyFleetUnitBaselineIfApplicable(['safety_manager'], set);
    expect(set.has('vehicles.create')).toBe(true);
    expect(set.has('vehicles.edit')).toBe(true);
    expect(set.has('trailers.create')).toBe(true);
    expect(set.has('documents.upload')).toBe(true);
  });

  test('no-op for dispatcher', () => {
    const set = new Set(['vehicles.view']);
    mergeSafetyFleetUnitBaselineIfApplicable(['dispatcher'], set);
    expect(set.has('vehicles.create')).toBe(false);
  });

  test('baseline list is non-empty', () => {
    expect(SAFETY_FLEET_UNIT_BASELINE_CODES.length).toBeGreaterThan(0);
    expect(SAFETY_FLEET_UNIT_BASELINE_CODES).toContain('vehicles.edit');
  });
});
