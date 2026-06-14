'use strict';

/**
 * FN-1797: unit tests for the e-signature pure logic + signed-PDF assembly.
 *
 * Covers the DB-free helpers in signature-service (token expiry, field-value
 * encode/decode, signer-link building, placement merge, row mappers) and the
 * pdf.service overlay (real source PDF + missing-source fallback). No DB / no
 * network / no R2 / no messaging.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { PDFDocument } = require('pdf-lib');

const svc = require('../services/signature-service');
const { overlaySignedAgreementPdf } = require('../services/pdf.service');

describe('isExpired', () => {
  it('treats null expiry as never-expiring', () => {
    assert.strictEqual(svc.isExpired(null), false);
  });
  it('is true for a past timestamp', () => {
    assert.strictEqual(svc.isExpired(new Date(Date.now() - 1000)), true);
  });
  it('is false for a future timestamp', () => {
    assert.strictEqual(svc.isExpired(new Date(Date.now() + 60_000)), false);
  });
  it('parses ISO strings', () => {
    assert.strictEqual(svc.isExpired('2000-01-01T00:00:00.000Z'), true);
  });
  it('treats an unparseable value as non-expiring', () => {
    assert.strictEqual(svc.isExpired('not-a-date'), false);
  });
});

describe('computeExpiry', () => {
  it('adds the given number of days', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const out = svc.computeExpiry(5, from);
    assert.strictEqual(out.toISOString(), '2026-01-06T00:00:00.000Z');
  });
  it('falls back to the default for non-positive input', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const out = svc.computeExpiry(0, from);
    const expected = new Date(from);
    expected.setDate(expected.getDate() + svc.DEFAULT_EXPIRY_DAYS);
    assert.strictEqual(out.toISOString(), expected.toISOString());
  });
});

describe('encodeFieldValue / decodeFieldValue', () => {
  it('passes scalars through as strings', () => {
    assert.strictEqual(svc.encodeFieldValue('hello'), 'hello');
    assert.strictEqual(svc.encodeFieldValue(42), '42');
    assert.strictEqual(svc.encodeFieldValue(true), 'true');
  });
  it('maps null/undefined/empty to null', () => {
    assert.strictEqual(svc.encodeFieldValue(null), null);
    assert.strictEqual(svc.encodeFieldValue(undefined), null);
    assert.strictEqual(svc.encodeFieldValue(''), null);
  });
  it('JSON-encodes structured values and round-trips them', () => {
    const obj = { a: 1, b: ['x', 'y'] };
    const encoded = svc.encodeFieldValue(obj);
    assert.strictEqual(typeof encoded, 'string');
    assert.deepStrictEqual(svc.decodeFieldValue(encoded), obj);
  });
  it('decodes plain strings unchanged', () => {
    assert.strictEqual(svc.decodeFieldValue('Jane Doe'), 'Jane Doe');
    assert.strictEqual(svc.decodeFieldValue(null), null);
  });
  it('returns the raw string when JSON parse fails', () => {
    assert.strictEqual(svc.decodeFieldValue('{not json'), '{not json');
  });
});

describe('buildSignerLink', () => {
  it('joins base + token and strips a trailing slash', () => {
    assert.strictEqual(
      svc.buildSignerLink('abc123', 'https://app.example.com/'),
      'https://app.example.com/agreements/sign/abc123'
    );
  });
  it('uses the provided base without a trailing slash', () => {
    assert.strictEqual(
      svc.buildSignerLink('tok', 'https://app.example.com'),
      'https://app.example.com/agreements/sign/tok'
    );
  });
});

describe('normalizeStatus / normalizeRole', () => {
  it('passes valid enums through', () => {
    assert.strictEqual(svc.normalizeStatus('signed'), 'signed');
    assert.strictEqual(svc.normalizeRole('internal'), 'internal');
  });
  it('falls back on unknown values', () => {
    assert.strictEqual(svc.normalizeStatus('bogus'), 'draft');
    assert.strictEqual(svc.normalizeRole('bogus'), 'signer');
    assert.strictEqual(svc.normalizeRole('bogus', 'internal'), 'internal');
  });
});

describe('buildPlacements', () => {
  const templateFields = [
    { fieldKey: 'lessee_name', label: 'Lessee Name', fieldType: 'text', page: 1, bbox: [10, 20, 100, 14], role: 'internal' },
    { fieldKey: 'driver_phone', label: 'Driver Phone', fieldType: 'text', page: 1, bbox: [10, 60, 100, 14], role: 'signer' },
    { fieldKey: 'signature', label: 'Signature', fieldType: 'signature', page: 2, bbox: [10, 400, 200, 40], role: 'signer' }
  ];

  it('maps internal + signer field values onto placements', () => {
    const placements = svc.buildPlacements(
      templateFields,
      { lessee_name: 'Acme LLC', driver_phone: '555-1212' },
      { signerName: 'Jane Doe', signatureValue: 'Jane Doe' }
    );
    const byKey = Object.fromEntries(placements.map((p) => [p.fieldKey, p]));
    assert.strictEqual(byKey.lessee_name.value, 'Acme LLC');
    assert.strictEqual(byKey.driver_phone.value, '555-1212');
  });

  it('uses the signature value for signature/initials fields', () => {
    const placements = svc.buildPlacements(templateFields, {}, { signerName: 'Jane Doe', signatureValue: 'J. Doe' });
    const sig = placements.find((p) => p.fieldType === 'signature');
    assert.strictEqual(sig.value, 'J. Doe');
    assert.deepStrictEqual(sig.bbox, [10, 400, 200, 40]);
    assert.strictEqual(sig.page, 2);
  });

  it('stringifies structured values', () => {
    const placements = svc.buildPlacements(
      [{ fieldKey: 'meta', label: 'Meta', fieldType: 'text', page: 1, bbox: null, role: 'signer' }],
      { meta: { a: 1 } },
      {}
    );
    assert.strictEqual(placements[0].value, JSON.stringify({ a: 1 }));
  });
});

describe('toSignerField', () => {
  it('marks internal fields read-only and signer fields editable', () => {
    const internal = svc.toSignerField(
      { fieldKey: 'lessee_name', label: 'Lessee', fieldType: 'text', page: 1, role: 'internal' },
      { lessee_name: 'Acme LLC' }
    );
    assert.strictEqual(internal.readOnly, true);
    assert.strictEqual(internal.value, 'Acme LLC');

    const signer = svc.toSignerField(
      { fieldKey: 'driver_phone', label: 'Phone', fieldType: 'text', page: 1, role: 'signer' },
      {}
    );
    assert.strictEqual(signer.readOnly, false);
    assert.strictEqual(signer.value, null);
  });
});

describe('mapRequestRow / mapFieldRow', () => {
  it('maps a request row to camelCase DTO', () => {
    const dto = svc.mapRequestRow({
      id: 'r1', tenant_id: 't1', operating_entity_id: null, template_id: 'tpl1',
      document_type: 'generic', status: 'sent', signer_name: 'Jane', signer_email: 'j@x.com',
      signer_phone: null, signer_role: 'Lessee', signed_pdf_storage_key: null,
      sent_at: 'now', viewed_at: null, signed_at: null, expires_at: 'later',
      created_by: 'u1', created_at: 'c', updated_at: 'u'
    });
    assert.strictEqual(dto.tenantId, 't1');
    assert.strictEqual(dto.templateId, 'tpl1');
    assert.strictEqual(dto.signerEmail, 'j@x.com');
    assert.strictEqual(dto.status, 'sent');
  });

  it('decodes the value when mapping a field row', () => {
    const dto = svc.mapFieldRow({ id: 'f1', request_id: 'r1', field_key: 'k', role: 'signer', value: '{"a":1}', filled_by: null, filled_at: null });
    assert.deepStrictEqual(dto.value, { a: 1 });
    assert.strictEqual(dto.role, 'signer');
  });
});

describe('overlaySignedAgreementPdf', () => {
  async function makeSourcePdf() {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    return Buffer.from(await doc.save());
  }

  it('overlays onto a real source PDF and returns a larger PDF buffer', async () => {
    const source = await makeSourcePdf();
    const signed = await overlaySignedAgreementPdf({
      sourceBytes: source,
      placements: [
        { fieldKey: 'lessee_name', label: 'Lessee', fieldType: 'text', page: 1, bbox: [72, 120, 200, 16], value: 'Acme LLC' },
        { fieldKey: 'signature', label: 'Signature', fieldType: 'signature', page: 2, bbox: [72, 400, 240, 40], value: '' }
      ],
      signature: { signerName: 'Jane Doe', signatureValue: 'Jane Doe', ipAddress: '1.2.3.4', userAgent: 'jest', consentText: 'I agree.' }
    });
    assert.ok(Buffer.isBuffer(signed));
    assert.strictEqual(signed.subarray(0, 5).toString('utf8'), '%PDF-');
    // Source had 2 pages; signed appends a certificate page → strictly larger.
    const reloaded = await PDFDocument.load(signed);
    assert.strictEqual(reloaded.getPageCount(), 3);
  });

  it('still produces a certificate PDF when the source is missing/unparseable', async () => {
    const signed = await overlaySignedAgreementPdf({
      sourceBytes: null,
      placements: [{ fieldKey: 'driver_phone', label: 'Phone', fieldType: 'text', page: 1, bbox: null, value: '555-1212' }],
      signature: { signerName: 'Jane Doe', signatureValue: 'Jane Doe' }
    });
    assert.ok(Buffer.isBuffer(signed));
    assert.strictEqual(signed.subarray(0, 5).toString('utf8'), '%PDF-');
    const reloaded = await PDFDocument.load(signed);
    assert.strictEqual(reloaded.getPageCount(), 1);
  });

  it('does not throw on garbage source bytes', async () => {
    const signed = await overlaySignedAgreementPdf({
      sourceBytes: Buffer.from('not a pdf'),
      placements: [],
      signature: { signerName: 'X', signatureValue: 'X' }
    });
    assert.strictEqual(signed.subarray(0, 5).toString('utf8'), '%PDF-');
  });
});
