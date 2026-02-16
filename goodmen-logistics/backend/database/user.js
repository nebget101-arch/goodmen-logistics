const { pool } = require('../config/database');

// Get user by username
async function getUserByUsername(username) {
  const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return res.rows[0];
}

module.exports = {
  getUserByUsername
};
