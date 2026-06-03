'use strict';

/**
 * FN-1333: Window math for the dashboard stats endpoint.
 *
 * Given a window key (today | 7d | 30d) and an IANA timezone, returns the
 * UTC bounds for the current window and the immediately-preceding window of
 * equal length. Day boundaries (00:00 → 24:00) are computed in the supplied
 * timezone and converted to UTC, which makes the math correct across DST
 * transitions and across operating entities in different regions.
 */

const VALID_WINDOWS = new Set(['today', '7d', '30d']);
const DEFAULT_TIMEZONE = 'America/New_York';

function isValidWindow(windowKey) {
  return typeof windowKey === 'string' && VALID_WINDOWS.has(windowKey);
}

function tzOffsetMs(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  const hourStr = get('hour') === '24' ? '00' : get('hour');
  const tzAsUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(hourStr),
    Number(get('minute')),
    Number(get('second'))
  );
  return tzAsUtc - date.getTime();
}

function ymdInTz(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(date);
  return {
    y: Number(parts.find((p) => p.type === 'year').value),
    m: Number(parts.find((p) => p.type === 'month').value),
    d: Number(parts.find((p) => p.type === 'day').value)
  };
}

/**
 * UTC Date for `YMD 00:00:00` rendered in `timeZone`. Handles DST by
 * iterating until the offset stabilises (the first guess can sit on the wrong
 * side of a spring-forward / fall-back boundary).
 */
function startOfDayUtc(y, m, d, timeZone) {
  let ts = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const offset = tzOffsetMs(new Date(ts), timeZone);
    const next = Date.UTC(y, m - 1, d, 0, 0, 0) - offset;
    if (next === ts) break;
    ts = next;
  }
  return new Date(ts);
}

function addDaysToYmd(y, m, d, days) {
  const ts = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const date = new Date(ts);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/**
 * @param {'today'|'7d'|'30d'} windowKey
 * @param {string} [timeZone] IANA timezone (e.g., "America/New_York")
 * @param {Date}   [now]      Optional clock injection for tests
 * @returns {{
 *   window: string,
 *   timezone: string,
 *   current: { start: Date, end: Date },
 *   previous: { start: Date, end: Date }
 * }}
 */
function computeWindow(windowKey, timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  if (!isValidWindow(windowKey)) {
    throw new Error(`Invalid window: ${windowKey}. Must be one of today, 7d, 30d.`);
  }

  const tz = timeZone || DEFAULT_TIMEZONE;
  const today = ymdInTz(now, tz);
  const days = windowKey === 'today' ? 1 : windowKey === '7d' ? 7 : 30;

  const currentEndYmd = addDaysToYmd(today.y, today.m, today.d, 1);
  const currentEnd = startOfDayUtc(currentEndYmd.y, currentEndYmd.m, currentEndYmd.d, tz);

  const currentStartYmd = addDaysToYmd(today.y, today.m, today.d, 1 - days);
  const currentStart = startOfDayUtc(currentStartYmd.y, currentStartYmd.m, currentStartYmd.d, tz);

  const previousEnd = currentStart;
  const previousStartYmd = addDaysToYmd(currentStartYmd.y, currentStartYmd.m, currentStartYmd.d, -days);
  const previousStart = startOfDayUtc(previousStartYmd.y, previousStartYmd.m, previousStartYmd.d, tz);

  return {
    window: windowKey,
    timezone: tz,
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd }
  };
}

/**
 * Computes per-key deltas. Both inputs must have the same shape and numeric
 * values; non-numeric or undefined fields are skipped.
 */
function computeDelta(current, previous) {
  const delta = {};
  if (!current || typeof current !== 'object') return delta;
  for (const key of Object.keys(current)) {
    const c = current[key];
    if (typeof c !== 'number') continue;
    const rawP = previous ? previous[key] : 0;
    const p = typeof rawP === 'number' ? rawP : 0;
    delta[key] = Number((c - p).toFixed(2));
  }
  return delta;
}

module.exports = {
  VALID_WINDOWS,
  DEFAULT_TIMEZONE,
  isValidWindow,
  computeWindow,
  computeDelta
};
