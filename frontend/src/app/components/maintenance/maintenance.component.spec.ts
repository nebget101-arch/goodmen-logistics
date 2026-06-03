import {
  parseLocalDateStart,
  parseLocalDateEnd,
} from './maintenance.component';

describe('parseLocalDateStart / parseLocalDateEnd', () => {
  describe('input validation', () => {
    it('returns null for empty / null / undefined', () => {
      expect(parseLocalDateStart('')).toBeNull();
      expect(parseLocalDateStart(null)).toBeNull();
      expect(parseLocalDateStart(undefined)).toBeNull();
      expect(parseLocalDateEnd('')).toBeNull();
      expect(parseLocalDateEnd(null)).toBeNull();
      expect(parseLocalDateEnd(undefined)).toBeNull();
    });

    it('returns null for non-YYYY-MM-DD strings', () => {
      expect(parseLocalDateStart('05/08/2026')).toBeNull();
      expect(parseLocalDateStart('2026-5-8')).toBeNull();
      expect(parseLocalDateStart('2026-05-08T00:00:00Z')).toBeNull();
      expect(parseLocalDateEnd('garbage')).toBeNull();
    });
  });

  describe('local-calendar interpretation', () => {
    it('parseLocalDateStart returns local midnight on the picked day', () => {
      const d = parseLocalDateStart('2026-05-08')!;
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(4); // May (0-indexed)
      expect(d.getDate()).toBe(8);
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
      expect(d.getMilliseconds()).toBe(0);
    });

    it('parseLocalDateEnd returns local 23:59:59.999 on the picked day', () => {
      const d = parseLocalDateEnd('2026-05-08')!;
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(4);
      expect(d.getDate()).toBe(8);
      expect(d.getHours()).toBe(23);
      expect(d.getMinutes()).toBe(59);
      expect(d.getSeconds()).toBe(59);
      expect(d.getMilliseconds()).toBe(999);
    });
  });

  describe('regression: WO created any time on the picked To date is included', () => {
    // A WO row whose created_at is, say, 7 PM local on 2026-05-08 must
    // satisfy `new Date(wo.created_at) <= parseLocalDateEnd('2026-05-08')`.
    it('a WO created at 19:00 local on 2026-05-08 is <= the parsed end-of-day boundary', () => {
      const created = new Date(2026, 4, 8, 19, 0, 0, 0); // 7 PM local
      const to = parseLocalDateEnd('2026-05-08')!;
      expect(created.getTime()).toBeLessThanOrEqual(to.getTime());
    });

    it('a WO created at 23:59:59.998 local on 2026-05-08 is still <= the boundary', () => {
      const created = new Date(2026, 4, 8, 23, 59, 59, 998);
      const to = parseLocalDateEnd('2026-05-08')!;
      expect(created.getTime()).toBeLessThanOrEqual(to.getTime());
    });

    it('a WO created at 00:00 local on 2026-05-09 is NOT <= the May 8 boundary', () => {
      const created = new Date(2026, 4, 9, 0, 0, 0, 0);
      const to = parseLocalDateEnd('2026-05-08')!;
      expect(created.getTime()).toBeGreaterThan(to.getTime());
    });

    it('From=To=2026-05-08 forms a closed local-day window', () => {
      const from = parseLocalDateStart('2026-05-08')!;
      const to = parseLocalDateEnd('2026-05-08')!;
      const earlyMay8 = new Date(2026, 4, 8, 0, 0, 0, 0);
      const lateMay8 = new Date(2026, 4, 8, 23, 59, 59, 999);
      const lateMay7 = new Date(2026, 4, 7, 23, 59, 59, 999);
      const earlyMay9 = new Date(2026, 4, 9, 0, 0, 0, 0);

      expect(earlyMay8.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(earlyMay8.getTime()).toBeLessThanOrEqual(to.getTime());
      expect(lateMay8.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(lateMay8.getTime()).toBeLessThanOrEqual(to.getTime());

      expect(lateMay7.getTime()).toBeLessThan(from.getTime());
      expect(earlyMay9.getTime()).toBeGreaterThan(to.getTime());
    });
  });
});
