/// <reference types="jasmine" />

import { localDateIso } from './local-date';

describe('localDateIso', () => {
  it('formats a Date using its local Y/M/D components, zero-padded', () => {
    const d = new Date(2026, 0, 7, 23, 30, 0); // 2026-01-07 local
    expect(localDateIso(d)).toBe('2026-01-07');
  });

  it('uses local components, not UTC (late-evening US/Central case)', () => {
    // 2026-05-08 23:30 in US/Central is 2026-05-09 ~04:30 UTC.
    // localDateIso must return the local day, not UTC's tomorrow.
    const d = new Date(2026, 4, 8, 23, 30, 0);
    expect(localDateIso(d)).toBe('2026-05-08');
  });

  it('zero-pads single-digit months and days', () => {
    const d = new Date(2026, 8, 3, 12, 0, 0); // September 3
    expect(localDateIso(d)).toBe('2026-09-03');
  });

  it('defaults to now when no argument is given', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(2026, 1, 14, 9, 0, 0));
      expect(localDateIso()).toBe('2026-02-14');
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
