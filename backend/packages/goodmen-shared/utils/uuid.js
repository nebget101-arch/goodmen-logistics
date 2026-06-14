'use strict';

/**
 * RFC-4122 UUID validator (versions 1–5, standard variant), case-insensitive.
 *
 * Guards request inputs before they reach a Postgres `uuid` column: passing a
 * non-UUID string (e.g. a vehicle unit number like `SN-3918`) makes Postgres
 * throw `invalid input syntax for type uuid`, which escapes as an uncaught 500
 * instead of a clean 400. All entity ids in this system are generated with
 * `uuid.v4()`, so a strict v1–5 check matches every real id while rejecting
 * free-text. Centralizes the inline pattern previously duplicated in
 * routes/work-orders.js.
 *
 * @param {*} value
 * @returns {boolean} true only when `value` is a string in canonical UUID form.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

module.exports = { isUuid, UUID_RE };
