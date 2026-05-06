'use strict';

/**
 * Versioned parser for the FMCSA Motor Carrier Registrations Census file
 * (data.transportation.gov dataset 4a2k-zf79).
 *
 * v1 — handles the column names FMCSA publishes as of 2026-05. If they
 * rename columns, add v2 and switch the queue handler over; never edit
 * v1 in place (audit trail).
 *
 * The header lookup is case-insensitive and accepts a few historical
 * synonyms per field, so the parser tolerates the small column-name
 * drift FMCSA has shipped between revisions of the dataset.
 */

const COLUMN_ALIASES = {
  dot: ['DOT_NUMBER', 'USDOT_NUMBER', 'DOT_NBR'],
  legal_name: ['LEGAL_NAME', 'NAME'],
  dba_name: ['DBA_NAME', 'DBA_NM'],
  mc_number: ['MC_NUMBER', 'MC_NBR', 'DOCKET_NUMBER'],
  mx_number: ['MX_NUMBER', 'MX_NBR'],
  ff_number: ['FF_NUMBER', 'FF_NBR'],
  address_line1: ['PHY_STREET', 'PHY_STREET1', 'ADDRESS_LINE_1', 'ADDR_LINE1'],
  address_line2: ['PHY_STREET2', 'ADDRESS_LINE_2', 'ADDR_LINE2'],
  city: ['PHY_CITY', 'CITY'],
  state: ['PHY_STATE', 'STATE'],
  zip_code: ['PHY_ZIP', 'PHY_ZIP_CODE', 'ZIP_CODE', 'POSTAL_CODE'],
  country: ['PHY_COUNTRY', 'COUNTRY'],
  phone: ['TELEPHONE', 'PHONE', 'PHONE_NUMBER'],
  fax: ['FAX', 'FAX_NUMBER'],
  email: ['EMAIL_ADDRESS', 'EMAIL', 'E_MAIL_ADDRESS'],
  power_units: ['NBR_POWER_UNIT', 'POWER_UNITS', 'TOTAL_POWER_UNITS'],
  drivers: ['DRIVER_TOTAL', 'DRIVERS', 'TOTAL_DRIVERS'],
  mileage: ['MILEAGE', 'TOTAL_MILEAGE'],
  mileage_year: ['MILEAGE_YEAR', 'MCS150_MILEAGE_YEAR'],
  hazmat_flag: ['HM_FLAG', 'HAZMAT_FLAG'],
  passenger_flag: ['PC_FLAG', 'PASSENGER_FLAG'],
  operation_classification: [
    'OPERATION_CLASSIFICATION',
    'CARRIER_OPERATION',
    'OP_CLASSIFICATION',
  ],
  status: ['STATUS_CODE', 'CARRIER_STATUS', 'OPERATING_STATUS'],
};

function buildHeaderMap(headers) {
  // Map: canonicalField -> headerNameAsSeenInFile
  const upper = new Map();
  for (const h of headers) upper.set(h.trim().toUpperCase(), h);

  const out = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const found = upper.get(alias.toUpperCase());
      if (found) {
        out[field] = found;
        break;
      }
    }
  }
  return out;
}

function trimOrNull(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

function intOrNull(v) {
  const t = trimOrNull(v);
  if (t == null) return null;
  // FMCSA mileage occasionally shows "1,234,567"
  const cleaned = t.replace(/[,\s]/g, '');
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function flagToBool(v) {
  const t = trimOrNull(v);
  if (t == null) return false;
  return /^(y|yes|true|1|t)$/i.test(t);
}

/**
 * Convert one parsed CSV row into a normalized carrier record.
 * Returns null if the row has no usable DOT number — the importer skips it.
 */
function parseCensusRow(row, headerMap) {
  const dotRaw = trimOrNull(row[headerMap.dot]);
  if (!dotRaw) return null;
  const cleanedDot = dotRaw.replace(/[^0-9]/g, '');
  if (!cleanedDot) return null;
  const dot = Number.parseInt(cleanedDot, 10);
  if (!Number.isFinite(dot) || dot <= 0) return null;

  return {
    dot,
    mc_number: trimOrNull(row[headerMap.mc_number]),
    mx_number: trimOrNull(row[headerMap.mx_number]),
    ff_number: trimOrNull(row[headerMap.ff_number]),
    legal_name: trimOrNull(row[headerMap.legal_name]),
    dba_name: trimOrNull(row[headerMap.dba_name]),
    address_line1: trimOrNull(row[headerMap.address_line1]),
    address_line2: trimOrNull(row[headerMap.address_line2]),
    city: trimOrNull(row[headerMap.city]),
    state: trimOrNull(row[headerMap.state]),
    zip_code: trimOrNull(row[headerMap.zip_code]),
    country: trimOrNull(row[headerMap.country]),
    phone: trimOrNull(row[headerMap.phone]),
    fax: trimOrNull(row[headerMap.fax]),
    email: trimOrNull(row[headerMap.email]),
    power_units: intOrNull(row[headerMap.power_units]),
    drivers: intOrNull(row[headerMap.drivers]),
    mileage: intOrNull(row[headerMap.mileage]),
    mileage_year: intOrNull(row[headerMap.mileage_year]),
    hazmat_flag: flagToBool(row[headerMap.hazmat_flag]),
    passenger_flag: flagToBool(row[headerMap.passenger_flag]),
    operation_classification: trimOrNull(row[headerMap.operation_classification]),
    status: trimOrNull(row[headerMap.status]),
  };
}

module.exports = {
  COLUMN_ALIASES,
  buildHeaderMap,
  parseCensusRow,
  // Exported for unit tests; not part of the importer API surface.
  _internals: { trimOrNull, intOrNull, flagToBool },
};
