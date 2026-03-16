'use strict';

/**
 * Fuel file parser service.
 * Supports CSV and XLSX using the xlsx package (already in shared deps).
 * Provides built-in column mapping templates for known providers.
 */

const XLSX = require('xlsx');

// ─── Provider templates ──────────────────────────────────────────────────────
// Each entry maps the provider's raw column headers to our normalized field names.
// Field names must match the fuel_transactions schema.

const PROVIDER_TEMPLATES = {
  generic: {
    label: 'Generic / FleetNeuron',
    fields: {
      transaction_date: ['transaction_date', 'date', 'trans date', 'tran date'],
      posted_date: ['posted_date', 'post date', 'posting date'],
      provider_name: ['provider', 'provider_name', 'fuel company'],
      card_number_masked: ['card_number', 'card number', 'card #', 'card no'],
      unit_number_raw: ['truck_unit', 'truck unit', 'unit', 'unit number', 'unit #', 'vehicle'],
      driver_name_raw: ['driver_name', 'driver name', 'driver'],
      vendor_name: ['vendor_name', 'vendor name', 'vendor', 'merchant', 'merchant name'],
      city: ['city'],
      state: ['state', 'st'],
      gallons: ['gallons', 'quantity', 'qty', 'vol', 'volume'],
      amount: ['total_amount', 'total amount', 'total', 'amount', 'net amount'],
      price_per_gallon: ['price_per_gallon', 'price per gallon', 'ppg', 'unit price', 'price'],
      odometer: ['odometer', 'odo', 'mileage', 'miles'],
      product_type: ['product_type', 'product type', 'product', 'fuel type'],
      external_transaction_id: ['external_transaction_id', 'transaction id', 'trans id', 'transaction #', 'reference', 'ref #'],
    }
  },
  efs: {
    label: 'EFS',
    fields: {
      transaction_date: ['transaction date', 'date'],
      posted_date: ['post date'],
      card_number_masked: ['card number', 'card #'],
      unit_number_raw: ['unit', 'unit number', 'tractor'],
      driver_name_raw: ['driver', 'driver name'],
      vendor_name: ['merchant', 'location', 'merchant name'],
      city: ['city', 'merchant city'],
      state: ['state', 'merchant state', 'st'],
      gallons: ['gallons', 'quantity'],
      amount: ['total', 'amount', 'net amount'],
      price_per_gallon: ['ppg', 'price'],
      odometer: ['odometer'],
      product_type: ['product'],
      external_transaction_id: ['transaction id', 'auth number', 'transaction number'],
    }
  },
  comdata: {
    label: 'Comdata',
    fields: {
      transaction_date: ['transaction date', 'trans date', 'date'],
      posted_date: ['post date', 'posting date'],
      card_number_masked: ['card number', 'embossed card'],
      unit_number_raw: ['unit number', 'vehicle id'],
      driver_name_raw: ['driver name'],
      vendor_name: ['location name', 'merchant', 'vendor'],
      city: ['city'],
      state: ['state'],
      gallons: ['quantity', 'gallons'],
      amount: ['gross amount', 'amount', 'total amount'],
      price_per_gallon: ['ppg', 'unit price'],
      odometer: ['odometer'],
      product_type: ['product type', 'product'],
      external_transaction_id: ['transaction number', 'invoice number', 'reference number'],
    }
  },
  wex: {
    label: 'WEX (Wright Express)',
    fields: {
      transaction_date: ['tran date', 'transaction date', 'date'],
      posted_date: ['post date'],
      card_number_masked: ['card number', 'card #'],
      unit_number_raw: ['unit', 'vehicle id'],
      driver_name_raw: ['employee id', 'driver name'],
      vendor_name: ['merchant name', 'vendor'],
      city: ['merchant city', 'city'],
      state: ['merchant state', 'state'],
      gallons: ['quantity', 'gallons', 'volume'],
      amount: ['amount', 'total amount', 'net amount'],
      price_per_gallon: ['unit price', 'ppg'],
      odometer: ['odometer', 'vehicle odometer'],
      product_type: ['product description', 'product type'],
      external_transaction_id: ['transaction id', 'receipt number'],
    }
  },
  rts: {
    label: 'RTS Financial',
    fields: {
      transaction_date: ['date', 'transaction date'],
      posted_date: ['settlement date'],
      card_number_masked: ['card #', 'card number'],
      unit_number_raw: ['unit #', 'unit', 'truck #'],
      driver_name_raw: ['driver'],
      vendor_name: ['location', 'merchant'],
      city: ['city'],
      state: ['state', 'st'],
      gallons: ['gallons', 'quantity'],
      amount: ['amount', 'total'],
      price_per_gallon: ['price', 'ppg'],
      odometer: ['odometer'],
      product_type: ['product'],
      external_transaction_id: ['trans #', 'transaction #'],
    }
  }
};

/**
 * Returns the list of known provider template keys + labels.
 */
function getProviderTemplates() {
  return Object.entries(PROVIDER_TEMPLATES).map(([key, val]) => ({
    key,
    label: val.label
  }));
}

/**
 * Parse a file buffer (CSV or XLSX) and return raw rows as array-of-objects.
 * @param {Buffer} buffer
 * @param {string} originalFileName  - used to detect content type
 * @returns {{ headers: string[], rows: Record<string,string>[] }}
 */
