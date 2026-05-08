'use strict';

/**
 * FN-1490: Tests for the receiving-invoice upload + AI-extraction handler.
 *
 * Exercises the extracted `processInvoiceUpload` core (pure function,
 * dependencies injected) so we can mock the R2 storage helpers and the
 * AI service client without standing up Express, multer, or a live DB.
 *
 * Acceptance criteria covered:
 *   - 404 on missing ticket
 *   - 400 on non-DRAFT ticket
 *   - 400 when no file provided
 *   - File URL persisted before AI call (AI failure does not lose upload)
 *   - Vendor + reference auto-filled only when currently null
 *   - Re-upload replaces extraction (vendor/reference already filled stays)
 *
 * Run: cd backend/packages/goodmen-shared && node --test test/receiving-invoice.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const { processInvoiceUpload, INVOICE_MAX_BYTES, INVOICE_ALLOWED_MIME } =
	require('../routes/receiving');

const TICKET_ID = '11111111-1111-4111-8111-111111111111';

function makeFile(overrides = {}) {
	return {
		buffer: Buffer.from('fake-pdf-bytes'),
		mimetype: 'application/pdf',
		originalname: 'invoice.pdf',
		size: 14,
		...overrides
	};
}

function makeLogger() {
	const calls = { info: [], warn: [], error: [] };
	return {
		info: (event, fields) => calls.info.push({ event, fields }),
		warn: (event, fields) => calls.warn.push({ event, fields }),
		error: (event, fields) => calls.error.push({ event, fields }),
		_calls: calls
	};
}

/**
 * Knex-style fake: each `db('receiving_tickets')` call returns a chain
 * that records the where + update/first invocations against `state.tickets`.
 * Keys are by ticket id.
 */
function makeDb(state) {
	function chain(table) {
		let whereId = null;
		const api = {
			where(arg, val) {
				if (typeof arg === 'string' && val !== undefined) {
					whereId = val;
				} else if (arg && typeof arg === 'object' && arg.id) {
					whereId = arg.id;
				}
				return api;
			},
			async first() {
				if (table !== 'receiving_tickets') return null;
				const row = state.tickets[whereId];
				return row ? { ...row } : undefined;
			},
			async update(patch) {
				if (table !== 'receiving_tickets') return 0;
				const row = state.tickets[whereId];
				if (!row) return 0;
				state.tickets[whereId] = { ...row, ...patch };
				state.updateLog.push({ id: whereId, patch });
				return 1;
			}
		};
		return api;
	}
	return function db(table) {
		return chain(table);
	};
}

function makeUploadBuffer({ throwError } = {}) {
	const calls = [];
	const fn = async (args) => {
		calls.push(args);
		if (throwError) throw new Error('R2 unreachable');
		return { key: `receiving/${args.prefix.split('/')[1]}/invoice/test-key.pdf` };
	};
	fn._calls = calls;
	return fn;
}

function makeSign({ throwError } = {}) {
	const calls = [];
	const fn = async (key) => {
		calls.push(key);
		if (throwError) throw new Error('sign failed');
		return `https://r2.test/signed?key=${encodeURIComponent(key)}`;
	};
	fn._calls = calls;
	return fn;
}

function makeAi(result) {
	const calls = [];
	const fn = async (req, body) => {
		calls.push({ req, body });
		return result;
	};
	fn._calls = calls;
	return fn;
}

