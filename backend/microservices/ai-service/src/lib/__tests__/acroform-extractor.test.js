'use strict';

/**
 * FN-1838: Tests for the AcroForm extractor.
 * Runs standalone with `node` — no jest/mocha. Builds real AcroForm PDFs with
 * pdf-lib in memory, then asserts the extractor reads them back correctly.
 */

const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const {
  extractAcroFormFields,
  isPdfBytes,
  classifyType,
  inferRole,
  humanizeLabel,
  rectToTopLeftBbox
} = require('../acroform-extractor');

const PAGE_W = 612;
const PAGE_H = 792; // US Letter; used to verify the bottom-left → top-left y flip.

// Build a 2-page fillable PDF covering each field type + role heuristic.
async function buildFillablePdf() {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([PAGE_W, PAGE_H]);
  const page2 = doc.addPage([PAGE_W, PAGE_H]);
  const form = doc.getForm();

  // page 1
  form.createTextField('lessee_name').addToPage(page1, { x: 72, y: 700, width: 200, height: 18 });
  form.createTextField('monthly_payment_amount').addToPage(page1, { x: 72, y: 650, width: 120, height: 18 });
  form.createCheckBox('driver_agree').addToPage(page1, { x: 72, y: 600, width: 12, height: 12 });

  // page 2 — repeated initials + the company rep's signature
  form.createTextField('driver_initials').addToPage(page2, { x: 60, y: 120, width: 60, height: 16 });
  form.createTextField('lessor_rep_signature').addToPage(page2, { x: 300, y: 80, width: 220, height: 40 });

  return Buffer.from(await doc.save());
}

// A flat PDF with NO form layer.
async function buildFlatPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawText('This is a scanned-looking flat agreement.', { x: 72, y: 700, size: 12 });
  return Buffer.from(await doc.save());
}

// pdf-lib expands a widget's /Rect by its border width (~0.5pt each edge), so
// assert geometry within a 1pt tolerance rather than exact equality.
function assertBboxClose(actual, expected, tol = 1) {
  assert.ok(Array.isArray(actual) && actual.length === 4, `bbox not a 4-array: ${JSON.stringify(actual)}`);
  expected.forEach((e, i) => {
    assert.ok(Math.abs(actual[i] - e) <= tol, `bbox[${i}]=${actual[i]} not within ${tol} of ${e}`);
  });
}

let passed = 0;
function ok(name) {
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ok  ${name}`);
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('acroform-extractor tests');

  // ---- isPdfBytes ---------------------------------------------------------
  {
    assert.equal(isPdfBytes(Buffer.from('%PDF-1.7\n...')), true);
    assert.equal(isPdfBytes(Buffer.from('not a pdf')), false);
    assert.equal(isPdfBytes(Buffer.from('')), false);
    assert.equal(isPdfBytes(null), false);
    ok('isPdfBytes recognizes the %PDF- magic');
  }

  // ---- pure helpers -------------------------------------------------------
  {
    assert.equal(humanizeLabel('lessee_name'), 'Lessee Name');
    assert.equal(humanizeLabel('driverSignature'), 'Driver Signature');
    assert.equal(humanizeLabel('page.3.initials'), 'Page 3 Initials');
    ok('humanizeLabel turns field keys into human labels');
  }

  {
    // Tx fields refine by name; Sig is always signature; Btn is checkbox.
    assert.equal(classifyType('Tx', null, 'lessee name'), 'text');
    assert.equal(classifyType('Tx', null, 'driver initials'), 'initials');
    assert.equal(classifyType('Tx', null, 'date signed'), 'date');
    assert.equal(classifyType('Tx', null, 'monthly payment amount'), 'number');
    assert.equal(classifyType('Tx', null, 'lessee signature'), 'signature');
    assert.equal(classifyType('Sig', null, 'whatever'), 'signature');
    assert.equal(classifyType('Btn', null, 'agree'), 'checkbox');
    ok('classifyType maps FT + name heuristics to contract types');
  }

  {
    assert.equal(inferRole('lessee name', 'text'), 'signer');
    assert.equal(inferRole('lessor representative', 'text'), 'internal');
    assert.equal(inferRole('company office use', 'text'), 'internal');
    assert.equal(inferRole('driver signature', 'signature'), 'signer');
    assert.equal(inferRole('unlabeled blank', 'text'), 'internal'); // no kw, not sig → internal
    assert.equal(inferRole('mystery', 'signature'), 'signer'); // no kw, sig → signer
    ok('inferRole picks internal vs signer from name + type');
  }

  {
    // Malformed rects degrade to null (the full y-flip is asserted end-to-end
    // against a real fillable PDF below, where pdf-lib supplies real PDFArrays).
    assert.equal(rectToTopLeftBbox(null, PAGE_H), null);
    assert.equal(rectToTopLeftBbox([1, 2, 3, 4], PAGE_H), null); // plain array, not a PDFArray
    ok('rectToTopLeftBbox rejects malformed rects');
  }

  // ---- full extraction over a real fillable PDF ---------------------------
  {
    const bytes = await buildFillablePdf();
    const result = await extractAcroFormFields(bytes);

    assert.equal(result.hasForm, true);
    assert.equal(result.pageCount, 2);
    assert.equal(result.documentType, 'lease_agreement'); // lessee/lessor present
    assert.equal(result.fields.length, 5);

    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f]));

    // Every directly-extracted field is full confidence.
    result.fields.forEach((f) => assert.equal(f.confidence, 1.0));

    // Types
    assert.equal(byKey.lessee_name.type, 'text');
    assert.equal(byKey.monthly_payment_amount.type, 'number');
    assert.equal(byKey.driver_agree.type, 'checkbox');
    assert.equal(byKey.driver_initials.type, 'initials');
    assert.equal(byKey.lessor_rep_signature.type, 'signature');

    // Roles
    assert.equal(byKey.lessee_name.suggestedRole, 'signer');
    assert.equal(byKey.driver_agree.suggestedRole, 'signer');
    assert.equal(byKey.driver_initials.suggestedRole, 'signer');
    assert.equal(byKey.lessor_rep_signature.suggestedRole, 'internal');

    // Pages — initials + rep signature live on page 2.
    assert.equal(byKey.lessee_name.page, 1);
    assert.equal(byKey.driver_initials.page, 2);
    assert.equal(byKey.lessor_rep_signature.page, 2);

    // bbox: top-left points. lessee_name at bottom-left y=700,h=18 → y_top = 792-700-18 = 74.
    assertBboxClose(byKey.lessee_name.bbox, [72, 74, 200, 18]);
    // driver_initials at y=120,h=16 → y_top = 792-120-16 = 656.
    assertBboxClose(byKey.driver_initials.bbox, [60, 656, 60, 16]);

    // Labels are humanized.
    assert.equal(byKey.lessee_name.label, 'Lessee Name');
    ok('extractor reads types, roles, pages, and top-left points bboxes');
  }

  // ---- flat PDF falls through ---------------------------------------------
  {
    const bytes = await buildFlatPdf();
    const result = await extractAcroFormFields(bytes);
    assert.equal(result.hasForm, false);
    ok('flat (no form layer) PDF yields hasForm:false');
  }

  // ---- non-PDF bytes degrade gracefully -----------------------------------
  {
    const result = await extractAcroFormFields(Buffer.from('definitely not a pdf'));
    assert.equal(result.hasForm, false);
    ok('non-PDF bytes yield hasForm:false (never throws)');
  }

  // eslint-disable-next-line no-console
  console.log(`all ${passed} tests passed`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
