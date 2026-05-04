/**
 * normalizeStateCode — coerce a US state input to a 2-letter uppercase code.
 *
 * Accepts:
 *   - 2-letter codes ("CA", "ca", " Ca. ", "Ca,")
 *   - Full state names ("California", "california", "  CALIFORNIA  ")
 *   - 50 states + DC
 *
 * Returns null for unknown / empty / non-string input. We do NOT silently
 * coerce garbage — callers should treat null as "no state" and either omit
 * the field or surface a validation error upstream.
 */

const STATE_NAME_TO_CODE = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
};

const VALID_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

function normalizeStateCode(input) {
  if (input == null) return null;
  if (typeof input !== 'string') return null;

  // Strip dots and commas, collapse whitespace, uppercase.
  const cleaned = input.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!cleaned) return null;

  if (cleaned.length === 2 && VALID_CODES.has(cleaned)) return cleaned;

  if (Object.prototype.hasOwnProperty.call(STATE_NAME_TO_CODE, cleaned)) {
    return STATE_NAME_TO_CODE[cleaned];
  }

  return null;
}

module.exports = {
  normalizeStateCode,
  STATE_NAME_TO_CODE,
};
