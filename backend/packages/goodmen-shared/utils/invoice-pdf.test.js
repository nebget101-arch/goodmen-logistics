'use strict';

/**
 * FN-1748: Unit tests for the DB-driven shop logo on invoice PDFs.
 *
 * buildInvoicePdf accepts an optional `logoBuffer` (resolved from R2 by the
 * invoices route: location logo → tenant fallback). These tests assert the
 * embedding is best-effort and never breaks PDF generation.
 *
 * Run: cd backend/packages/goodmen-shared && node --test utils/invoice-pdf.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { buildInvoicePdf } = require('./invoice-pdf');

// 1x1 transparent PNG — a valid image pdfkit can embed.
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const baseInvoice = {
  invoice: {
    invoice_number: 'INV-1001',
    status: 'OPEN',
    total_amount: 100,
    amount_paid: 0,
    balance_due: 100
  },
  lineItems: [],
  payments: []
};

function isPdf(buf) {
  return Buffer.isBuffer(buf) && buf.length > 0 && buf.slice(0, 5).toString('latin1') === '%PDF-';
}

describe('buildInvoicePdf — logo handling', () => {
  it('generates a PDF with no logoBuffer (no-logo layout)', async () => {
    const buf = await buildInvoicePdf({ ...baseInvoice });
    assert.ok(isPdf(buf), 'expected a %PDF buffer');
  });

  it('embeds a valid PNG logo buffer without throwing', async () => {
    const buf = await buildInvoicePdf({ ...baseInvoice, logoBuffer: VALID_PNG });
    assert.ok(isPdf(buf), 'expected a %PDF buffer');
  });

  it('is non-fatal when the logo buffer is corrupt/unsupported', async () => {
    const corrupt = Buffer.from('not-an-image', 'utf8');
    const buf = await buildInvoicePdf({ ...baseInvoice, logoBuffer: corrupt });
    assert.ok(isPdf(buf), 'corrupt logo must not break PDF generation');
  });

  it('ignores a non-Buffer logoBuffer value', async () => {
    const buf = await buildInvoicePdf({ ...baseInvoice, logoBuffer: 'some-string' });
    assert.ok(isPdf(buf), 'expected a %PDF buffer');
  });

  it('ignores an empty logo buffer', async () => {
    const buf = await buildInvoicePdf({ ...baseInvoice, logoBuffer: Buffer.alloc(0) });
    assert.ok(isPdf(buf), 'expected a %PDF buffer');
  });
});
