const { describe, it } = require('node:test');
const assert = require('node:assert');
const { hasDriverCompensationUpdate } = require('./driver-compensation-profile-sync');

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
