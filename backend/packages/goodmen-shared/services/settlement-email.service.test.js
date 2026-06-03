const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  buildSettlementEmailContent,
  resolveSettlementEmailRecipients,
  resolveSettlementInternalCc
} = require('./settlement-email.service');

describe('settlement-email.service', () => {
  it('resolves driver settlement recipients using driver and equipment owner emails', () => {
    const recipients = resolveSettlementEmailRecipients(
      {
        settlement: { settlement_type: 'driver' },
        driver: { email: 'driver@example.com' },
        equipmentOwner: { email: 'owner@example.com' }
      },
      {
        to_driver: true,
        to_additional_payee: true
      }
    );

    assert.deepEqual(recipients, [
      { email: 'driver@example.com', role: 'driver' },
      { email: 'owner@example.com', role: 'equipment_owner' }
    ]);
  });

  it('resolves equipment owner settlement recipients using UI checkbox semantics', () => {
    const recipients = resolveSettlementEmailRecipients(
      {
        settlement: { settlement_type: 'equipment_owner' },
        driver: { email: 'driver@example.com' },
        equipmentOwner: { email: 'owner@example.com' },
        primaryPayee: { email: 'owner@example.com' }
      },
      {
        to_driver: true,
        to_additional_payee: true
      }
    );

    assert.deepEqual(recipients, [
      { email: 'owner@example.com', role: 'equipment_owner_payee' },
      { email: 'driver@example.com', role: 'driver_reference' }
    ]);
  });

  it('deduplicates recipients when the same email appears twice', () => {
    const recipients = resolveSettlementEmailRecipients(
      {
        settlement: { settlement_type: 'equipment_owner' },
        driver: { email: 'same@example.com' },
        equipmentOwner: { email: 'same@example.com' }
      },
      {
        to_driver: true,
        to_additional_payee: true
      }
    );

    assert.deepEqual(recipients, [
      { email: 'same@example.com', role: 'equipment_owner_payee' }
    ]);
  });

  it('parses optional internal cc addresses only when requested', () => {
    const prior = process.env.SETTLEMENT_EMAIL_INTERNAL_CC;
    process.env.SETTLEMENT_EMAIL_INTERNAL_CC = 'ops@example.com, accounting@example.com';

    try {
      assert.deepEqual(resolveSettlementInternalCc({ cc_internal: true }), [
        'ops@example.com',
        'accounting@example.com'
      ]);
      assert.deepEqual(resolveSettlementInternalCc({ cc_internal: false }), []);
    } finally {
      if (prior === undefined) {
        delete process.env.SETTLEMENT_EMAIL_INTERNAL_CC;
      } else {
        process.env.SETTLEMENT_EMAIL_INTERNAL_CC = prior;
      }
    }
  });

  it('builds settlement email content with settlement details', () => {
    const content = buildSettlementEmailContent({
      settlement: {
        settlement_type: 'driver',
        settlement_number: 'STL-123',
        date: '2026-04-01',
        net_pay_driver: '1410.08'
      },
      period: {
        period_start: '2026-03-01',
        period_end: '2026-03-07'
      },
      driver: {
        first_name: 'Rishawn',
        last_name: 'Williams'
      },
      primaryPayee: {
        name: 'Rishawn Williams'
      },
      loadItems: [{ id: 'load-1' }, { id: 'load-2' }]
    });

    assert.equal(content.subject, 'Driver Settlement STL-123');
    assert.match(content.text, /Net Pay: \$1410\.08/);
    assert.match(content.html, /Your settlement report is attached as a PDF\./);
  });
});
