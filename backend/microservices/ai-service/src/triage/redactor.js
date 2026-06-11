'use strict';

// Patterns that identify PII in free-text incident descriptions.
// Applied before the text is sent to the model.
const PATTERNS = [
  // Phone numbers (various formats)
  {
    re: /\b(\+?1[\s.-]?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/g,
    replacement: '[PHONE]'
  },
  // Email addresses
  {
    re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[EMAIL]'
  },
  // SSN (###-##-####)
  {
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[SSN]'
  },
  // Credit card numbers (16-digit blocks with optional separators)
  {
    re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: '[CARD]'
  },
  // Driver full name hints (e.g. "driver John Smith", "by Jane Doe")
  // Conservative: only redact when prefixed by a driver/person indicator keyword
  {
    re: /\b(?:driver|operator|customer|client|caller)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}/g,
    replacement: '[NAME]'
  }
];

/**
 * Scrub PII from a free-text incident description before it is sent to Claude.
 * Returns the cleaned string and a count of replacements made per category.
 */
function redact(text) {
  if (typeof text !== 'string') return { redacted: '', counts: {} };

  let result = text;
  const counts = {};

  for (const { re, replacement } of PATTERNS) {
    const category = replacement.replace(/[\[\]]/g, '').toLowerCase();
    let hits = 0;
    result = result.replace(re, () => {
      hits++;
      return replacement;
    });
    if (hits > 0) counts[category] = hits;
  }

  return { redacted: result, counts };
}

module.exports = { redact };