describe('receiving invoice handler — guards (FN-1490)', () => {
	let state;
	beforeEach(() => {
		state = {
			tickets: {
				[TICKET_ID]: {
					id: TICKET_ID,
					status: 'DRAFT',
					vendor_name: null,
					reference_number: null,
					invoice_file_url: null,
					invoice_extracted_data: null,
					invoice_extracted_at: null
				}
			},
			updateLog: []
		};
	});

	it('returns 400 when no file is provided', async () => {
		const result = await processInvoiceUpload(
			{ ticketId: TICKET_ID, file: null },
			{
				db: makeDb(state),
				uploadBuffer: makeUploadBuffer(),
				getSignedDownloadUrl: makeSign(),
				extractInvoiceViaAi: makeAi({ ok: true, data: {} }),
				logger: makeLogger(),
				req: { headers: {} }
			}
		);
		assert.strictEqual(result.status, 400);
		assert.match(result.body.error, /file is required/);
	});

	it('returns 404 when ticket is missing', async () => {
		const result = await processInvoiceUpload(
			{ ticketId: 'missing-id', file: makeFile() },
			{
				db: makeDb(state),
				uploadBuffer: makeUploadBuffer(),
				getSignedDownloadUrl: makeSign(),
				extractInvoiceViaAi: makeAi({ ok: true, data: {} }),
				logger: makeLogger(),
				req: { headers: {} }
			}
		);
		assert.strictEqual(result.status, 404);
		assert.match(result.body.error, /not found/i);
	});

	it('returns 400 when ticket is not DRAFT', async () => {
		state.tickets[TICKET_ID].status = 'POSTED';
		const result = await processInvoiceUpload(
			{ ticketId: TICKET_ID, file: makeFile() },
			{
				db: makeDb(state),
				uploadBuffer: makeUploadBuffer(),
				getSignedDownloadUrl: makeSign(),
				extractInvoiceViaAi: makeAi({ ok: true, data: {} }),
				logger: makeLogger(),
				req: { headers: {} }
			}
		);
		assert.strictEqual(result.status, 400);
		assert.match(result.body.error, /posted ticket/);
	});
});

describe('receiving invoice handler — happy path (FN-1490)', () => {
	let state;
	beforeEach(() => {
		state = {
			tickets: {
				[TICKET_ID]: {
					id: TICKET_ID,
					status: 'DRAFT',
					vendor_name: null,
					reference_number: null,
					invoice_file_url: null,
					invoice_extracted_data: null,
					invoice_extracted_at: null
				}
			},
			updateLog: []
		};
	});

	it('persists file_url, calls AI with signed URL, and returns extraction', async () => {
		const ai = makeAi({
			ok: true,
			data: {
				vendor: 'ACME Parts',
				reference: 'INV-9001',
				invoiceDate: '2026-05-01',
				lines: [
					{ sku: 'OIL-001', description: 'Oil filter', qty: 4, unitCost: 12.5, match: null },
					{ sku: 'AIR-002', description: 'Air filter', qty: 2, unitCost: 18.0, match: null }
				]
			}
		});
		const upload = makeUploadBuffer();
		const sign = makeSign();

		const result = await processInvoiceUpload(
			{ ticketId: TICKET_ID, file: makeFile() },
			{
				db: makeDb(state),
				uploadBuffer: upload,
				getSignedDownloadUrl: sign,
				extractInvoiceViaAi: ai,
				logger: makeLogger(),
				req: { headers: { authorization: 'Bearer test-token' } }
			}
		);

		assert.strictEqual(result.status, 200);
		assert.strictEqual(result.body.success, true);
		assert.ok(result.body.data.fileUrl.startsWith('https://r2.test/signed?key='));
		assert.strictEqual(result.body.data.aiError, null);
		assert.strictEqual(result.body.data.extraction.vendor, 'ACME Parts');
		assert.strictEqual(result.body.data.extraction.lines.length, 2);

		// File URL is stamped on the very first update (before AI call)
		assert.ok(state.updateLog.length >= 2, 'expect at least 2 updates (pre-AI + post-AI)');
		assert.ok(
			state.updateLog[0].patch.invoice_file_url,
			'first update writes invoice_file_url'
		);
		assert.strictEqual(state.updateLog[0].patch.invoice_extracted_data, null);

		// AI was called with the signed URL produced by sign(...)
		assert.strictEqual(ai._calls.length, 1);
		assert.strictEqual(ai._calls[0].body.fileUrl, sign._calls[0] && `https://r2.test/signed?key=${encodeURIComponent(sign._calls[0])}`);
		assert.strictEqual(ai._calls[0].body.contentType, 'application/pdf');

		// Vendor + reference auto-filled because they were null
		const final = state.tickets[TICKET_ID];
		assert.strictEqual(final.vendor_name, 'ACME Parts');
		assert.strictEqual(final.reference_number, 'INV-9001');
		assert.ok(final.invoice_extracted_at instanceof Date);
	});

	it('does NOT overwrite existing vendor or reference', async () => {
		state.tickets[TICKET_ID].vendor_name = 'User-Set Vendor';
		state.tickets[TICKET_ID].reference_number = 'PO-MANUAL';

		const result = await processInvoiceUpload(
			{ ticketId: TICKET_ID, file: makeFile() },
			{
				db: makeDb(state),
				uploadBuffer: makeUploadBuffer(),
				getSignedDownloadUrl: makeSign(),
				extractInvoiceViaAi: makeAi({
					ok: true,
					data: {
						vendor: 'AI-Detected Vendor',
						reference: 'AI-REF',
						invoiceDate: null,
						lines: []
					}
				}),
				logger: makeLogger(),
				req: { headers: {} }
			}
		);

		assert.strictEqual(result.status, 200);
		const final = state.tickets[TICKET_ID];
		assert.strictEqual(final.vendor_name, 'User-Set Vendor');
		assert.strictEqual(final.reference_number, 'PO-MANUAL');
	});
});

