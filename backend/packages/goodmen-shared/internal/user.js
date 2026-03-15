const db = require('./db');

async function getUserByUsername(username) {
  const pool = db.pool;
  if (!pool) throw new Error('Database not set; call setDatabase() before using auth');
  const normalized = String(username || '').trim();
  const res = await pool.query(
    'SELECT * FROM users WHERE username = $1 OR LOWER(email) = LOWER($1) LIMIT 1',
    [normalized]
  );
  return res.rows[0];
}

module.exports = {
  getUserByUsername
};
