const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { resolveEligibleLoadDate } = require('./settlement-load-dates');

describe('settlement-load-dates', () => {
  it('prefers pickup dates for pickup basis', () => {
    const value = resolveEligibleLoadDate('pickup', {
      pickupDate: '2026-03-31',
      deliveryDate: '2026-04-01',
      completedDate: '2026-04-02',
      createdAt: '2026-03-30T12:00:00.000Z'
    });

    assert.equal(value, '2026-03-31');
  });

  it('falls back to delivery or completed dates when pickup is missing', () => {
    const value = resolveEligibleLoadDate('pickup', {
      pickupDate: null,
      deliveryDate: '2026-04-01',
      completedDate: '2026-04-02',
      createdAt: '2026-03-30T12:00:00.000Z'
    });

    assert.equal(value, '2026-04-01');
  });

  it('uses completed or created timestamps as final fallback', () => {
    const completedFallback = resolveEligibleLoadDate('pickup', {
      pickupDate: null,
      deliveryDate: null,
      completedDate: '2026-04-02',
      createdAt: '2026-03-30T12:00:00.000Z'
    });
    const createdFallback = resolveEligibleLoadDate('pickup', {
      pickupDate: null,
      deliveryDate: null,
      completedDate: null,
      createdAt: '2026-03-30T12:00:00.000Z'
    });

    assert.equal(completedFallback, '2026-04-02');
    assert.equal(createdFallback, '2026-03-30T12:00:00.000Z');
  });
});
