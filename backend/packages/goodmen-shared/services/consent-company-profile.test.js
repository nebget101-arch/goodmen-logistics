'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { composeEntityAddress, buildConsentCompany } = require('./consent-company-profile');

describe('composeEntityAddress (FN-1832 consent header)', () => {
  it('composes full address as "line1, line2, city, state zip"', () => {
    const oe = {
      address_line1: '123 Main St',
      address_line2: 'Suite 400',
      city: 'Dallas',
      state: 'TX',
      zip_code: '75201',
    };
    assert.equal(composeEntityAddress(oe), '123 Main St, Suite 400, Dallas, TX 75201');
  });

  it('omits address_line2 cleanly when absent', () => {
    const oe = { address_line1: '123 Main St', city: 'Dallas', state: 'TX', zip_code: '75201' };
    assert.equal(composeEntityAddress(oe), '123 Main St, Dallas, TX 75201');
  });

  it('space-joins state and zip without a stray comma', () => {
    assert.equal(composeEntityAddress({ state: 'TX', zip_code: '75201' }), 'TX 75201');
  });

  it('drops missing pieces without leaving empty separators', () => {
    assert.equal(composeEntityAddress({ address_line1: '123 Main St', city: 'Dallas' }), '123 Main St, Dallas');
  });

  it('returns an empty string when no profile exists', () => {
    assert.equal(composeEntityAddress(null), '');
    assert.equal(composeEntityAddress(undefined), '');
    assert.equal(composeEntityAddress({}), '');
  });
});

describe('buildConsentCompany (FN-1832 consent header)', () => {
  it('returns null when no operating entity exists (PDF falls back to default)', () => {
    assert.equal(buildConsentCompany(null), null);
    assert.equal(buildConsentCompany(undefined), null);
  });

  it('maps name/address/phone/email and preserves logo fields (FN-1739)', () => {
    const oe = {
      name: 'Acme Carriers LLC',
      legal_name: 'Acme Carriers Limited Liability Company',
      address_line1: '123 Main St',
      city: 'Dallas',
      state: 'TX',
      zip_code: '75201',
      phone: '555-0100',
      email: 'ops@acme.test',
      logo_storage_key: 'tenants/abc/logo.png',
      logo_mime_type: 'image/png',
    };
    assert.deepEqual(buildConsentCompany(oe), {
      name: 'Acme Carriers LLC',
      address: '123 Main St, Dallas, TX 75201',
      phone: '555-0100',
      email: 'ops@acme.test',
      logo_storage_key: 'tenants/abc/logo.png',
      logo_mime_type: 'image/png',
    });
  });

  it('falls back to legal_name when name is missing and defaults optional fields', () => {
    const company = buildConsentCompany({ legal_name: 'Acme Carriers Limited' });
    assert.equal(company.name, 'Acme Carriers Limited');
    assert.equal(company.address, '');
    assert.equal(company.phone, '');
    assert.equal(company.email, '');
    assert.equal(company.logo_storage_key, null);
    assert.equal(company.logo_mime_type, null);
  });
});
