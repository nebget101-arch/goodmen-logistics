/**
 * Format a Date as `YYYY-MM-DD` using its **local** components, never UTC.
 *
 * Why: server-side endpoints that compute "today" in UTC misclassify late-evening
 * users in negative-offset zones (e.g. US/Central at 23:30 → UTC tomorrow). The
 * Control Center briefing + trends APIs accept an optional `localDate` query
 * param so the server uses the user's wall-clock date for window math and cache
 * keys. See FN-1610.
 */
export function localDateIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
