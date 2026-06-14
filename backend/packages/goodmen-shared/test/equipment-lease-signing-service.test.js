'use strict';

/**
 * FN-1800: unit tests for the equipment-lease signing adapter pure logic +
 * delegation. Covers the DB-free helpers (subject normalization, row mapping,
 * input validation, request merge/backfill) plus create/list orchestration
 * driven by an injected fake knex + fake signature-service — no real DB / R2 /
 * messaging. Confirms the adapter delegates signing to the engine rather than
 * re-implementing it.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const svc = require('../services/equipment-lease-signing-service');

describe('normalizeSubjectType', () => {
  it('passes valid subjects through, lowercased/trimmed', () => {
    assert.strictEqual(svc.normalizeSubjectType('vehicle'), 'vehicle');
    assert.strictEqual(svc.normalizeSubjectType(' Equipment_Owner '), 'equipment_owner');
  });
  it('returns null for unknown / empty values', () => {
    assert.strictEqual(svc.normalizeSubjectType('driver'), null);
    assert.strictEqual(svc.normalizeSubjectType(''), null);
    assert.strictEqual(svc.normalizeSubjectType(null), null);
  });
});

describe('mapLinkRow', () => {
  it('maps a linkage row to a camelCase DTO', () => {
    const dto = svc.mapLinkRow({
      id: 'l1', tenant_id: 't1', operating_entity_id: null, subject_type: 'vehicle',
      subject_id: 'v1', signature_request_id: 'r1', document_type: 'lease_agreement',
      signed_pdf_storage_key: null, created_by: 'u1', created_at: 'c', updated_at: 'u'
    });
    assert.strictEqual(dto.tenantId, 't1');
    assert.strictEqual(dto.subjectType, 'vehicle');
    assert.strictEqual(dto.signatureRequestId, 'r1');
    assert.strictEqual(dto.documentType, 'lease_agreement');
  });
  it('returns null for a missing row', () => {
    assert.strictEqual(svc.mapLinkRow(null), null);
  });
});

describe('validateCreateInput', () => {
  const ok = { subjectType: 'vehicle', subjectId: 'v1', templateId: 'tpl1', signer: { email: 'a@b.com' } };

  it('returns normalized values for valid input', () => {
    const out = svc.validateCreateInput(ok);
    assert.deepStrictEqual(out, { subjectType: 'vehicle', subjectId: 'v1', templateId: 'tpl1' });
  });
  it('accepts a phone-only signer', () => {
    const out = svc.validateCreateInput({ ...ok, signer: { phone: '555-1212' } });
    assert.strictEqual(out.subjectType, 'vehicle');
  });
  it('rejects an unknown subjectType', () => {
    assert.throws(() => svc.validateCreateInput({ ...ok, subjectType: 'driver' }), /subjectType must be one of/);
  });
  it('rejects a missing subjectId', () => {
    assert.throws(() => svc.validateCreateInput({ ...ok, subjectId: '  ' }), /subjectId is required/);
  });
  it('rejects a missing templateId', () => {
    assert.throws(() => svc.validateCreateInput({ ...ok, templateId: null }), /templateId is required/);
  });
  it('rejects a signer with no email or phone', () => {
    const err = catchErr(() => svc.validateCreateInput({ ...ok, signer: {} }));
    assert.strictEqual(err.code, 'INVALID_SIGNER');
    assert.strictEqual(err.statusCode, 400);
  });
});

describe('mergeRequestIntoLink', () => {
  const link = svc.mapLinkRow({
    id: 'l1', tenant_id: 't1', subject_type: 'vehicle', subject_id: 'v1',
    signature_request_id: 'r1', document_type: 'lease_agreement', signed_pdf_storage_key: null,
    created_at: 'c', updated_at: 'u'
  });

  it('shapes the request status into the subject DTO', () => {
    const { dto } = svc.mergeRequestIntoLink(link, {
      id: 'r1', status: 'sent', signerName: 'Acme Leasing', sentAt: 's', signedPdfUrl: null
    });
    assert.strictEqual(dto.subjectId, 'v1');
    assert.strictEqual(dto.request.status, 'sent');
    assert.strictEqual(dto.request.signerName, 'Acme Leasing');
  });
  it('flags a backfill when the request is signed and the link has no key yet', () => {
    const { dto, backfillKey } = svc.mergeRequestIntoLink(link, {
      id: 'r1', status: 'signed', signedPdfStorageKey: 'agreements/signed/t1/r1.pdf', signedPdfUrl: 'https://x/r1.pdf'
    });
    assert.strictEqual(backfillKey, 'agreements/signed/t1/r1.pdf');
    assert.strictEqual(dto.request.signedPdfUrl, 'https://x/r1.pdf');
  });
  it('does not backfill when the link key already matches', () => {
    const linkWithKey = { ...link, signedPdfStorageKey: 'agreements/signed/t1/r1.pdf' };
    const { backfillKey } = svc.mergeRequestIntoLink(linkWithKey, {
      id: 'r1', status: 'signed', signedPdfStorageKey: 'agreements/signed/t1/r1.pdf'
    });
    assert.strictEqual(backfillKey, null);
  });
  it('tolerates a missing request (request load failed)', () => {
    const { dto, backfillKey } = svc.mergeRequestIntoLink(link, null);
    assert.strictEqual(dto.request, null);
    assert.strictEqual(backfillKey, null);
  });
});

describe('createEquipmentLeaseSigning', () => {
  it('delegates signing to the engine and records the linkage', async () => {
    const captured = {};
    const fakeSignatureService = {
      createSignatureRequest: async (args) => {
        captured.engineArgs = args;
        return { requestId: 'req1', signerLink: 'https://app/agreements/sign/tok', status: 'sent' };
      }
    };
    const fakeDb = makeFakeDb({
      insert: (row) => {
        captured.inserted = row;
        return [{ id: 'link1', ...row, created_at: 'c', updated_at: 'u' }];
      }
    });

    const result = await svc.createEquipmentLeaseSigning({
      tenantId: 't1',
      operatingEntityId: 'oe1',
      subjectType: 'equipment_owner',
      subjectId: 'eo1',
      templateId: 'tpl1',
      fieldValues: { lessee_name: 'Acme LLC' },
      signer: { name: 'Acme Leasing', email: 'lessor@acme.com' },
      createdBy: 'u1',
      db: fakeDb,
      signatureService: fakeSignatureService
    });

    // Delegated to the engine with the right template + tenant.
    assert.strictEqual(captured.engineArgs.templateId, 'tpl1');
    assert.strictEqual(captured.engineArgs.tenantId, 't1');
    assert.deepStrictEqual(captured.engineArgs.fieldValues, { lessee_name: 'Acme LLC' });
    // Linkage row points at the engine-created request.
    assert.strictEqual(captured.inserted.signature_request_id, 'req1');
    assert.strictEqual(captured.inserted.subject_type, 'equipment_owner');
    assert.strictEqual(captured.inserted.document_type, 'lease_agreement');
    // Result merges the engine result + linkage DTO.
    assert.strictEqual(result.requestId, 'req1');
    assert.strictEqual(result.signerLink, 'https://app/agreements/sign/tok');
    assert.strictEqual(result.link.id, 'link1');
    assert.strictEqual(result.link.subjectId, 'eo1');
  });

  it('rejects invalid input before touching the engine or DB', async () => {
    let engineCalled = false;
    const fakeSignatureService = { createSignatureRequest: async () => { engineCalled = true; return {}; } };
    const err = await catchAsync(() => svc.createEquipmentLeaseSigning({
      tenantId: 't1', subjectType: 'driver', subjectId: 'x', templateId: 'tpl1',
      signer: { email: 'a@b.com' }, db: makeFakeDb({}), signatureService: fakeSignatureService
    }));
    assert.strictEqual(err.code, 'INVALID_SUBJECT_TYPE');
    assert.strictEqual(engineCalled, false);
  });
});

describe('listEquipmentLeaseSignings', () => {
  it('enriches each linkage with live request status and backfills the signed key', async () => {
    const updates = [];
    const linkRows = [{
      id: 'link1', tenant_id: 't1', subject_type: 'vehicle', subject_id: 'v1',
      signature_request_id: 'req1', document_type: 'lease_agreement', signed_pdf_storage_key: null,
      created_at: 'c', updated_at: 'u'
    }];
    const fakeDb = makeFakeDb({
      where: (whereArgs) => ({
        orderBy: async () => linkRows,
        update: (vals) => {
          updates.push({ whereArgs, vals });
          return { catch: async () => undefined };
        }
      })
    });
    const fakeSignatureService = {
      getRequestById: async ({ id }) => ({
        id, status: 'signed', signerName: 'Acme Leasing',
        signedPdfStorageKey: 'agreements/signed/t1/req1.pdf', signedPdfUrl: 'https://x/req1.pdf'
      })
    };

    const out = await svc.listEquipmentLeaseSignings({
      tenantId: 't1', subjectType: 'vehicle', subjectId: 'v1',
      db: fakeDb, signatureService: fakeSignatureService
    });

    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].request.status, 'signed');
    assert.strictEqual(out[0].request.signedPdfUrl, 'https://x/req1.pdf');
    assert.strictEqual(out[0].signedPdfStorageKey, 'agreements/signed/t1/req1.pdf');
    // Backfill update was issued onto the linkage row.
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].vals.signed_pdf_storage_key, 'agreements/signed/t1/req1.pdf');
  });

  it('rejects a missing subjectId', async () => {
    const err = await catchAsync(() => svc.listEquipmentLeaseSignings({
      tenantId: 't1', subjectType: 'vehicle', subjectId: '', db: makeFakeDb({}), signatureService: {}
    }));
    assert.strictEqual(err.statusCode, 400);
  });
});

// ---------------------------------------------------------------------------
// Tiny test helpers
// ---------------------------------------------------------------------------

/**
 * A minimal chainable knex stand-in. `handlers` supplies the leaf behavior for
 * insert / where / update; everything returns a thenable/builder shaped enough
 * for the service's usage. `db.fn.now()` is supported.
 */
function makeFakeDb(handlers) {
  const fn = function fakeKnex(_table) {
    return {
      insert(row) {
        const rows = handlers.insert ? handlers.insert(row) : [{ id: 'x', ...row }];
        return { returning: async () => rows };
      },
      where(whereArgs) {
        // create() never calls where(); list() always supplies a where handler.
        if (handlers.where) return handlers.where(whereArgs);
        return { orderBy: async () => [], update: () => ({ catch: async () => undefined }) };
      }
    };
  };
  fn.fn = { now: () => 'NOW()' };
  return fn;
}

function catchErr(thunk) {
  try {
    thunk();
  } catch (err) {
    return err;
  }
  throw new Error('expected the function to throw');
}

async function catchAsync(thunk) {
  try {
    await thunk();
  } catch (err) {
    return err;
  }
  throw new Error('expected the async function to throw');
}
