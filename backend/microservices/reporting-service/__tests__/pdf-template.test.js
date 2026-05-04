'use strict';

/**
 * FN-1167: tests for the branded PDF template renderer + the AI narrative
 * server-to-server client.
 *
 * Run standalone with `node`:
 *   node backend/microservices/reporting-service/__tests__/pdf-template.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');

const {
	renderBrandedPdf,
	_internals: pdfInternals
} = require('../../../packages/goodmen-shared/services/pdf-template');
const {
	_internals: clientInternals
} = require('../../../packages/goodmen-shared/services/ai-narrative-client');

function collectingStream() {
	const chunks = [];
	const stream = new Writable({
		write(chunk, _enc, cb) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			cb();
		}
	});
	stream.collected = () => Buffer.concat(chunks);
	return stream;
}

const SAMPLE_PAYLOAD = {
	cards: [
		{ key: 'rev', label: 'Total Revenue', value: 152340.55 },
		{ key: 'rpm', label: 'Avg Rate / Mile', value: 2.41 },
		{ key: 'profit', label: 'Gross Profit', value: 38900.12, delta: -1234.5 }
	],
	data: [
		{ loadId: 'L-1001', driverName: 'Alice', revenue: 4200.5, rpm: 2.4 },
		{ loadId: 'L-1002', driverName: 'Bob', revenue: 5100.25, rpm: 2.6 },
		{ loadId: 'L-1003', driverName: 'Carol', revenue: 3800, rpm: 2.1 }
	]
};

test('renderBrandedPdf produces a non-empty PDF buffer with all sections', async () => {
	const stream = collectingStream();
	await renderBrandedPdf({
		reportKey: 'revenue-by-driver',
		payload: SAMPLE_PAYLOAD,
		filters: { startDate: '2026-04-01', endDate: '2026-04-30', dispatcherId: 'd-1' },
		narrative: 'Revenue rose 12% week-over-week, driven by Alice and Bob exceeding their typical rate-per-mile.',
		anomalies: [
			{ metric: 'rpm', value: 2.6, deltaPct: 14.3, severity: 'warning', context: 'Bob above 2-sigma' }
		],
		stream
	});
	const buf = stream.collected();
	assert.ok(buf.length > 1500, `PDF buffer too small: ${buf.length} bytes`);
	const head = buf.slice(0, 5).toString('utf8');
	assert.equal(head, '%PDF-', 'PDF magic bytes missing');
	const body = buf.toString('latin1');
	assert.match(body, /FleetNeuron/, 'wordmark missing');
});

test('renderBrandedPdf still renders when narrative + anomalies are absent', async () => {
	const stream = collectingStream();
	await renderBrandedPdf({
		reportKey: 'load-margin',
		payload: SAMPLE_PAYLOAD,
		filters: { startDate: '2026-04-01' },
		narrative: null,
		anomalies: [],
		stream
	});
	const buf = stream.collected();
	assert.ok(buf.length > 1000, 'PDF buffer should still render with empty AI sections');
	assert.equal(buf.slice(0, 5).toString('utf8'), '%PDF-');
});

test('renderBrandedPdf handles 1000+ rows under the perf budget (<5s)', async () => {
	const big = {
		...SAMPLE_PAYLOAD,
		data: Array.from({ length: 1200 }, (_, i) => ({
			loadId: `L-${i}`,
			driverName: `Driver ${i % 30}`,
			revenue: 1000 + (i % 7) * 137.5,
			rpm: 2 + (i % 11) * 0.05
		}))
	};
	const stream = collectingStream();
	const startedAt = Date.now();
	await renderBrandedPdf({
		reportKey: 'fully-loaded-profit',
		payload: big,
		filters: { startDate: '2026-04-01', endDate: '2026-04-30' },
		narrative: 'Stable margins across the period with no significant outliers.',
		anomalies: [],
		stream
	});
	const elapsedMs = Date.now() - startedAt;
	assert.ok(elapsedMs < 5000, `PDF took ${elapsedMs}ms, exceeds 5s budget`);
	const buf = stream.collected();
	assert.ok(buf.length > 4000, `PDF buffer too small for 1200 rows: ${buf.length} bytes`);
});

test('humanizeKey + formatValue handle edge cases', () => {
	const { humanizeKey, formatValue, formatFilters, pickTableColumns } = pdfInternals;
	assert.equal(humanizeKey('dispatcher_id'), 'Dispatcher Id');
	assert.equal(humanizeKey('startDate'), 'Start Date');
	assert.equal(humanizeKey(''), '');
	assert.equal(formatValue(null), '—');
	assert.equal(formatValue(undefined), '—');
	assert.equal(formatValue(''), '—');
	assert.equal(formatValue(1234567.891), '1,234,567.89');
	assert.equal(formatValue(2.345), '2.35');
	const filters = formatFilters({ startDate: '2026-01-01', limit: 100, dispatcherId: '' });
	assert.deepEqual(filters, [{ label: 'Start Date', value: '2026-01-01' }]);
	const cols = pickTableColumns([{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }], 6);
	assert.deepEqual(cols, ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('ai-narrative-client.pickBearer extracts only well-formed Bearer tokens', () => {
	const { pickBearer } = clientInternals;
	assert.equal(pickBearer({ headers: { authorization: 'Bearer abc' } }), 'Bearer abc');
	assert.equal(pickBearer({ headers: { Authorization: 'Bearer xyz.long.token' } }), 'Bearer xyz.long.token');
	assert.equal(pickBearer({ headers: { authorization: 'Basic abc' } }), null);
	assert.equal(pickBearer({ headers: {} }), null);
	assert.equal(pickBearer({}), null);
	assert.equal(pickBearer(null), null);
});
