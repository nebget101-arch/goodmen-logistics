'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
	normalizeName,
	normalizeIdentifier,
	levenshtein,
	similarity,
	findBestMatch,
} = require('./fuzzy-match-service');

describe('fuzzy-match-service / normalizeName', () => {
	it('strips legal suffixes and punctuation', () => {
		assert.equal(normalizeName('ACME Trucking, Inc.'), 'acme');
		assert.equal(normalizeName('CH Robinson Worldwide LLC'), 'ch robinson worldwide');
	});

	it('treats curly quotes and ampersands consistently', () => {
		assert.equal(normalizeName('Smith & Sons'), 'smith and sons');
		assert.equal(normalizeName('O’Reilly Logistics'), 'o reilly');
	});

	it('returns empty string for null / undefined', () => {
		assert.equal(normalizeName(null), '');
		assert.equal(normalizeName(undefined), '');
	});
});

describe('fuzzy-match-service / normalizeIdentifier', () => {
	it('strips non-alphanumerics and lowercases', () => {
		assert.equal(normalizeIdentifier('MC-123,456'), 'mc123456');
		assert.equal(normalizeIdentifier('  DOT 7890  '), 'dot7890');
	});

	it('returns empty string for null / undefined', () => {
		assert.equal(normalizeIdentifier(null), '');
	});
});

describe('fuzzy-match-service / levenshtein', () => {
	it('returns 0 for identical strings', () => {
		assert.equal(levenshtein('hello', 'hello'), 0);
	});

	it('returns full length when one string is empty', () => {
		assert.equal(levenshtein('', 'abc'), 3);
		assert.equal(levenshtein('abc', ''), 3);
	});

	it('counts a single substitution as distance 1', () => {
		assert.equal(levenshtein('kitten', 'sitten'), 1);
	});

	it('handles classic kitten/sitting case (distance 3)', () => {
		assert.equal(levenshtein('kitten', 'sitting'), 3);
	});
});

describe('fuzzy-match-service / similarity', () => {
	it('returns 0.99 (not 1.0) for normalized exact matches so identifier hits beat them', () => {
		assert.equal(similarity('ACME', 'acme inc'), 0.99);
	});

	it('returns 0 for empty inputs', () => {
		assert.equal(similarity('', 'foo'), 0);
		assert.equal(similarity('foo', null), 0);
	});

	it('scores close-but-not-equal names well above 0', () => {
		const score = similarity('CH Robinson', 'C H Robinson Worldwide');
		assert.ok(score > 0.4, `expected > 0.4 got ${score}`);
	});

	it('scores unrelated names low', () => {
		const score = similarity('CH Robinson', 'XPO Logistics');
		assert.ok(score < 0.5, `expected < 0.5 got ${score}`);
	});
});

describe('fuzzy-match-service / findBestMatch', () => {
	const candidates = [
		{ id: 'a', name: 'ACME Trucking Inc.' },
		{ id: 'b', name: 'CH Robinson Worldwide' },
		{ id: 'c', name: 'XPO Logistics' },
	];

	it('returns the highest-scoring candidate', () => {
		const best = findBestMatch('ACME Trucking', candidates, 'name');
		assert.equal(best.candidate.id, 'a');
		assert.ok(best.score >= 0.9, `expected score >= 0.9, got ${best.score}`);
	});

	it('returns null when query is empty', () => {
		assert.equal(findBestMatch('', candidates, 'name'), null);
	});

	it('returns null when candidates list is empty', () => {
		assert.equal(findBestMatch('ACME', [], 'name'), null);
	});
});
