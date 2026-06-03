const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
	BARCODE_FORMAT,
	BARCODE_MAX_ATTEMPTS,
	generateBarcodeCandidate,
	generateUniqueBarcode,
	resolveBarcodeForCreate,
} = require('./barcode-generator');

describe('barcode-generator', () => {
	it('generates candidates that match FN-XXXXXXXX with the safe alphabet', () => {
		for (let i = 0; i < 200; i += 1) {
			assert.match(generateBarcodeCandidate(), BARCODE_FORMAT);
		}
	});

	it('returns the first non-colliding candidate', async () => {
		let calls = 0;
		const value = await generateUniqueBarcode(async () => {
			calls += 1;
			return false;
		});
		assert.equal(calls, 1);
		assert.match(value, BARCODE_FORMAT);
	});

	it('retries on collision and eventually returns a unique value', async () => {
		let calls = 0;
		const seen = [];
		const value = await generateUniqueBarcode(async (candidate) => {
			calls += 1;
			seen.push(candidate);
			// Two simulated duplicates, then accept.
			return calls < 3;
		});
		assert.equal(calls, 3);
		assert.match(value, BARCODE_FORMAT);
		assert.equal(seen[seen.length - 1], value);
	});

	it('throws after BARCODE_MAX_ATTEMPTS consecutive collisions', async () => {
		let calls = 0;
		await assert.rejects(
			generateUniqueBarcode(async () => {
				calls += 1;
				return true;
			}),
			(err) => err.message.includes('Failed to generate a unique barcode') && err.statusCode === 500
		);
		assert.equal(calls, BARCODE_MAX_ATTEMPTS);
	});
});

describe('resolveBarcodeForCreate', () => {
	it('preserves a client-supplied barcode verbatim (no regeneration, no validation)', async () => {
		const value = await resolveBarcodeForCreate('CLIENT-CUSTOM-123', async () => {
			throw new Error('checkExists must not be called when caller supplies a barcode');
		});
		assert.equal(value, 'CLIENT-CUSTOM-123');
	});

	it('preserves an arbitrary non-format string verbatim', async () => {
		const value = await resolveBarcodeForCreate('not-a-fn-format', async () => false);
		assert.equal(value, 'not-a-fn-format');
	});

	it('generates a value when barcode is undefined', async () => {
		const value = await resolveBarcodeForCreate(undefined, async () => false);
		assert.match(value, BARCODE_FORMAT);
	});

	it('generates a value when barcode is empty string', async () => {
		const value = await resolveBarcodeForCreate('', async () => false);
		assert.match(value, BARCODE_FORMAT);
	});

	it('generates a value when barcode is whitespace-only', async () => {
		const value = await resolveBarcodeForCreate('   ', async () => false);
		assert.match(value, BARCODE_FORMAT);
	});

	it('generates a value when barcode is null', async () => {
		const value = await resolveBarcodeForCreate(null, async () => false);
		assert.match(value, BARCODE_FORMAT);
	});

	it('exercises the collision retry path when generating', async () => {
		let calls = 0;
		const value = await resolveBarcodeForCreate(undefined, async () => {
			calls += 1;
			return calls < 2; // first candidate is a "duplicate"
		});
		assert.equal(calls, 2);
		assert.match(value, BARCODE_FORMAT);
	});
});
