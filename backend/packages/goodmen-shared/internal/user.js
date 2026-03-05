const db = require('./db');

async function getUserByUsername(username) {
  const pool = db.pool;
  if (!pool) throw new Error('Database not set; call setDatabase() before using auth');
  const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return res.rows[0];
}

module.exports = {
  getUserByUsername
};
