'use strict';

/**
 * Normalization for manufacturer/vendor master-table dedup. Mirrors the SQL
 * expression used by the FN-1092 backfill migration:
 *   LOWER(BTRIM(REGEXP_REPLACE(value, '\s+', ' ', 'g')))
 *
 * Both must produce identical output so that an autocomplete query against
 * `normalized_name` matches what the backfill wrote and what new inserts write.
 *
 * @param {string|null|undefined} value
 * @returns {string} normalized form, or '' when input is empty/whitespace
 */
function normalizeName(value) {
	if (value === null || value === undefined) return '';
	return String(value)
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

module.exports = { normalizeName };
