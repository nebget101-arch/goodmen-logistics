const db = require('./db');

let usersColumnNamesPromise = null;

async function getUsersColumnNames(pool) {
  if (!usersColumnNamesPromise) {
    usersColumnNamesPromise = pool
      .query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'`
      )
      .then((result) => new Set(result.rows.map((row) => row.column_name)))
      .catch((error) => {
        usersColumnNamesPromise = null;
        throw error;
      });
  }

  return usersColumnNamesPromise;
}

async function getUserByUsername(username) {
  const pool = db.pool;
  if (!pool) throw new Error('Database not set; call setDatabase() before using auth');
  const normalized = String(username || '').trim();
  const columnNames = await getUsersColumnNames(pool);
  const whereClauses = ['username = $1'];

  if (columnNames.has('email')) {
    whereClauses.push('LOWER(email) = LOWER($1)');
  }

  const res = await pool.query(
    `SELECT * FROM users WHERE ${whereClauses.join(' OR ')} LIMIT 1`,
    [normalized]
  );
  return res.rows[0];
}

module.exports = {
  getUserByUsername
};
