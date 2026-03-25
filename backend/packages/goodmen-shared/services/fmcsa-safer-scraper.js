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

// ---------------------------------------------------------------------------
// scrapeCompanySnapshot
// ---------------------------------------------------------------------------

/**
 * Scrape the FMCSA SAFER Company Snapshot page for the given DOT number.
 * Returns a structured object with carrier data, or null if the carrier
 * was not found or the page could not be parsed.
 */
async function scrapeCompanySnapshot(dotNumber) {
  const url = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=DOT_NUMBER&query_string=${encodeURIComponent(dotNumber)}`;

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
    console.error(`${LOG_PREFIX} No carrier found for DOT ${dotNumber} — page snippet: ${bodyText.substring(0, 300).replace(/\s+/g, ' ')}`);
    return null;
  }

  // If we got HTML but can't find any table data, log for debugging
  const tableCount = $('tr').length;
  if (tableCount < 3) {
    console.warn(`${LOG_PREFIX} DOT ${dotNumber}: page loaded but only ${tableCount} table rows found — possible CAPTCHA or block. Snippet: ${bodyText.substring(0, 200).replace(/\s+/g, ' ')}`);
  }

  // Build a label -> value map from all table cells.
  // The SAFER snapshot page uses <th> or <td> for labels and the next <td>
  // for values.  We walk every <tr> and pair up cells.
  const labelMap = {};

  $('tr').each((_i, row) => {
    const cells = $(row).children('td, th');
    if (cells.length < 2) return;

    // Iterate through cell pairs
    for (let c = 0; c < cells.length - 1; c++) {
      const labelText = clean($(cells[c]).text());
      if (!labelText) continue;

      // Normalise the label for lookup
      const key = labelText
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, '')
        .trim();

      const valueText = clean($(cells[c + 1]).text());
      if (key && valueText && !labelMap[key]) {
        labelMap[key] = valueText;
      }
    }
  });

  // Helper to look up a value by a set of possible label fragments
  function find(...fragments) {
    for (const frag of fragments) {
      const upper = frag.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
      for (const [key, val] of Object.entries(labelMap)) {
        if (key.includes(upper)) return val;
      }
    }
    return null;
  }

  // --- Extract fields ---
  const data = {
    entity_type: find('ENTITY TYPE'),
    operating_status: find('OPERATING STATUS'),
    legal_name: find('LEGAL NAME'),
    dba_name: find('DBA NAME', 'DOING BUSINESS AS'),
    physical_address: find('PHYSICAL ADDRESS'),
    phone: find('PHONE'),
    dot_number: find('DOT NUMBER', 'USDOT NUMBER', 'US DOT'),
    mc_mx_ff_numbers: find('MC/MX/FF', 'MCMXFF', 'MC MX FF'),
    total_power_units: parseNum(find('POWER UNITS')),
    total_drivers: parseNum(find('TOTAL DRIVERS', 'DRIVERS')),
    mcs150_mileage_raw: find('MCS150 MILEAGE', 'MCS-150 MILEAGE'),
    safety_rating: find('SAFETY RATING', 'SAFETY RATING'),
    safety_rating_date: parseDate(find('SAFETY RATING DATE', 'RATING DATE')),
    out_of_service_date: parseDate(find('OUT OF SERVICE DATE', 'OOS DATE')),
  };

  // MCS-150 mileage field often looks like "1,234,567 (Year: 2023)"
  data.mcs150_mileage = null;
  data.mcs150_mileage_year = null;
  if (data.mcs150_mileage_raw) {
    const mileageMatch = data.mcs150_mileage_raw.match(
      /([0-9][0-9,]*)\s*\(?\s*(?:Year)?:?\s*(\d{4})?\s*\)?/i
    );
    if (mileageMatch) {
      data.mcs150_mileage = parseNum(mileageMatch[1]);
      data.mcs150_mileage_year = mileageMatch[2]
        ? Number(mileageMatch[2])
        : null;
    }
  }

  // --- Authority types ---
  // The SAFER page shows authority rows with type and status columns.
  // We look for rows containing Common, Contract, Broker keywords.
  data.authority_common = null;
  data.authority_contract = null;
  data.authority_broker = null;

  $('tr').each((_i, row) => {
    const rowText = $(row).text();
    const cells = $(row).children('td, th');
    if (cells.length < 2) return;

    const firstCell = clean($(cells[0]).text()) || '';
    const secondCell = clean($(cells[1]).text()) || '';
    const upper = firstCell.toUpperCase();

    if (upper.includes('COMMON')) {
      data.authority_common = secondCell || find('COMMON AUTHORITY');
    } else if (upper.includes('CONTRACT')) {
      data.authority_contract = secondCell || find('CONTRACT AUTHORITY');
    } else if (upper.includes('BROKER')) {
      data.authority_broker = secondCell || find('BROKER AUTHORITY');
    }
  });

  // Fallback: try label map if authority fields are still null
  if (!data.authority_common)
    data.authority_common = find('COMMON AUTHORITY', 'COMMON');
  if (!data.authority_contract)
    data.authority_contract = find('CONTRACT AUTHORITY', 'CONTRACT');
  if (!data.authority_broker)
    data.authority_broker = find('BROKER AUTHORITY', 'BROKER');

  // --- Insurance data ---
  // Insurance section has rows: Type | Required | On File
  data.bipd_insurance_required = null;
  data.bipd_insurance_on_file = null;
  data.cargo_insurance_required = null;
  data.cargo_insurance_on_file = null;
  data.bond_insurance_required = null;
  data.bond_insurance_on_file = null;

  $('tr').each((_i, row) => {
    const cells = $(row).children('td, th');
    if (cells.length < 3) return;

    const label = (clean($(cells[0]).text()) || '').toUpperCase();
    const required = clean($(cells[1]).text());
    const onFile = clean($(cells[2]).text());

    if (label.includes('BIPD') || label.includes('BODILY INJURY')) {
      data.bipd_insurance_required = required;
      data.bipd_insurance_on_file = onFile;
    } else if (label.includes('CARGO')) {
      data.cargo_insurance_required = required;
      data.cargo_insurance_on_file = onFile;
    } else if (
      label.includes('BOND') ||
      label.includes('SURETY') ||
      label.includes('TRUST')
    ) {
      data.bond_insurance_required = required;
      data.bond_insurance_on_file = onFile;
    }
  });

  return data;
}

// ---------------------------------------------------------------------------
// scrapeSmsScores
// ---------------------------------------------------------------------------

/**
 * Scrape the FMCSA SMS Overview page for BASIC percentile scores.
 * Returns an object with score keys, or null if the page could not be fetched
 * or the carrier was not found.
 */
async function scrapeSmsScores(dotNumber) {
  const url = `https://ai.fmcsa.dot.gov/SMS/Carrier/${encodeURIComponent(dotNumber)}/Overview.aspx`;

  const html = await fetchWithRetry(url);
  if (!html) return null;

  const $ = cheerio.load(html);

  const bodyText = $('body').text();
  if (
    bodyText.includes('No carrier found') ||
    bodyText.includes('Invalid DOT') ||
    bodyText.includes('does not have enough') ||
    bodyText.includes('No records matching')
  ) {
    console.error(
      `${LOG_PREFIX} No SMS data found for DOT ${dotNumber}`
    );
    return null;
  }

  // The SMS Overview page presents BASIC scores in various HTML patterns.
  // Common patterns:
  //  1. Elements with data-basic-name or specific IDs
  //  2. Gauge/bar elements with percentile values
  //  3. Text labels followed by percentage values
  //  4. Structured divs with class names referencing BASIC categories

  const scores = {
    unsafe_driving: null,
    hos_compliance: null,
    vehicle_maintenance: null,
    controlled_substances: null,
    driver_fitness: null,
    crash_indicator: null,
    hazmat: null,
  };

  // Map of keywords to score keys
  const basicMapping = [
    { key: 'unsafe_driving', patterns: ['unsafe driving', 'unsafe driv'] },
    {
      key: 'hos_compliance',
      patterns: [
        'hours-of-service',
        'hours of service',
        'hos compliance',
        'hos',
      ],
    },
    {
      key: 'vehicle_maintenance',
      patterns: ['vehicle maintenance', 'vehicle maint'],
    },
    {
      key: 'controlled_substances',
      patterns: [
        'controlled substances',
        'controlled sub',
        'drug',
        'alcohol',
      ],
    },
    {
      key: 'driver_fitness',
      patterns: ['driver fitness', 'driver fit'],
    },
    {
      key: 'crash_indicator',
      patterns: ['crash indicator', 'crash'],
    },
    {
      key: 'hazmat',
      patterns: [
        'hazardous materials',
        'hazmat',
        'hm compliance',
      ],
    },
  ];

  // Strategy 1: Look for elements with data attributes or IDs containing BASIC names
  $('[data-basic-name], [id*="Basic"], [id*="basic"], [class*="basic"], [class*="Basic"]').each(
    (_i, el) => {
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
            // Try to extract a number from this element or adjacent elements
            const numMatch = elText.match(/(\d{1,3})(?:\s*%)?/);
            if (numMatch) {
              const val = parseInt(numMatch[1], 10);
              if (val >= 0 && val <= 100) {
                scores[mapping.key] = val;
              }
            }
            break;
          }
        }
      }
    }
  );

  // Strategy 2: Walk all text nodes looking for BASIC label + nearby percentage
  $('td, div, span, p, li, a').each((_i, el) => {
    const text = ($(el).text() || '').toLowerCase();
    for (const mapping of basicMapping) {
      if (scores[mapping.key] !== null) continue;
      for (const pattern of mapping.patterns) {
        if (!text.includes(pattern)) continue;
        // Look for a percentage number in this element's text
        const numMatch = text.match(/(\d{1,3})\s*%/);
        if (numMatch) {
          const val = parseInt(numMatch[1], 10);
          if (val >= 0 && val <= 100) {
            scores[mapping.key] = val;
          }
        }
        // Also check next sibling or parent for the score
        if (scores[mapping.key] === null) {
          const nextText = $(el).next().text() || '';
          const nextMatch = nextText.match(/(\d{1,3})\s*%?/);
          if (nextMatch) {
            const val = parseInt(nextMatch[1], 10);
            if (val >= 0 && val <= 100) {
              scores[mapping.key] = val;
            }
          }
        }
        break;
      }
    }
  });

  // Strategy 3: Look for gauge/chart elements that encode the score as a style width
  // or as a data attribute
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

    // Try to associate with a BASIC category via parent or sibling text
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
          break;
        }
      }
    }
  });

  return scores;
}

