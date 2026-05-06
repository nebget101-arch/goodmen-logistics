/**
 * FN-1400: Auto-generated scannable barcode values for parts.
 *
 * Format: `FN-XXXXXXXX` where X is drawn from a 32-char Crockford-style
 * alphabet that omits `O`, `0`, `I`, `1` to avoid scanner ambiguity.
 *
 * The helper is split so the generation + retry loop can be unit tested
 * without standing up a database (callers inject a `checkExists(value)`
 * function that returns `true` when the candidate is already taken).
 */

const BARCODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BARCODE_LENGTH = 8;
const BARCODE_PREFIX = 'FN-';
const BARCODE_MAX_ATTEMPTS = 5;
const BARCODE_FORMAT = /^FN-[A-HJ-NP-Z2-9]{8}$/;

function generateBarcodeCandidate() {
	let body = '';
	for (let i = 0; i < BARCODE_LENGTH; i += 1) {
		body += BARCODE_ALPHABET.charAt(Math.floor(Math.random() * BARCODE_ALPHABET.length));
	}
	return BARCODE_PREFIX + body;
}

async function generateUniqueBarcode(checkExists) {
	if (typeof checkExists !== 'function') {
		throw new Error('generateUniqueBarcode requires a checkExists(value) function');
	}
	for (let attempt = 0; attempt < BARCODE_MAX_ATTEMPTS; attempt += 1) {
		const candidate = generateBarcodeCandidate();
		const taken = await checkExists(candidate);
		if (!taken) return candidate;
	}
	const err = new Error(`Failed to generate a unique barcode after ${BARCODE_MAX_ATTEMPTS} attempts`);
	err.statusCode = 500;
	throw err;
}

/**
 * Returns the barcode value to persist for a new part:
 *   - If the caller supplied a non-empty string, it is preserved verbatim
 *     (no regeneration, no format validation — matches existing behavior).
 *   - Otherwise generates a unique `FN-XXXXXXXX` value.
 */
async function resolveBarcodeForCreate(suppliedBarcode, checkExists) {
	if (typeof suppliedBarcode === 'string' && suppliedBarcode.trim() !== '') {
		return suppliedBarcode;
	}
	return generateUniqueBarcode(checkExists);
}

module.exports = {
	BARCODE_ALPHABET,
	BARCODE_LENGTH,
	BARCODE_PREFIX,
	BARCODE_MAX_ATTEMPTS,
	BARCODE_FORMAT,
	generateBarcodeCandidate,
	generateUniqueBarcode,
	resolveBarcodeForCreate,
};
