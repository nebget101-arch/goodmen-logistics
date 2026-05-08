'use strict';

/**
 * FN-1489: Match invoice line SKUs against the `parts` table.
 *
 * Returns a Map keyed by the *original input SKU* (preserving caller casing/spacing
 * so handlers can correlate back to extracted lines), valued by
 * `{ partId, sku, name }` or undefined when no match exists.
 *
 * Matching is case-insensitive and ignores surrounding whitespace; collisions
 * between distinct rows that normalize to the same key are resolved by the
 * first row Postgres returns (deterministic ordering not promised — this is a
 * best-effort match and the UI lets users override).
 */

const DEFAULT_BATCH = 200;

function normalizeSku(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

async function matchSkus({ pool, skus, batchSize = DEFAULT_BATCH }) {
  const result = new Map();
  if (!pool || !Array.isArray(skus) || skus.length === 0) {
    return result;
  }

  const normalized = new Map();
  for (const raw of skus) {
    const norm = normalizeSku(raw);
    if (norm && !normalized.has(norm)) {
      normalized.set(norm, raw);
    }
  }
  if (normalized.size === 0) return result;

  const keys = Array.from(normalized.keys());

  for (let offset = 0; offset < keys.length; offset += batchSize) {
    const slice = keys.slice(offset, offset + batchSize);
    const placeholders = slice.map((_, i) => `$${i + 1}`).join(',');
    const sql = `SELECT id, sku, name FROM parts WHERE UPPER(sku) IN (${placeholders})`;
    const { rows } = await pool.query(sql, slice);
    for (const row of rows) {
      const norm = normalizeSku(row.sku);
      if (!norm) continue;
      const inputSku = normalized.get(norm);
      if (!inputSku) continue;
      result.set(inputSku, {
        partId: row.id,
        sku: row.sku,
        name: row.name
      });
    }
  }

  return result;
}

module.exports = {
  matchSkus,
  normalizeSku
};
