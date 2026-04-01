const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  hasDriverCompensationUpdate,
  pickLatestEquipmentOwnerPercentage,
  resolveCompensationProfileEffectiveStartDate,
  mergeCompensationProfileWithFallback
} = require('./driver-compensation-profile-sync');

describe('hasDriverCompensationUpdate', () => {
  it('returns true when equipment owner percentage is provided on its own', () => {
    assert.strictEqual(hasDriverCompensationUpdate({ equipmentOwnerPercentage: 44 }), true);
    assert.strictEqual(hasDriverCompensationUpdate({ equipment_owner_percentage: 44 }), true);
  });

  it('returns true when a compensation field is explicitly set to zero', () => {
    assert.strictEqual(hasDriverCompensationUpdate({ payPercentage: 0 }), true);
    assert.strictEqual(hasDriverCompensationUpdate({ equipmentOwnerPercentage: 0 }), true);
  });

  it('returns false when no compensation fields are present', () => {
    assert.strictEqual(hasDriverCompensationUpdate({ firstName: 'Rishawn' }), false);
  });
});

describe('pickLatestEquipmentOwnerPercentage', () => {
  it('returns the first non-null EO percentage from newest-first rows', () => {
    const eoPct = pickLatestEquipmentOwnerPercentage([
      { equipment_owner_percentage: null },
      { equipment_owner_percentage: '44.00' },
      { equipment_owner_percentage: '20.00' }
    ]);

    assert.strictEqual(eoPct, 44);
  });

  it('returns null when no rows have an EO percentage', () => {
    assert.strictEqual(
      pickLatestEquipmentOwnerPercentage([
        { equipment_owner_percentage: null },
        { equipment_owner_percentage: '' }
      ]),
      null
    );
  });
});

describe('resolveCompensationProfileEffectiveStartDate', () => {
  it('uses hire date when creating the initial compensation profile', () => {
    const effectiveStart = resolveCompensationProfileEffectiveStartDate(
      'create',
      { hire_date: '2026-03-29T00:00:00.000Z' },
      '2026-04-01'
    );

    assert.strictEqual(effectiveStart, '2026-03-29');
  });

  it('uses the current date for profile updates', () => {
    const effectiveStart = resolveCompensationProfileEffectiveStartDate(
      'update',
      { hire_date: '2026-03-29T00:00:00.000Z' },
      '2026-04-01'
    );

    assert.strictEqual(effectiveStart, '2026-04-01');
  });
});

describe('mergeCompensationProfileWithFallback', () => {
  it('backfills missing EO percentage from the latest known profile', () => {
    const merged = mergeCompensationProfileWithFallback(
      {
        id: 'period-profile',
        pay_model: 'percentage',
        percentage_rate: 44,
        equipment_owner_percentage: null
      },
      {
        id: 'latest-profile',
        pay_model: 'percentage',
        percentage_rate: 44,
        equipment_owner_percentage: 44
      },
      { pay_percentage: 44 }
    );

    assert.strictEqual(merged.equipment_owner_percentage, 44);
    assert.strictEqual(merged.percentage_rate, 44);
  });

  it('backfills missing percentage rate from the driver row for percentage pay', () => {
    const merged = mergeCompensationProfileWithFallback(
      {
        id: 'period-profile',
        pay_model: 'percentage',
        percentage_rate: 0,
        equipment_owner_percentage: null
      },
      {
        id: 'latest-profile',
        pay_model: 'percentage',
        percentage_rate: null,
        equipment_owner_percentage: 44
      },
      { pay_percentage: 44 }
    );

    assert.strictEqual(merged.percentage_rate, 44);
    assert.strictEqual(merged.equipment_owner_percentage, 44);
  });
});
