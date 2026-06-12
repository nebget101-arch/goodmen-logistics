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

/**
 * Resolve a user by the login identifier they typed, which may be either a
 * username or an email address.
 *
 * FN-1730: the identifier match must be deterministic. Trial-signup usernames
 * are normalized to lowercase and may be uniqueness-mutated (a suffix appended
 * on collision), so the username surfaced to the user at signup is the source
 * of truth. Two problems made login fail:
 *   1. `username = $1` was case-sensitive, so a user typing their username with
 *      different casing than the stored (lowercased) value matched no row.
 *   2. `username = $1 OR LOWER(email) = LOWER($1)` with `LIMIT 1` and no ordering
 *      could resolve to a *different* row when the typed value matched one row by
 *      username and another by email — `bcrypt.compare` then ran against the wrong
 *      hash and returned "Invalid credentials".
 *
 * Fix: match username case-insensitively and, when more than one row matches,
 * resolve in JS with a stable preference order — exact username, then
 * case-insensitive username, then email — so the typed identifier always lands
 * on the intended account.
 */
async function getUserByUsername(username) {
  const pool = db.pool;
  if (!pool) throw new Error('Database not set; call setDatabase() before using auth');
  const normalized = String(username || '').trim();
  if (!normalized) return undefined;

  const columnNames = await getUsersColumnNames(pool);
  const hasEmail = columnNames.has('email');
  const whereClauses = ['LOWER(username) = LOWER($1)'];

  if (hasEmail) {
    whereClauses.push('LOWER(email) = LOWER($1)');
  }

  const res = await pool.query(
    `SELECT * FROM users WHERE ${whereClauses.join(' OR ')}`,
    [normalized]
  );
  const rows = res.rows || [];
  if (rows.length <= 1) return rows[0];

  const lower = normalized.toLowerCase();
  return (
    rows.find((r) => r.username === normalized)
    || rows.find((r) => String(r.username || '').toLowerCase() === lower)
    || (hasEmail ? rows.find((r) => String(r.email || '').toLowerCase() === lower) : undefined)
    || rows[0]
  );
}

module.exports = {
  getUserByUsername
};