// ---------------------------------------------------------------------------
// scrapeAll
// ---------------------------------------------------------------------------

/**
 * Scrape both SAFER snapshot and SMS scores, then merge them into a single
 * object matching the `fmcsa_safety_snapshots` database schema.
 */
async function scrapeAll(dotNumber) {
  const [snapshot, smsScores] = await Promise.all([
    scrapeCompanySnapshot(dotNumber),
    scrapeSmsScores(dotNumber),
  ]);

  const raw = {
    snapshot: snapshot || null,
    sms_scores: smsScores || null,
  };

  return {
    // SMS Scores
    unsafe_driving_score: smsScores?.unsafe_driving ?? null,
    hos_compliance_score: smsScores?.hos_compliance ?? null,
    vehicle_maintenance_score: smsScores?.vehicle_maintenance ?? null,
    controlled_substances_score: smsScores?.controlled_substances ?? null,
    driver_fitness_score: smsScores?.driver_fitness ?? null,
    crash_indicator_score: smsScores?.crash_indicator ?? null,
    hazmat_score: smsScores?.hazmat ?? null,

    // Licensing
    operating_status: snapshot?.operating_status ?? null,
    authority_common: snapshot?.authority_common ?? null,
    authority_contract: snapshot?.authority_contract ?? null,
    authority_broker: snapshot?.authority_broker ?? null,

    // Insurance
    bipd_insurance_required: snapshot?.bipd_insurance_required ?? null,
    bipd_insurance_on_file: snapshot?.bipd_insurance_on_file ?? null,
    cargo_insurance_required: snapshot?.cargo_insurance_required ?? null,
    cargo_insurance_on_file: snapshot?.cargo_insurance_on_file ?? null,
    bond_insurance_required: snapshot?.bond_insurance_required ?? null,
    bond_insurance_on_file: snapshot?.bond_insurance_on_file ?? null,

    // Carrier Info
    safety_rating: snapshot?.safety_rating ?? null,
    safety_rating_date: snapshot?.safety_rating_date ?? null,
    total_drivers: snapshot?.total_drivers ?? null,
    total_power_units: snapshot?.total_power_units ?? null,
    mcs150_mileage: snapshot?.mcs150_mileage ?? null,
    mcs150_mileage_year: snapshot?.mcs150_mileage_year ?? null,
    out_of_service_date: snapshot?.out_of_service_date ?? null,

    // Raw
    raw_json: raw,
    source: 'safer_website',
  };
}

module.exports = {
  scrapeCompanySnapshot,
  scrapeSmsScores,
  scrapeAll,
  // Exported for testing
  fetchWithRetry,
};