describe('receiving invoice handler — AI failures (FN-1490)', () => {
	let state;
	beforeEach(() => {
		state = {
			tickets: {
				[TICKET_ID]: {
					id: TICKET_ID,
					status: 'DRAFT',
					vendor_name: null,
					reference_number: null,
					invoice_file_url: null,
					invoice_extracted_data: null,
					invoice_extracted_at: null
				}
			},
			updateLog: []
		};
	});

	it('returns 200 + null extraction + aiError when the AI service fails', async () => {
		const result = await processInvoiceUpload(
			{ ticketId: TICKET_ID, file: makeFile() },
			{
				db: makeDb(state),
				uploadBuffer: makeUploadBuffer(),
				getSignedDownloadUrl: makeSign(),
				extractInvoiceViaAi: makeAi({ ok: false, error: 'AI_UPSTREAM_ERROR', data: null }),
				logger: makeLogger(),
				req: { headers: {} }
			}
		);

		assert.strictEqual(result.status, 200);
		assert.strictEqual(result.body.success, true);
		assert.strictEqual(result.body.data.extraction, null);
		assert.strictEqual(result.body.data.aiError, 'AI_UPSTREAM_ERROR');

		// File URL was persisted even though AI failed
		const final = state.tickets[TICKET_ID];
		assert.ok(final.invoice_file_url, 'invoice_file_url must be set');
		assert.strictEqual(final.invoice_extracted_data, null);
		assert.strictEqual(final.invoice_extracted_at, null);
		// Ticket header fields untouched on AI failure
		assert.strictEqual(final.vendor_name, null);
		assert.strictEqual(final.reference_number, null);
	});

	it('returns 500 when storage upload throws', async () => {
		const result = await processInvoiceUpload(
			{ ticketId: TICKET_ID, file: makeFile() },
			{
				db: makeDb(state),
				uploadBuffer: makeUploadBuffer({ throwError: true }),
				getSignedDownloadUrl: makeSign(),
				extractInvoiceViaAi: makeAi({ ok: true, data: {} }),
				logger: makeLogger(),
				req: { headers: {} }
			}
		);
		assert.strictEqual(result.status, 500);
		assert.match(result.body.error, /upload/i);
		// No file URL was stamped because the upload itself failed
		assert.strictEqual(state.tickets[TICKET_ID].invoice_file_url, null);
	});
});

describe('receiving invoice handler — exports (FN-1490)', () => {
	it('exposes the multer constants the route uses', () => {
		assert.strictEqual(INVOICE_MAX_BYTES, 15 * 1024 * 1024);
		assert.ok(INVOICE_ALLOWED_MIME.has('application/pdf'));
		assert.ok(INVOICE_ALLOWED_MIME.has('image/jpeg'));
		assert.ok(INVOICE_ALLOWED_MIME.has('image/png'));
		assert.ok(INVOICE_ALLOWED_MIME.has('image/heic'));
		assert.ok(!INVOICE_ALLOWED_MIME.has('text/csv'));
	});
});
