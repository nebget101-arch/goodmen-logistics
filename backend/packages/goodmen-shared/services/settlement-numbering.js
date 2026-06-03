const { randomUUID } = require('crypto');

function sanitizeSettlementNumberToken(value, fallback = 'UNKNOWN') {
  const raw = (value || '').toString().trim();
  if (!raw) return fallback;
  return raw
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || fallback;
}

function buildUniqueSettlementNumber(prefix, parts = []) {
  const uniqueToken = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  return [prefix, ...(Array.isArray(parts) ? parts : []), uniqueToken]
    .map((part) => sanitizeSettlementNumberToken(part, 'UNKNOWN'))
    .filter(Boolean)
    .join('-');
}

function isSettlementNumberConflict(error) {
  const message = (error?.message || '').toString();
  return error?.code === '23505' && (
    error?.constraint === 'idx_settlements_number'
    || message.includes('idx_settlements_number')
  );
}

async function insertSettlementWithRetry(knex, payloadFactory, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 5);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await payloadFactory(attempt);
      const [settlement] = await knex('settlements')
        .insert(payload)
        .returning('*');
      return settlement;
    } catch (error) {
      if (!isSettlementNumberConflict(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw new Error('Failed to generate a unique settlement number');
}

module.exports = {
  buildUniqueSettlementNumber,
  insertSettlementWithRetry,
  isSettlementNumberConflict,
  sanitizeSettlementNumberToken
};
