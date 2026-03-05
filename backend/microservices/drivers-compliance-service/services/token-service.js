const crypto = require('crypto');

const TOKEN_BYTES = 32;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function hashToken(token) {
  if (!token) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

function tokensEqual(hash, token) {
  if (!hash || !token) return false;
  const computed = hashToken(token);
  return crypto.timingSafeEqual(Buffer.from(hash, 'utf8'), Buffer.from(computed, 'utf8'));
}

module.exports = {
  generateToken,
  hashToken,
  tokensEqual
};
