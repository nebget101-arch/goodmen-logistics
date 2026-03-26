const axios = require('axios');
const cheerio = require('cheerio');

const LOG_PREFIX = '[fmcsa-scraper]';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

const REQUEST_TIMEOUT = 15000;
const RETRY_BASE_DELAY_MS = 2000;
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a URL with exponential-backoff retry.
 * Returns the response body as text, or null when the request fails after
 * all retries have been exhausted.
 */
async function fetchWithRetry(url, options = {}, maxRetries = MAX_RETRIES) {
  const merged = {
    timeout: REQUEST_TIMEOUT,
    headers: DEFAULT_HEADERS,
    responseType: 'text',
    ...options,
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, merged);
      return response.data;
    } catch (err) {
      lastError = err;
      console.error(
        `${LOG_PREFIX} Attempt ${attempt + 1}/${maxRetries + 1} failed for ${url}: ${err.message}`
      );
      if (attempt < maxRetries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  console.error(
    `${LOG_PREFIX} All ${maxRetries + 1} attempts exhausted for ${url}`
  );
  return null;
}

/**
 * Trim whitespace and collapse internal runs of whitespace to a single space.
 */
function clean(text) {
  if (!text) return null;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Attempt to parse a numeric string. Returns null on failure.
 */
function parseNum(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Attempt to parse a date string into an ISO-8601 date (YYYY-MM-DD).
 * FMCSA typically uses "MM/DD/YYYY" or similar formats.
 */
function parseDate(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed === 'None' || trimmed === 'N/A') return null;
  try {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Parse a percentage string like "23%" or "23 %" into a number.
 * Returns null on failure.
 */
function parsePercent(text) {
  if (!text) return null;
  const match = text.match(/([\d.]+)\s*%/);
  if (match) {
    const n = parseFloat(match[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// scrapeCompanySnapshot
// ---------------------------------------------------------------------------

/**
 * Build a label->value map from a SAFER-style HTML page.
 *
 * The SAFER snapshot uses nested tables where labels are inside <a> tags
 * (linking to saferhelp.aspx) within <td> cells. The value is in the
 * adjacent <td>. We normalise label text to lowercase, strip colons and
 * extra whitespace, so lookups are case-insensitive.
 */
function buildLabelMap($) {
  const labelMap = {};

  $('tr').each((_i, row) => {
    const cells = $(row).children('td, th');
    if (cells.length < 2) return;

    for (let c = 0; c < cells.length - 1; c++) {
      const rawLabel = clean($(cells[c]).text());
      if (!rawLabel) continue;

      // Normalise: lowercase, strip trailing colon, collapse whitespace
      const key = rawLabel
        .toLowerCase()
        .replace(/:+$/, '')
        .replace(/[^a-z0-9 /()-]/g, '')
        .trim();

      if (!key) continue;

      const valueText = clean($(cells[c + 1]).text());
      // Only store the first occurrence of each label
      if (valueText && !labelMap[key]) {
        labelMap[key] = valueText;
      }
    }
  });

  return labelMap;
}

/**
 * Look up a value by one or more label fragments (case-insensitive, partial match).
 */
function findInMap(labelMap, ...fragments) {
  for (const frag of fragments) {
    const lower = frag.toLowerCase().replace(/:+$/, '').trim();
    for (const [key, val] of Object.entries(labelMap)) {
      if (key.includes(lower)) return val;
    }
  }
  return null;
}

/**
 * Parse the inspection table from the SAFER snapshot page.
 *
 * Table structure:
 *   Header row: "Inspection Type" | "Vehicle" | "Driver" | "Hazmat" | "IEP"
 *   Row "Inspections": count values
 *   Row "Out of Service": count values
 *   Row "Out of Service %": percentage values
 *   Row "Nat'l Average %": percentage values
 *
 * We locate the table by finding a header cell containing "Inspection Type",
 * then parse subsequent rows by their first-cell text.
 */
function parseInspectionTable($) {
  const result = {
    vehicle_inspections: null,
    driver_inspections: null,
    hazmat_inspections: null,
    iep_inspections: null,
    vehicle_oos: null,
    driver_oos: null,
    hazmat_oos: null,
    vehicle_oos_rate: null,
    driver_oos_rate: null,
    hazmat_oos_rate: null,
    vehicle_oos_national_avg: null,
    driver_oos_national_avg: null,
    hazmat_oos_national_avg: null,
  };

  // Target the FIRST table with summary="Inspections" (US data).
  // The page has two: US and Canada. .first() ensures we get the US one.
  const inspTable = $('table[summary="Inspections"]').first();
  if (!inspTable.length) return result;

  const rows = inspTable.find('> tr, > tbody > tr');
  if (rows.length < 2) return result;

  // First row is the header — determine column indices
  const headerCells = $(rows[0]).find('th, td');
  const colIndex = { vehicle: -1, driver: -1, hazmat: -1, iep: -1 };
  headerCells.each((i, cell) => {
    const t = clean($(cell).text());
    if (!t) return;
    const lower = t.toLowerCase();
    if (lower.includes('vehicle')) colIndex.vehicle = i;
    else if (lower.includes('driver')) colIndex.driver = i;
    else if (lower.includes('hazmat')) colIndex.hazmat = i;
    else if (lower.includes('iep')) colIndex.iep = i;
  });

  // Walk data rows (skip the header at index 0)
  rows.each((i, row) => {
    if (i === 0) return; // skip header

    const cells = $(row).find('th, td');
    if (cells.length < 2) return;

    // Row label is in the first cell (TH with scope="ROW")
    const rowLabel = (clean($(cells[0]).text()) || '').toLowerCase();

    const cellVal = (idx) => {
      if (idx < 0 || idx >= cells.length) return null;
      return clean($(cells[idx]).text());
    };

    if (rowLabel.includes('out of service') && rowLabel.includes('%')) {
      // "Out of Service %" row
      result.vehicle_oos_rate = parsePercent(cellVal(colIndex.vehicle));
      result.driver_oos_rate = parsePercent(cellVal(colIndex.driver));
      result.hazmat_oos_rate = parsePercent(cellVal(colIndex.hazmat));
    } else if (rowLabel.includes('nat') && rowLabel.includes('average')) {
      // "Nat'l Average %" row
      result.vehicle_oos_national_avg = parsePercent(cellVal(colIndex.vehicle));
      result.driver_oos_national_avg = parsePercent(cellVal(colIndex.driver));
      result.hazmat_oos_national_avg = parsePercent(cellVal(colIndex.hazmat));
    } else if (rowLabel.includes('out of service')) {
      // "Out of Service" count row (must check AFTER the % variant)
      result.vehicle_oos = parseNum(cellVal(colIndex.vehicle));
      result.driver_oos = parseNum(cellVal(colIndex.driver));
      result.hazmat_oos = parseNum(cellVal(colIndex.hazmat));
    } else if (
      rowLabel.includes('inspection') &&
      !rowLabel.includes('type')
    ) {
      // "Inspections" count row
      result.vehicle_inspections = parseNum(cellVal(colIndex.vehicle));
      result.driver_inspections = parseNum(cellVal(colIndex.driver));
      result.hazmat_inspections = parseNum(cellVal(colIndex.hazmat));
      result.iep_inspections = parseNum(cellVal(colIndex.iep));
    }
  });

  return result;
}

/**
 * Parse the crash table from the SAFER snapshot page.
 *
 * Table structure:
 *   Header row: "Type" | "Fatal" | "Injury" | "Tow" | "Total"
 *   Row "Crashes": count values
 */
function parseCrashTable($) {
  const result = {
    crashes_fatal: null,
    crashes_injury: null,
    crashes_tow: null,
    crashes_total: null,
  };

  // Target the FIRST crash table (US data). Page has US + Canada tables.
  const crashTable = $('table[summary="Crashes"]').first();
  if (!crashTable.length) return result;

  const rows = crashTable.find('> tr, > tbody > tr');
  if (rows.length < 2) return result;

  // First row is the header — determine column indices
  const headerCells = $(rows[0]).find('th, td');
  const colIndex = { fatal: -1, injury: -1, tow: -1, total: -1 };
  headerCells.each((i, cell) => {
    const t = (clean($(cell).text()) || '').toLowerCase();
    if (t.includes('fatal')) colIndex.fatal = i;
    else if (t.includes('injury')) colIndex.injury = i;
    else if (t.includes('tow')) colIndex.tow = i;
    else if (t.includes('total')) colIndex.total = i;
  });

  // Walk data rows (skip the header at index 0)
  rows.each((i, row) => {
    if (i === 0) return; // skip header

    const cells = $(row).find('th, td');
    if (cells.length < 2) return;

    const rowLabel = (clean($(cells[0]).text()) || '').toLowerCase();

    const cellVal = (idx) => {
      if (idx < 0 || idx >= cells.length) return null;
      return clean($(cells[idx]).text());
    };

    if (rowLabel.includes('crash')) {
      result.crashes_fatal = parseNum(cellVal(colIndex.fatal));
      result.crashes_injury = parseNum(cellVal(colIndex.injury));
      result.crashes_tow = parseNum(cellVal(colIndex.tow));
      result.crashes_total = parseNum(cellVal(colIndex.total));
    }
  });

  return result;
}

/**
 * Parse a "checkbox" section from the SAFER snapshot page.
 *
 * Several sections (Operation Classification, Carrier Operation, Cargo Carried)
 * use a table with summary="<section name>" containing nested formatting tables.
 * Selected items are marked with "X" in the first <TD>, with the label in the
 * second <TD>.
 *
 * Returns a comma-separated string of selected items, or null if none found.
 */
function parseCheckboxSection($, summaryAttr) {
  const items = [];
  const table = $(`table[summary="${summaryAttr}"]`);
  if (!table.length) return null;

  table.find('tr').each((_i, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 2) {
      const marker = ($(cells[0]).text() || '').trim();
      const label = ($(cells[1]).text() || '').trim();
      if (marker === 'X' && label) {
        items.push(label);
      }
    }
  });

  return items.length > 0 ? items.join(', ') : null;
}

/**
 * Scrape the FMCSA SAFER Company Snapshot page for the given DOT number.
 * Returns a structured object with carrier data, or null if the carrier
 * was not found or the page could not be parsed.
 */
async function scrapeCompanySnapshot(dotNumber) {
  const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(dotNumber)}`;

  const html = await fetchWithRetry(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  // Detect "no results" pages
  const bodyText = $('body').text();
  if (
    bodyText.includes('No records matching') ||
    bodyText.includes('Invalid Search') ||
    bodyText.includes('0 records found') ||
    bodyText.includes('Record not found')
  ) {
    // Log first 300 chars for debugging
    console.error(
      `${LOG_PREFIX} No carrier found for DOT ${dotNumber} — page snippet: ${bodyText.substring(0, 300).replace(/\s+/g, ' ')}`
    );
    return null;
  }

  // If we got HTML but can't find any table data, log for debugging
  const tableCount = $('tr').length;
  if (tableCount < 3) {
    console.warn(
      `${LOG_PREFIX} DOT ${dotNumber}: page loaded but only ${tableCount} table rows found — possible CAPTCHA or block. Snippet: ${bodyText.substring(0, 200).replace(/\s+/g, ' ')}`
    );
  }

  // Build normalised label->value map
  const labelMap = buildLabelMap($);
  const find = (...frags) => findInMap(labelMap, ...frags);

  // --- Extract fields ---
  const data = {
    entity_type: find('entity type'),
    usdot_status: find('usdot status'),
    operating_status: find('operating authority status'),
    legal_name: find('legal name'),
    dba_name: find('dba name'),
    physical_address: find('physical address'),
    phone: find('phone'),
    dot_number: find('usdot number'),
    mc_mx_ff_numbers: find('mc/mx/ff number'),
    total_power_units: parseNum(find('power units')),
    total_drivers: parseNum(find('drivers')),
    out_of_service_date: parseDate(find('out of service date')),
    safety_rating: find('safety rating'),
    safety_rating_date: parseDate(find('safety rating date', 'rating date')),
  };

  // MCS-150 mileage field: "418,586 (2023)"
  const mileageRaw = find('mcs-150 mileage', 'mcs150 mileage');
  data.mcs150_mileage = null;
  data.mcs150_mileage_year = null;
  if (mileageRaw) {
    const mileageMatch = mileageRaw.match(
      /([0-9][0-9,]*)\s*\(?\s*(\d{4})\s*\)?/
    );
    if (mileageMatch) {
      data.mcs150_mileage = parseNum(mileageMatch[1]);
      data.mcs150_mileage_year = Number(mileageMatch[2]) || null;
    }
  }

  // --- Inspection table ---
  const inspections = parseInspectionTable($);
  Object.assign(data, inspections);

  // --- Crash table ---
  const crashes = parseCrashTable($);
  Object.assign(data, crashes);

  // --- Operation / Cargo checkbox sections ---
  data.operation_classification = parseCheckboxSection($, 'Operation Classification');
  data.carrier_operation = parseCheckboxSection($, 'Carrier Operation');
  data.cargo_carried = parseCheckboxSection($, 'Cargo Carried');

  return data;
}

// ---------------------------------------------------------------------------
// scrapeLicensingInsurance
// ---------------------------------------------------------------------------

/**
 * Scrape the FMCSA Licensing & Insurance (LI) page for authority and
 * insurance information. This is a SEPARATE page from the SAFER snapshot.
 */
async function scrapeLicensingInsurance(dotNumber) {
  const url = `https://li-public.fmcsa.dot.gov/LIVIEW/pkg_carrquery.prc_carrlist?n_dotno=${encodeURIComponent(dotNumber)}`;

  const html = await fetchWithRetry(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  const result = {
    authority_common: null,
    authority_contract: null,
    authority_broker: null,
    bipd_insurance_required: null,
    bipd_insurance_on_file: null,
    cargo_insurance_required: null,
    cargo_insurance_on_file: null,
    bond_insurance_required: null,
    bond_insurance_on_file: null,
  };

  // --- Authority types ---
  // The LI page shows authority rows with type and status columns.
  $('tr').each((_i, row) => {
    const cells = $(row).children('td, th');
    if (cells.length < 2) return;

    const firstCell = (clean($(cells[0]).text()) || '').toLowerCase();
    const secondCell = clean($(cells[1]).text()) || '';

    if (firstCell.includes('common')) {
      result.authority_common = secondCell;
    } else if (firstCell.includes('contract')) {
      result.authority_contract = secondCell;
    } else if (firstCell.includes('broker')) {
      result.authority_broker = secondCell;
    }
  });

  // --- Insurance data ---
  // Insurance section has rows: Type | Required | On File
  $('tr').each((_i, row) => {
    const cells = $(row).children('td, th');
    if (cells.length < 3) return;

    const label = (clean($(cells[0]).text()) || '').toLowerCase();
    const required = clean($(cells[1]).text());
    const onFile = clean($(cells[2]).text());

    if (label.includes('bipd') || label.includes('bodily injury')) {
      result.bipd_insurance_required = required;
      result.bipd_insurance_on_file = onFile;
    } else if (label.includes('cargo')) {
      result.cargo_insurance_required = required;
      result.cargo_insurance_on_file = onFile;
    } else if (
      label.includes('bond') ||
      label.includes('surety') ||
      label.includes('trust')
    ) {
      result.bond_insurance_required = required;
      result.bond_insurance_on_file = onFile;
    }
  });

  return result;
}

// ---------------------------------------------------------------------------
// scrapeSmsScores
// ---------------------------------------------------------------------------

/**
 * Scrape the FMCSA SMS pages for BASIC percentile scores.
 *
 * Tries the Complete SMS Profile page first (which has numeric percentiles),
 * then falls back to the Overview page. Scores marked "Not Public" return null.
 *
 * Returns an object with score keys, or null if the carrier was not found.
 */
async function scrapeSmsScores(dotNumber) {
  const encodedDot = encodeURIComponent(dotNumber);

  // Map of keywords to score keys
  const basicMapping = [
    { key: 'unsafe_driving', patterns: ['unsafe driving'] },
    {
      key: 'hos_compliance',
      patterns: ['hours-of-service', 'hours of service', 'hos compliance'],
    },
    {
      key: 'vehicle_maintenance',
      patterns: ['vehicle maintenance'],
    },
    {
      key: 'controlled_substances',
      patterns: ['controlled substances', 'controlled sub'],
    },
    {
      key: 'driver_fitness',
      patterns: ['driver fitness'],
    },
    {
      key: 'crash_indicator',
      patterns: ['crash indicator'],
    },
    {
      key: 'hazmat',
      patterns: ['hazardous materials', 'hazmat', 'hm compliance'],
    },
  ];

  const scores = {
    unsafe_driving: null,
    hos_compliance: null,
    vehicle_maintenance: null,
    controlled_substances: null,
    driver_fitness: null,
    crash_indicator: null,
    hazmat: null,
  };

  /**
   * Try to extract BASIC scores from an HTML page.
   * Returns true if at least one score was found.
   */
  function extractScoresFromHtml(html) {
    const $ = cheerio.load(html);
    let foundAny = false;

    // Strategy 1: Look for elements with data attributes or IDs referencing BASICs
    $(
      '[data-basic-name], [id*="Basic"], [id*="basic"], [class*="basic"], [class*="Basic"]'
    ).each((_i, el) => {
      const elText = $(el).text();
      const attrValue =
        $(el).attr('data-basic-name') ||
        $(el).attr('id') ||
        $(el).attr('class') ||
        '';
      const combined = (attrValue + ' ' + elText).toLowerCase();

      for (const mapping of basicMapping) {
        if (scores[mapping.key] !== null) continue;
        for (const pattern of mapping.patterns) {
          if (combined.includes(pattern)) {
            // Check for "Not Public" first
            if (combined.includes('not public')) break;
            const numMatch = elText.match(/(\d{1,3})(?:\s*%)?/);
            if (numMatch) {
              const val = parseInt(numMatch[1], 10);
              if (val >= 0 && val <= 100) {
                scores[mapping.key] = val;
                foundAny = true;
              }
            }
            break;
          }
        }
      }
    });

    // Strategy 2: Walk text elements looking for BASIC label + nearby percentage
    $('td, div, span, p, li, a, th').each((_i, el) => {
      const text = ($(el).text() || '').toLowerCase();
      for (const mapping of basicMapping) {
        if (scores[mapping.key] !== null) continue;
        for (const pattern of mapping.patterns) {
          if (!text.includes(pattern)) continue;

          // If "Not Public" appears with this BASIC name, skip it
          if (text.includes('not public')) break;

          // Look for a percentage number in this element's text
          const numMatch = text.match(/(\d{1,3})\s*%/);
          if (numMatch) {
            const val = parseInt(numMatch[1], 10);
            if (val >= 0 && val <= 100) {
              scores[mapping.key] = val;
              foundAny = true;
            }
          }

          // Also check next sibling for the score
          if (scores[mapping.key] === null) {
            const nextText = $(el).next().text() || '';
            if (nextText.toLowerCase().includes('not public')) break;
            const nextMatch = nextText.match(/(\d{1,3})\s*%?/);
            if (nextMatch) {
              const val = parseInt(nextMatch[1], 10);
              if (val >= 0 && val <= 100) {
                scores[mapping.key] = val;
                foundAny = true;
              }
            }
          }
          break;
        }
      }
    });

    // Strategy 3: Look for gauge/chart elements with score as style width or data attr
    $(
      '[class*="gauge"], [class*="Gauge"], [class*="score"], [class*="Score"], [class*="percent"], [class*="Percent"]'
    ).each((_i, el) => {
      const style = $(el).attr('style') || '';
      const widthMatch = style.match(/width:\s*(\d{1,3})%/);
      const dataScore =
        $(el).attr('data-score') ||
        $(el).attr('data-value') ||
        $(el).attr('data-percent');

      const scoreVal = dataScore
        ? parseNum(dataScore)
        : widthMatch
          ? parseInt(widthMatch[1], 10)
          : null;

      if (scoreVal === null || scoreVal < 0 || scoreVal > 100) return;

      const context = (
        $(el).parent().text() +
        ' ' +
        $(el).closest('tr, div, section').text()
      ).toLowerCase();

      for (const mapping of basicMapping) {
        if (scores[mapping.key] !== null) continue;
        for (const pattern of mapping.patterns) {
          if (context.includes(pattern)) {
            scores[mapping.key] = scoreVal;
            foundAny = true;
            break;
          }
        }
      }
    });

    return foundAny;
  }

  // --- Try Complete Profile page first (has numeric percentiles) ---
  const completeProfileUrl = `https://ai.fmcsa.dot.gov/SMS/Carrier/${encodedDot}/CompleteProfile.aspx`;
  const completeHtml = await fetchWithRetry(completeProfileUrl);

  if (completeHtml) {
    const bodyText = cheerio.load(completeHtml)('body').text();
    if (
      bodyText.includes('No carrier found') ||
      bodyText.includes('Invalid DOT') ||
      bodyText.includes('No records matching')
    ) {
      console.error(
        `${LOG_PREFIX} No SMS data found for DOT ${dotNumber}`
      );
      return null;
    }

    extractScoresFromHtml(completeHtml);
  }

  // --- Fall back to Overview page if any scores are still null ---
  const hasAllScores = Object.values(scores).every((v) => v !== null);
  if (!hasAllScores) {
    const overviewUrl = `https://ai.fmcsa.dot.gov/SMS/Carrier/${encodedDot}/Overview.aspx`;
    const overviewHtml = await fetchWithRetry(overviewUrl);

    if (overviewHtml) {
      const bodyText = cheerio.load(overviewHtml)('body').text();
      if (
        !bodyText.includes('No carrier found') &&
        !bodyText.includes('Invalid DOT') &&
        !bodyText.includes('No records matching')
      ) {
        extractScoresFromHtml(overviewHtml);
      } else if (!completeHtml) {
        // Both pages failed to find the carrier
        console.error(
          `${LOG_PREFIX} No SMS data found for DOT ${dotNumber}`
        );
        return null;
      }
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// scrapeAll
// ---------------------------------------------------------------------------

/**
 * Scrape SAFER snapshot, Licensing & Insurance, and SMS scores, then merge
 * them into a single object matching the `fmcsa_safety_snapshots` database
 * schema.
 */
async function scrapeAll(dotNumber) {
  const [snapshot, licensing, smsScores] = await Promise.all([
    scrapeCompanySnapshot(dotNumber),
    scrapeLicensingInsurance(dotNumber),
    scrapeSmsScores(dotNumber),
  ]);

  const raw = {
    snapshot: snapshot || null,
    licensing: licensing || null,
    sms_scores: smsScores || null,
  };

  return {
    // SMS Scores (null if "Not Public" or unavailable)
    unsafe_driving_score: smsScores?.unsafe_driving ?? null,
    hos_compliance_score: smsScores?.hos_compliance ?? null,
    vehicle_maintenance_score: smsScores?.vehicle_maintenance ?? null,
    controlled_substances_score: smsScores?.controlled_substances ?? null,
    driver_fitness_score: smsScores?.driver_fitness ?? null,
    crash_indicator_score: smsScores?.crash_indicator ?? null,
    hazmat_score: smsScores?.hazmat ?? null,

    // Licensing (from snapshot for operating/usdot status, LI page for authority)
    operating_status: snapshot?.operating_status ?? null,
    usdot_status: snapshot?.usdot_status ?? null,
    authority_common: licensing?.authority_common ?? null,
    authority_contract: licensing?.authority_contract ?? null,
    authority_broker: licensing?.authority_broker ?? null,

    // Insurance (from LI page)
    bipd_insurance_required: licensing?.bipd_insurance_required ?? null,
    bipd_insurance_on_file: licensing?.bipd_insurance_on_file ?? null,
    cargo_insurance_required: licensing?.cargo_insurance_required ?? null,
    cargo_insurance_on_file: licensing?.cargo_insurance_on_file ?? null,
    bond_insurance_required: licensing?.bond_insurance_required ?? null,
    bond_insurance_on_file: licensing?.bond_insurance_on_file ?? null,

    // Carrier Info (from snapshot)
    safety_rating: snapshot?.safety_rating ?? null,
    safety_rating_date: snapshot?.safety_rating_date ?? null,
    total_drivers: snapshot?.total_drivers ?? null,
    total_power_units: snapshot?.total_power_units ?? null,
    mcs150_mileage: snapshot?.mcs150_mileage ?? null,
    mcs150_mileage_year: snapshot?.mcs150_mileage_year ?? null,
    out_of_service_date: snapshot?.out_of_service_date ?? null,

    // Inspection data (from snapshot)
    vehicle_inspections: snapshot?.vehicle_inspections ?? null,
    driver_inspections: snapshot?.driver_inspections ?? null,
    hazmat_inspections: snapshot?.hazmat_inspections ?? null,
    iep_inspections: snapshot?.iep_inspections ?? null,
    vehicle_oos: snapshot?.vehicle_oos ?? null,
    driver_oos: snapshot?.driver_oos ?? null,
    hazmat_oos: snapshot?.hazmat_oos ?? null,
    vehicle_oos_rate: snapshot?.vehicle_oos_rate ?? null,
    driver_oos_rate: snapshot?.driver_oos_rate ?? null,
    hazmat_oos_rate: snapshot?.hazmat_oos_rate ?? null,
    vehicle_oos_national_avg: snapshot?.vehicle_oos_national_avg ?? null,
    driver_oos_national_avg: snapshot?.driver_oos_national_avg ?? null,
    hazmat_oos_national_avg: snapshot?.hazmat_oos_national_avg ?? null,

    // Crash data (from snapshot)
    crashes_fatal: snapshot?.crashes_fatal ?? null,
    crashes_injury: snapshot?.crashes_injury ?? null,
    crashes_tow: snapshot?.crashes_tow ?? null,
    crashes_total: snapshot?.crashes_total ?? null,

    // Operation & Cargo (from snapshot)
    operation_classification: snapshot?.operation_classification ?? null,
    carrier_operation: snapshot?.carrier_operation ?? null,
    cargo_carried: snapshot?.cargo_carried ?? null,

    // Raw
    raw_json: raw,
    source: 'safer_website',
  };
}

// ---------------------------------------------------------------------------
// SMS BASIC Detail Page Scraping
// ---------------------------------------------------------------------------

/**
 * All 7 BASIC categories and their URL slugs.
 */
const BASIC_CATEGORIES = [
  { name: 'UnsafeDriving', label: 'Unsafe Driving' },
  { name: 'CrashIndicator', label: 'Crash Indicator' },
  { name: 'HOSCompliance', label: 'Hours-of-Service Compliance' },
  { name: 'VehicleMaint', label: 'Vehicle Maintenance' },
  { name: 'DrugsAlcohol', label: 'Controlled Substances and Alcohol' },
  { name: 'HMCompliance', label: 'Hazardous Materials Compliance' },
  { name: 'DriverFitness', label: 'Driver Fitness' },
];

/**
 * Scrape a single SMS BASIC detail page.
 *
 * URL pattern: https://ai.fmcsa.dot.gov/SMS/Carrier/{DOT}/BASIC/{BasicName}.aspx
 *
 * Returns an object with:
 *   - basic_name, measure_value, percentile, threshold
 *   - safety_event_group, acute_critical_violations, investigation_results_text
 *   - record_period
 *   - measures_history: [{ snapshot_date, measure_value, history_value, release_type, release_id }]
 *   - violations: [{ violation_code, description, violation_count, oos_violation_count, severity_weight }]
 *   - inspections: [{ inspection_date, report_number, report_state, plate_number, plate_state, vehicle_type, severity_weight, time_weight, total_weight, violations: [...] }]
 *
 * Returns null if the page could not be fetched or carrier not found.
 */
async function scrapeBasicDetailPage(dotNumber, basicName) {
  const encodedDot = encodeURIComponent(dotNumber);
  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${encodedDot}/BASIC/${basicName}.aspx`;

  const html = await fetchWithRetry(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  // Detect "no data" pages
  const bodyText = $('body').text();
  if (
    bodyText.includes('No carrier found') ||
    bodyText.includes('Invalid DOT') ||
    bodyText.includes('No records matching')
  ) {
    console.warn(`${LOG_PREFIX} No SMS BASIC data for DOT ${dotNumber} / ${basicName}`);
    return null;
  }

  const result = {
    basic_name: basicName,
    measure_value: null,
    percentile: null,
    threshold: null,
    safety_event_group: null,
    acute_critical_violations: 0,
    investigation_results_text: null,
    record_period: null,
    measures_history: [],
    violations: [],
    inspections: [],
  };

  // --- resultData div has measure, percentile, threshold as data attributes ---
  const resultData = $('#resultData');
  if (resultData.length) {
    result.measure_value = parseNum(resultData.attr('data-measure'));
    result.percentile = parseNum(resultData.attr('data-percentile'));
    result.threshold = parseNum(resultData.attr('data-threshold'));
  }

  // --- Record period ---
  const periodText = clean($('.basicDates').text());
  if (periodText) {
    result.record_period = periodText;
  }

  // --- Safety Event Group ---
  const overviewBody = $('.overviewBody, .BASICOverview .overviewBody');
  if (overviewBody.length) {
    overviewBody.find('p').each((_i, el) => {
      const text = clean($(el).text());
      if (text && text.toLowerCase().includes('safety event group')) {
        // Extract after "Safety Event Group:"
        const match = text.match(/safety event group:\s*(.+)/i);
        result.safety_event_group = match ? match[1].trim() : text;
      }
    });
  }

  // --- Investigation Results ---
  const invSection = $('#InvestigationResults');
  if (invSection.length) {
    const invH4 = invSection.find('.rdHead h4');
    if (invH4.length) {
      const invText = clean(invH4.text());
      result.investigation_results_text = invText;
      // Extract count: "Unsafe Driving Acute/Critical Violations: 0"
      const countMatch = invText && invText.match(/:\s*(\d+)/);
      if (countMatch) {
        result.acute_critical_violations = parseInt(countMatch[1], 10);
      }
    }
  }

  // --- Carrier Measure Over Time (from #measureHist table) ---
  const measureTable = $('#measureHist');
  if (measureTable.length) {
    // Header row has <th> elements with data-snapshot-date, data-release-type, data-release-id
    const headers = [];
    measureTable.find('thead tr').last().find('th[data-snapshot-date]').each((_i, el) => {
      headers.push({
        snapshot_date: parseDate($(el).attr('data-snapshot-date')),
        release_type: $(el).attr('data-release-type') || null,
        release_id: parseNum($(el).attr('data-release-id')),
      });
    });

    // Trend row measures
    const trendMeasures = [];
    measureTable.find('tbody.trend tr.measure td').each((_i, el) => {
      trendMeasures.push(parseNum(clean($(el).text())));
    });

    // History row measures
    const histMeasures = [];
    measureTable.find('tbody.hist tr.measure td').each((_i, el) => {
      histMeasures.push(parseNum(clean($(el).text())));
    });

    for (let i = 0; i < headers.length; i++) {
      result.measures_history.push({
        snapshot_date: headers[i].snapshot_date,
        measure_value: trendMeasures[i] ?? null,
        history_value: histMeasures[i] ?? null,
        release_type: headers[i].release_type,
        release_id: headers[i].release_id,
      });
    }
  }

  // --- Violation Summary ---
  const violTable = $('#ViolationSummary table.smsEvents');
  if (violTable.length) {
    violTable.find('tbody.dataBody tr.violSummary').each((_i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 5) {
        result.violations.push({
          violation_code: clean($(cells[0]).text()),
          description: clean($(cells[1]).text()),
          violation_count: parseNum(clean($(cells[2]).text())),
          oos_violation_count: parseNum(clean($(cells[3]).text())),
          severity_weight: parseNum(clean($(cells[4]).text())),
        });
      }
    });
  }

  // --- Inspection History (loaded via AJAX endpoint) ---
  const inspections = await scrapeBasicInspections(dotNumber, basicName);
  if (inspections) {
    result.inspections = inspections;
  }

  return result;
}

/**
 * Scrape the inspection history for a BASIC detail page.
 * Inspections are loaded via a separate URL endpoint.
 *
 * URL: /SMS/Carrier/{DOT}/BASIC/{BasicName}/Inspections/WithViolations/InspDateDESC/1.aspx?UserType=Public
 */
async function scrapeBasicInspections(dotNumber, basicName) {
  const encodedDot = encodeURIComponent(dotNumber);
  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${encodedDot}/BASIC/${basicName}/Inspections/WithViolations/InspDateDESC/1.aspx?UserType=Public`;

  const html = await fetchWithRetry(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const inspections = [];

  const dataBody = $('tbody.dataBody');
  if (!dataBody.length) return [];

  let currentInspection = null;

  dataBody.find('tr').each((_i, row) => {
    const $row = $(row);

    if ($row.hasClass('inspection')) {
      // Save previous inspection
      if (currentInspection) {
        inspections.push(currentInspection);
      }

      const cells = $row.find('td');
      currentInspection = {
        inspection_date: parseDate(clean($(cells[0]).text())),
        report_number: clean($(cells[1]).text()),
        report_state: clean($(cells[2]).text()),
        plate_number: clean($(cells[3]).text()),
        plate_state: clean($(cells[4]).text()),
        vehicle_type: clean($(cells[5]).text()),
        severity_weight: parseNum(clean($(cells[6]).text())),
        time_weight: parseNum(clean($(cells[7]).text())),
        total_weight: cells.length > 8 ? parseNum(clean($(cells[8]).text())) : null,
        violations: [],
      };
    } else if ($row.hasClass('viol') && currentInspection) {
      // Violation row belongs to the current inspection
      const violDesc = clean($row.find('.violCodeDesc').text());
      const weight = parseNum(clean($row.find('td.weight').text()));

      if (violDesc) {
        // Parse "392.16-D State/Local Laws - ..." into code + description
        const codeMatch = violDesc.match(/^(\S+)\s+(.+)/);
        currentInspection.violations.push({
          code: codeMatch ? codeMatch[1] : null,
          description: codeMatch ? codeMatch[2] : violDesc,
          weight: weight,
        });
      }
    }
  });

  // Push the last inspection
  if (currentInspection) {
    inspections.push(currentInspection);
  }

  return inspections;
}

/**
 * Scrape all 7 BASIC detail pages for a given DOT number.
 * Returns an array of BASIC detail objects (one per category).
 * Skips categories where no data is available.
 */
async function scrapeAllBasicDetails(dotNumber) {
  const results = [];

  // Scrape sequentially to respect rate limits (each makes 2 HTTP requests)
  for (const category of BASIC_CATEGORIES) {
    try {
      const detail = await scrapeBasicDetailPage(dotNumber, category.name);
      if (detail) {
        results.push(detail);
      }
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Failed to scrape BASIC detail ${category.name} for DOT ${dotNumber}:`,
        err.message
      );
    }

    // Small delay between BASIC pages to avoid hammering the server
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return results;
}

module.exports = {
  scrapeCompanySnapshot,
  scrapeSmsScores,
  scrapeAll,
  scrapeBasicDetailPage,
  scrapeBasicInspections,
  scrapeAllBasicDetails,
  BASIC_CATEGORIES,
  // Exported for testing
  fetchWithRetry,
};
