'use strict';

/**
 * FN-1793: unit tests for the agreement-service pure logic — the hallucination
 * guard (validateDetectionResult / validateDetectedField), the PATCH sanitizer,
 * field-row building, and the AI-orchestration call shape. No DB / no network.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  validateDetectionResult,
  validateDetectedField,
  sanitizeFieldUpdate,
  sanitizeNewField,
  normalizeDeleteIds,
  fieldUpdateToRow,
  buildFieldRows,
  coerceBbox,
  validateBbox,
  validatePage,
  coerceConfidence,
  normalizeRole,
  normalizeDocumentType,
  isLowConfidence,
  callDetectFieldsAi,
  stubDetectionResult,
  LOW_CONFIDENCE_THRESHOLD,
  FIELD_TYPES
} = require('./agreement-service');

function field(overrides = {}) {
  return {
    key: 'lessee_name',
    label: 'Lessee Name',
    type: 'text',
    page: 1,
    bbox: [10, 20, 30, 40],
    suggestedRole: 'internal',
    suggestedValue: null,
    confidence: 0.82,
    ...overrides
  };
}

describe('coerceBbox', () => {
  it('returns a 4-number array unchanged', () => {
    assert.deepStrictEqual(coerceBbox([1, 2, 3, 4]), [1, 2, 3, 4]);
  });
  it('coerces numeric strings', () => {
    assert.deepStrictEqual(coerceBbox(['1', '2', '3', '4']), [1, 2, 3, 4]);
  });
  it('rejects wrong-length or non-numeric arrays', () => {
    assert.strictEqual(coerceBbox([1, 2, 3]), null);
    assert.strictEqual(coerceBbox([1, 2, 3, 'x']), null);
    assert.strictEqual(coerceBbox('nope'), null);
    assert.strictEqual(coerceBbox(null), null);
  });
});

describe('coerceConfidence', () => {
  it('passes through a valid [0,1] number', () => {
    assert.strictEqual(coerceConfidence(0.5), 0.5);
  });
  it('clamps out-of-range values', () => {
    assert.strictEqual(coerceConfidence(1.4), 1);
    assert.strictEqual(coerceConfidence(-3), 0);
  });
  it('returns null for absent/invalid', () => {
    assert.strictEqual(coerceConfidence(null), null);
    assert.strictEqual(coerceConfidence('abc'), null);
  });
});

describe('normalizeRole / normalizeDocumentType', () => {
  it('keeps valid roles, falls back otherwise', () => {
    assert.strictEqual(normalizeRole('signer'), 'signer');
    assert.strictEqual(normalizeRole('internal'), 'internal');
    assert.strictEqual(normalizeRole('garbage'), 'internal');
    assert.strictEqual(normalizeRole('garbage', 'signer'), 'signer');
  });
  it('normalizes unknown document types to generic', () => {
    assert.strictEqual(normalizeDocumentType('lease_agreement'), 'lease_agreement');
    assert.strictEqual(normalizeDocumentType('totally_made_up'), 'generic');
    assert.strictEqual(normalizeDocumentType(undefined), 'generic');
  });
});

describe('isLowConfidence', () => {
  it('flags values below the threshold', () => {
    assert.strictEqual(isLowConfidence(LOW_CONFIDENCE_THRESHOLD - 0.01), true);
    assert.strictEqual(isLowConfidence(LOW_CONFIDENCE_THRESHOLD), false);
    assert.strictEqual(isLowConfidence(0.99), false);
    assert.strictEqual(isLowConfidence(null), false);
  });
});

describe('validateDetectedField (hallucination guard)', () => {
  it('normalizes a valid field and defaults role to the AI suggestion', () => {
    const out = validateDetectedField(field(), { pageCount: 6 });
    assert.strictEqual(out.fieldKey, 'lessee_name');
    assert.strictEqual(out.label, 'Lessee Name');
    assert.strictEqual(out.fieldType, 'text');
    assert.strictEqual(out.role, 'internal');
    assert.strictEqual(out.suggestedRole, 'internal');
    assert.deepStrictEqual(out.bbox, [10, 20, 30, 40]);
    assert.strictEqual(out.confidence, 0.82);
    assert.strictEqual(out.lowConfidence, false);
  });

  it('drops a field with an unknown type', () => {
    assert.strictEqual(validateDetectedField(field({ type: 'barcode' }), { pageCount: 6 }), null);
  });

  it('drops a field whose page exceeds the document page count', () => {
    assert.strictEqual(validateDetectedField(field({ page: 9 }), { pageCount: 6 }), null);
  });

  it('clamps an invalid page up to 1', () => {
    const out = validateDetectedField(field({ page: 0 }), { pageCount: 6 });
    assert.strictEqual(out.page, 1);
  });

  it('coerces an out-of-range suggestedRole to internal', () => {
    const out = validateDetectedField(field({ suggestedRole: 'lawyer' }), { pageCount: 6 });
    assert.strictEqual(out.suggestedRole, 'internal');
    assert.strictEqual(out.role, 'internal');
  });

  it('falls back to key when label is missing', () => {
    const out = validateDetectedField(field({ label: '   ' }), { pageCount: 6 });
    assert.strictEqual(out.label, 'lessee_name');
  });

  it('nulls an unparseable bbox but keeps the field', () => {
    const out = validateDetectedField(field({ bbox: [1, 2] }), { pageCount: 6 });
    assert.strictEqual(out.bbox, null);
    assert.strictEqual(out.fieldKey, 'lessee_name');
  });

  it('marks a low-confidence field', () => {
    const out = validateDetectedField(field({ confidence: 0.2 }), { pageCount: 6 });
    assert.strictEqual(out.lowConfidence, true);
  });

  it('rejects non-objects', () => {
    assert.strictEqual(validateDetectedField(null), null);
    assert.strictEqual(validateDetectedField('x'), null);
  });
});

describe('validateDetectionResult', () => {
  it('keeps valid fields, drops invalid, and assigns ordered positions', () => {
    const out = validateDetectionResult({
      documentType: 'lease_agreement',
      pageCount: 6,
      fields: [
        field({ key: 'a' }),
        field({ key: 'b', type: 'qrcode' }), // dropped
        field({ key: 'c', type: 'signature', page: 6 })
      ]
    });
    assert.strictEqual(out.documentType, 'lease_agreement');
    assert.strictEqual(out.pageCount, 6);
    assert.strictEqual(out.fields.length, 2);
    assert.strictEqual(out.droppedCount, 1);
    assert.deepStrictEqual(out.fields.map((f) => f.sortOrder), [0, 1]);
    assert.deepStrictEqual(out.fields.map((f) => f.fieldKey), ['a', 'c']);
  });

  it('tolerates a missing/garbage payload', () => {
    const out = validateDetectionResult(null);
    assert.strictEqual(out.documentType, 'generic');
    assert.strictEqual(out.pageCount, null);
    assert.deepStrictEqual(out.fields, []);
    assert.strictEqual(out.droppedCount, 0);
  });

  it('treats a non-array fields value as empty', () => {
    const out = validateDetectionResult({ fields: 'nope' });
    assert.deepStrictEqual(out.fields, []);
  });

  it('validates the built-in stub result cleanly', () => {
    const out = validateDetectionResult(stubDetectionResult());
    assert.strictEqual(out.fields.length, 2);
    assert.strictEqual(out.droppedCount, 0);
    assert.ok(out.fields.every((f) => FIELD_TYPES.includes(f.fieldType)));
  });
});

describe('sanitizeFieldUpdate (PATCH guard)', () => {
  it('accepts a valid role flip', () => {
    assert.deepStrictEqual(sanitizeFieldUpdate({ role: 'signer' }), { role: 'signer' });
  });
  it('ignores an invalid role', () => {
    assert.strictEqual(sanitizeFieldUpdate({ role: 'notary' }), null);
  });
  it('trims and accepts a label', () => {
    assert.deepStrictEqual(sanitizeFieldUpdate({ label: '  New Label  ' }), { label: 'New Label' });
  });
  it('ignores immutable / AI-owned fields', () => {
    assert.strictEqual(
      sanitizeFieldUpdate({ fieldType: 'signature', confidence: 1, suggestedRole: 'signer', valueDefault: 'x' }),
      null
    );
  });
  it('combines multiple mutable fields', () => {
    assert.deepStrictEqual(
      sanitizeFieldUpdate({ role: 'signer', label: 'X', confidence: 0.1 }),
      { role: 'signer', label: 'X' }
    );
  });
  it('returns null for non-objects', () => {
    assert.strictEqual(sanitizeFieldUpdate(null), null);
    assert.strictEqual(sanitizeFieldUpdate('x'), null);
  });

  // FN-1808: page + bbox are now mutable (visual placement editor).
  it('accepts a valid page within the page count', () => {
    assert.deepStrictEqual(sanitizeFieldUpdate({ page: 3 }, { pageCount: 6 }), { page: 3 });
  });
  it('drops a page beyond the page count', () => {
    assert.strictEqual(sanitizeFieldUpdate({ page: 9 }, { pageCount: 6 }), null);
  });
  it('drops a non-integer / zero page', () => {
    assert.strictEqual(sanitizeFieldUpdate({ page: 0 }, { pageCount: 6 }), null);
    assert.strictEqual(sanitizeFieldUpdate({ page: 1.5 }, { pageCount: 6 }), null);
  });
  it('accepts a valid bbox edit', () => {
    assert.deepStrictEqual(
      sanitizeFieldUpdate({ bbox: [10, 20, 30, 40] }, { pageCount: 6 }),
      { bbox: [10, 20, 30, 40] }
    );
  });
  it('drops a malformed / negative bbox', () => {
    assert.strictEqual(sanitizeFieldUpdate({ bbox: [1, 2, 3] }, { pageCount: 6 }), null);
    assert.strictEqual(sanitizeFieldUpdate({ bbox: [-1, 0, 10, 10] }, { pageCount: 6 }), null);
    assert.strictEqual(sanitizeFieldUpdate({ bbox: [0, 0, 0, 10] }, { pageCount: 6 }), null);
  });
  it('clears the bbox when explicitly null', () => {
    assert.deepStrictEqual(sanitizeFieldUpdate({ bbox: null }), { bbox: null });
  });
  it('combines a role flip with a geometry move', () => {
    assert.deepStrictEqual(
      sanitizeFieldUpdate({ role: 'signer', page: 2, bbox: [5, 5, 100, 20] }, { pageCount: 4 }),
      { role: 'signer', page: 2, bbox: [5, 5, 100, 20] }
    );
  });
});

describe('validateBbox', () => {
  it('accepts a well-formed non-negative box', () => {
    assert.deepStrictEqual(validateBbox([0, 0, 10, 20]), [0, 0, 10, 20]);
    assert.deepStrictEqual(validateBbox(['1', '2', '3', '4']), [1, 2, 3, 4]);
  });
  it('rejects wrong shape, negative origin, or non-positive size', () => {
    assert.strictEqual(validateBbox([1, 2, 3]), null);
    assert.strictEqual(validateBbox([-1, 0, 10, 10]), null);
    assert.strictEqual(validateBbox([0, -1, 10, 10]), null);
    assert.strictEqual(validateBbox([0, 0, 0, 10]), null);
    assert.strictEqual(validateBbox([0, 0, 10, 0]), null);
    assert.strictEqual(validateBbox(null), null);
  });
});

describe('validatePage', () => {
  it('accepts a 1-based page within bounds', () => {
    assert.strictEqual(validatePage(1, 6), 1);
    assert.strictEqual(validatePage(6, 6), 6);
    assert.strictEqual(validatePage('3', 6), 3);
  });
  it('rejects out-of-range / non-integer pages', () => {
    assert.strictEqual(validatePage(0, 6), null);
    assert.strictEqual(validatePage(7, 6), null);
    assert.strictEqual(validatePage(2.5, 6), null);
    assert.strictEqual(validatePage('x', 6), null);
  });
  it('only enforces page >= 1 when pageCount is unknown/zero', () => {
    assert.strictEqual(validatePage(99, 0), 99);
    assert.strictEqual(validatePage(99, undefined), 99);
    assert.strictEqual(validatePage(0, 0), null);
  });
});

describe('sanitizeNewField (user-drawn box)', () => {
  it('accepts a fully specified manual field with confidence null', () => {
    const out = sanitizeNewField(
      { fieldType: 'signature', page: 2, bbox: [10, 20, 200, 40], label: 'Signature', role: 'signer' },
      { pageCount: 6 }
    );
    assert.strictEqual(out.fieldType, 'signature');
    assert.strictEqual(out.page, 2);
    assert.deepStrictEqual(out.bbox, [10, 20, 200, 40]);
    assert.strictEqual(out.label, 'Signature');
    assert.strictEqual(out.fieldKey, 'Signature');
    assert.strictEqual(out.role, 'signer');
    assert.strictEqual(out.suggestedRole, 'signer');
    assert.strictEqual(out.confidence, null);
    assert.strictEqual(out.lowConfidence, false);
  });
  it('accepts the legacy `type` alias and defaults role to internal', () => {
    const out = sanitizeNewField({ type: 'text', page: 1, bbox: [1, 1, 10, 10], label: 'X' });
    assert.strictEqual(out.fieldType, 'text');
    assert.strictEqual(out.role, 'internal');
  });
  it('requires a usable field type', () => {
    assert.strictEqual(sanitizeNewField({ fieldType: 'barcode', page: 1, bbox: [1, 1, 10, 10] }), null);
    assert.strictEqual(sanitizeNewField({ page: 1, bbox: [1, 1, 10, 10] }), null);
  });
  it('requires a valid in-bounds page', () => {
    assert.strictEqual(
      sanitizeNewField({ fieldType: 'text', page: 9, bbox: [1, 1, 10, 10] }, { pageCount: 6 }),
      null
    );
  });
  it('requires a valid bbox — a drawn box must have geometry', () => {
    assert.strictEqual(sanitizeNewField({ fieldType: 'text', page: 1, bbox: [1, 2] }), null);
    assert.strictEqual(sanitizeNewField({ fieldType: 'text', page: 1 }), null);
  });
  it('requires a key or label', () => {
    assert.strictEqual(sanitizeNewField({ fieldType: 'text', page: 1, bbox: [1, 1, 10, 10] }), null);
  });
  it('falls back to the key when no label is given', () => {
    const out = sanitizeNewField({ fieldType: 'text', page: 1, bbox: [1, 1, 10, 10], fieldKey: 'manual_1' });
    assert.strictEqual(out.fieldKey, 'manual_1');
    assert.strictEqual(out.label, 'manual_1');
  });
  it('returns null for non-objects', () => {
    assert.strictEqual(sanitizeNewField(null), null);
    assert.strictEqual(sanitizeNewField('x'), null);
  });
  it('produces a DTO that buildFieldRows persists with confidence null', () => {
    const out = sanitizeNewField({ fieldType: 'text', page: 1, bbox: [1, 1, 10, 10], label: 'X' });
    const [row] = buildFieldRows('tpl-9', [{ ...out, sortOrder: 5 }]);
    assert.strictEqual(row.template_id, 'tpl-9');
    assert.strictEqual(row.sort_order, 5);
    assert.strictEqual(row.field_type, 'text');
    assert.strictEqual(row.bbox, JSON.stringify([1, 1, 10, 10]));
    assert.strictEqual(row.confidence, null);
  });
});

describe('normalizeDeleteIds', () => {
  it('accepts bare ids and { id } objects, dropping empties', () => {
    assert.deepStrictEqual(
      normalizeDeleteIds(['a', { id: 'b' }, null, { id: '' }, '', 'c']),
      ['a', 'b', 'c']
    );
  });
  it('returns an empty array for non-arrays', () => {
    assert.deepStrictEqual(normalizeDeleteIds(undefined), []);
    assert.deepStrictEqual(normalizeDeleteIds('nope'), []);
  });
});

describe('fieldUpdateToRow', () => {
  it('stringifies a bbox array for the jsonb column', () => {
    assert.deepStrictEqual(fieldUpdateToRow({ role: 'signer', bbox: [1, 2, 3, 4] }), {
      role: 'signer',
      bbox: JSON.stringify([1, 2, 3, 4])
    });
  });
  it('passes a null bbox through (clears the box)', () => {
    assert.deepStrictEqual(fieldUpdateToRow({ bbox: null }), { bbox: null });
  });
  it('leaves a geometry-free patch untouched', () => {
    assert.deepStrictEqual(fieldUpdateToRow({ label: 'X' }), { label: 'X' });
  });
});

describe('buildFieldRows', () => {
  it('maps DTO fields to insert rows with stringified jsonb bbox', () => {
    const detection = validateDetectionResult({
      pageCount: 2,
      fields: [field({ key: 'a' }), field({ key: 'b', bbox: null })]
    });
    const rows = buildFieldRows('tpl-1', detection.fields);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].template_id, 'tpl-1');
    assert.strictEqual(rows[0].field_key, 'a');
    assert.strictEqual(rows[0].sort_order, 0);
    assert.strictEqual(rows[0].bbox, JSON.stringify([10, 20, 30, 40]));
    assert.strictEqual(rows[1].bbox, null);
    assert.strictEqual(rows[1].sort_order, 1);
    // fields have no tenant_id column (scoped via template_id)
    assert.ok(!('tenant_id' in rows[0]));
  });
});

describe('callDetectFieldsAi', () => {
  it('returns the stub result when AGREEMENTS_AI_DETECT_STUB=1 (no fetch)', async () => {
    const prev = process.env.AGREEMENTS_AI_DETECT_STUB;
    process.env.AGREEMENTS_AI_DETECT_STUB = '1';
    try {
      let called = false;
      const out = await callDetectFieldsAi({
        fileUrl: 'https://r2/doc.pdf',
        fetcher: async () => {
          called = true;
          return { ok: true, status: 200, json: async () => ({}) };
        }
      });
      assert.strictEqual(called, false);
      assert.strictEqual(out.fields.length, 2);
    } finally {
      if (prev === undefined) delete process.env.AGREEMENTS_AI_DETECT_STUB;
      else process.env.AGREEMENTS_AI_DETECT_STUB = prev;
    }
  });

  it('POSTs { fileUrl } and returns the parsed body', async () => {
    const prev = process.env.AGREEMENTS_AI_DETECT_STUB;
    delete process.env.AGREEMENTS_AI_DETECT_STUB;
    try {
      let captured;
      const out = await callDetectFieldsAi({
        fileUrl: 'https://r2/doc.pdf',
        fetcher: async (url, opts) => {
          captured = { url, body: JSON.parse(opts.body) };
          return { ok: true, status: 200, json: async () => ({ documentType: 'generic', fields: [] }) };
        }
      });
      assert.match(captured.url, /\/api\/ai\/agreements\/detect-fields$/);
      assert.deepStrictEqual(captured.body, { fileUrl: 'https://r2/doc.pdf' });
      assert.deepStrictEqual(out, { documentType: 'generic', fields: [] });
    } finally {
      if (prev !== undefined) process.env.AGREEMENTS_AI_DETECT_STUB = prev;
    }
  });

  it('returns null on a 5xx response', async () => {
    const prev = process.env.AGREEMENTS_AI_DETECT_STUB;
    delete process.env.AGREEMENTS_AI_DETECT_STUB;
    try {
      const out = await callDetectFieldsAi({
        fileUrl: 'https://r2/doc.pdf',
        fetcher: async () => ({ ok: false, status: 503, json: async () => ({}) })
      });
      assert.strictEqual(out, null);
    } finally {
      if (prev !== undefined) process.env.AGREEMENTS_AI_DETECT_STUB = prev;
    }
  });

  it('returns null when fetch throws', async () => {
    const prev = process.env.AGREEMENTS_AI_DETECT_STUB;
    delete process.env.AGREEMENTS_AI_DETECT_STUB;
    try {
      const out = await callDetectFieldsAi({
        fileUrl: 'https://r2/doc.pdf',
        fetcher: async () => {
          throw new Error('network down');
        }
      });
      assert.strictEqual(out, null);
    } finally {
      if (prev !== undefined) process.env.AGREEMENTS_AI_DETECT_STUB = prev;
    }
  });
});
