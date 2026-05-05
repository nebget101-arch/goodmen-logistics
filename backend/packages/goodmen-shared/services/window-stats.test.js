'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  isValidWindow,
  computeWindow,
  computeDelta,
  VALID_WINDOWS,
  DEFAULT_TIMEZONE
} = require('./window-stats');

describe('window-stats (FN-1333)', () => {
  describe('isValidWindow', () => {
    it('accepts the three documented values', () => {
      for (const w of ['today', '7d', '30d']) {
        assert.strictEqual(isValidWindow(w), true);
      }
    });

    it('rejects unknown values', () => {
      for (const w of ['', '1d', '14d', 'TODAY', null, undefined, 42]) {
        assert.strictEqual(isValidWindow(w), false);
      }
    });

    it('exposes a frozen-ish set of valid windows', () => {
      assert.deepStrictEqual([...VALID_WINDOWS].sort(), ['30d', '7d', 'today']);
    });
  });

  describe('computeWindow', () => {
    const now = new Date('2026-05-05T15:30:00Z');

    it('throws on invalid window', () => {
      assert.throws(() => computeWindow('bogus'), /Invalid window/);
    });

    it('today: current and previous are exactly 1 day each (UTC tz)', () => {
      const w = computeWindow('today', 'UTC', now);
      assert.strictEqual(w.window, 'today');
      assert.strictEqual(w.timezone, 'UTC');
      assert.strictEqual(w.current.start.toISOString(), '2026-05-05T00:00:00.000Z');
      assert.strictEqual(w.current.end.toISOString(), '2026-05-06T00:00:00.000Z');
      assert.strictEqual(w.previous.start.toISOString(), '2026-05-04T00:00:00.000Z');
      assert.strictEqual(w.previous.end.toISOString(), '2026-05-05T00:00:00.000Z');
      // previous.end === current.start
      assert.strictEqual(w.previous.end.getTime(), w.current.start.getTime());
    });

    it('today: respects America/New_York timezone (EDT = UTC-4 in May)', () => {
      const w = computeWindow('today', 'America/New_York', now);
      assert.strictEqual(w.current.start.toISOString(), '2026-05-05T04:00:00.000Z');
      assert.strictEqual(w.current.end.toISOString(), '2026-05-06T04:00:00.000Z');
    });

    it('7d: current spans exactly 7 days, previous is the prior 7', () => {
      const w = computeWindow('7d', 'UTC', now);
      const oneDay = 86_400_000;
      assert.strictEqual(w.current.end - w.current.start, 7 * oneDay);
      assert.strictEqual(w.previous.end - w.previous.start, 7 * oneDay);
      assert.strictEqual(w.previous.end.getTime(), w.current.start.getTime());
    });

    it('30d: current spans exactly 30 days, previous is the prior 30', () => {
      const w = computeWindow('30d', 'UTC', now);
      const oneDay = 86_400_000;
      assert.strictEqual(w.current.end - w.current.start, 30 * oneDay);
      assert.strictEqual(w.previous.end - w.previous.start, 30 * oneDay);
    });

    it('falls back to default timezone when none supplied', () => {
      const w = computeWindow('today', undefined, now);
      assert.strictEqual(w.timezone, DEFAULT_TIMEZONE);
    });

    it('handles DST spring-forward (NY 2026-03-08): start offset shifts from -5h to -4h', () => {
      const before = computeWindow('today', 'America/New_York', new Date('2026-03-07T15:00:00Z'));
      const after = computeWindow('today', 'America/New_York', new Date('2026-03-09T15:00:00Z'));
      // Pre-DST EST = UTC-5 → midnight = 05:00 UTC
      assert.strictEqual(before.current.start.toISOString(), '2026-03-07T05:00:00.000Z');
      // Post-DST EDT = UTC-4 → midnight = 04:00 UTC
      assert.strictEqual(after.current.start.toISOString(), '2026-03-09T04:00:00.000Z');
    });

    it('handles a 7d window that crosses a DST boundary', () => {
      const w = computeWindow('7d', 'America/New_York', new Date('2026-03-12T15:00:00Z'));
      // 7-day window ending today (Mar 12) covers Mar 6 (EST) to Mar 13 (EDT).
      // start should be EST (-5h offset → 05:00 UTC), end should be EDT (-4h offset → 04:00 UTC).
      assert.strictEqual(w.current.start.toISOString(), '2026-03-06T05:00:00.000Z');
      assert.strictEqual(w.current.end.toISOString(), '2026-03-13T04:00:00.000Z');
    });

    it('handles month boundaries cleanly', () => {
      // 7d window ending May 1 spans April 25 → May 2.
      const w = computeWindow('7d', 'UTC', new Date('2026-05-01T12:00:00Z'));
      assert.strictEqual(w.current.start.toISOString(), '2026-04-25T00:00:00.000Z');
      assert.strictEqual(w.current.end.toISOString(), '2026-05-02T00:00:00.000Z');
    });
  });

  describe('computeDelta', () => {
    it('returns per-key numeric differences (current - previous)', () => {
      const delta = computeDelta(
        { a: 10, b: 5, c: 0 },
        { a: 4, b: 7, c: 0 }
      );
      assert.deepStrictEqual(delta, { a: 6, b: -2, c: 0 });
    });

    it('treats missing previous keys as zero', () => {
      const delta = computeDelta({ a: 5 }, {});
      assert.deepStrictEqual(delta, { a: 5 });
    });

    it('skips non-numeric fields', () => {
      const delta = computeDelta(
        { a: 5, name: 'foo' },
        { a: 2, name: 'bar' }
      );
      assert.deepStrictEqual(delta, { a: 3 });
    });

    it('rounds to 2 decimal places to avoid float noise', () => {
      const delta = computeDelta({ rate: 12.345 }, { rate: 10.111 });
      assert.strictEqual(delta.rate, 2.23);
    });

    it('returns empty object when current is null/undefined', () => {
      assert.deepStrictEqual(computeDelta(null, { a: 1 }), {});
      assert.deepStrictEqual(computeDelta(undefined, { a: 1 }), {});
    });
  });
});