function parseFileBuffer(buffer, originalFileName) {
  const ext = (originalFileName || '').toLowerCase().split('.').pop();
  let workbook;

  if (ext === 'xlsx' || ext === 'xls') {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } else {
    // Treat as CSV – also handles TSV via automatic delimiter detection
    workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: true });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });

  if (!rawRows || rawRows.length < 2) return { headers: [], rows: [] };

  const headerRow = rawRows[0].map((h) => String(h || '').trim());
  const dataRows = rawRows.slice(1);

  const rows = dataRows.map((row) => {
    const obj = {};
    headerRow.forEach((header, idx) => {
      // Sanitize cell values – prevent CSV injection
      let val = String(row[idx] ?? '').trim();
      // Strip formula injection prefix characters
      if (/^[=+\-@\t\r]/.test(val)) {
        val = "'" + val;
      }
      obj[header] = val;
    });
    return obj;
  }).filter((row) => Object.values(row).some((v) => v !== ''));

  return { headers: headerRow, rows };
}

/**
 * Build a column mapping from raw file headers using a provider template.
 * Returns a map of { normalizedField: rawColumnHeader | null }
 */
function buildAutoMapping(rawHeaders, providerKey) {
  const template = PROVIDER_TEMPLATES[providerKey] || PROVIDER_TEMPLATES.generic;
  const lowerHeaders = rawHeaders.map((h) => h.toLowerCase().trim());
  const mapping = {};

  for (const [normalizedField, candidates] of Object.entries(template.fields)) {
    let matched = null;
    for (const candidate of candidates) {
      const idx = lowerHeaders.indexOf(candidate.toLowerCase());
      if (idx !== -1) {
        matched = rawHeaders[idx]; // Use original casing
        break;
      }
    }
    mapping[normalizedField] = matched;
  }

  return mapping;
}

/**
 * Apply a column mapping to a raw row to produce a normalized row object.
 * @param {Record<string,string>} rawRow
 * @param {Record<string,string|null>} columnMap  { normalizedField: rawColumnHeader }
 * @returns {Record<string, string>}
 */
function applyMapping(rawRow, columnMap) {
  const normalized = {};
  for (const [field, rawHeader] of Object.entries(columnMap)) {
    if (rawHeader && rawRow[rawHeader] !== undefined) {
      normalized[field] = String(rawRow[rawHeader] || '').trim();
    } else {
      normalized[field] = '';
    }
  }
  return normalized;
}

/**
 * Validate a single normalized row.
 * Returns { errors: string[], warnings: string[] }
 */
function validateRow(row, existingExternalIds = new Set()) {
  const errors = [];
  const warnings = [];

  // ─── Required fields ────────────────────────────────────────────────────────
  if (!row.transaction_date) {
    errors.push('Missing transaction date');
  } else {
    const d = new Date(row.transaction_date);
    if (isNaN(d.getTime())) {
      errors.push(`Invalid transaction date: "${row.transaction_date}"`);
    } else if (d > new Date()) {
      errors.push(`Transaction date is in the future: "${row.transaction_date}"`);
    }
  }

  const gallons = parseFloat(row.gallons);
  if (!row.gallons || isNaN(gallons)) {
    errors.push('Missing or invalid gallons');
  } else if (gallons <= 0) {
    errors.push(`Gallons must be positive (got ${gallons})`);
  } else if (gallons > 1000) {
    warnings.push(`Suspiciously high gallons: ${gallons}`);
  }

  const amount = parseFloat(row.amount);
  if (!row.amount || isNaN(amount)) {
    errors.push('Missing or invalid total amount');
  } else if (amount < 0) {
    errors.push(`Negative total amount (${amount}) – check for credit/return`);
  }

  // ─── Optional quality checks ─────────────────────────────────────────────────
  if (row.price_per_gallon) {
    const ppg = parseFloat(row.price_per_gallon);
    if (!isNaN(ppg) && ppg > 15) {
      warnings.push(`Suspiciously high PPG: $${ppg}`);
    }
  }

  if (row.odometer) {
    const odo = parseInt(row.odometer, 10);
    if (!isNaN(odo) && odo > 10_000_000) {
      warnings.push(`Impossible odometer reading: ${odo}`);
    }
  }

  if (!row.vendor_name) {
    warnings.push('Missing vendor/location name');
  }

  if (!row.unit_number_raw && !row.card_number_masked && !row.driver_name_raw) {
    warnings.push('No truck unit, card number, or driver name – matching may fail');
  }

  if (!row.state) {
    warnings.push('Missing state/jurisdiction – IFTA tracking unavailable');
  } else if (row.state && !/^[A-Z]{2}$/.test(row.state.toUpperCase())) {
    warnings.push(`Unrecognised state code: "${row.state}"`);
  }

  // ─── Duplicate external ID ────────────────────────────────────────────────────
  if (row.external_transaction_id && existingExternalIds.has(row.external_transaction_id)) {
    warnings.push(`Duplicate external transaction ID: "${row.external_transaction_id}"`);
  }

  return { errors, warnings };
}

module.exports = {
  getProviderTemplates,
  parseFileBuffer,
  buildAutoMapping,
  applyMapping,
  validateRow,
  PROVIDER_TEMPLATES
};
