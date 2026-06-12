'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * FN-1730: Regression tests for getUserByUsername login resolution.
 *
 * Reproduces the trial-signup → login failure: a trial admin is created with a
 * lowercased, possibly uniqueness-mutated username. Login must resolve the
 * typed identifier deterministically to the correct account so bcrypt.compare
 * runs against the right hash. Before the fix, username matching was
 * case-sensitive and the username/email OR-match with LIMIT 1 (no ordering)
 * could resolve to a different row.
 *
 * The DB is stubbed with a fake pg pool injected via setDatabase(); the pool
 * emulates the WHERE matching so the JS resolution logic is exercised directly.
 */

const shared = require('../index');

const USERS_COLUMNS = ['id', 'username', 'email', 'password_hash', 'is_active', 'role', 'tenant_id'];

function makePool(rows, { columns = USERS_COLUMNS } = {}) {
  const columnSet = new Set(columns);
  return {
    async query(sql, params) {
      if (/information_schema/i.test(sql)) {
        return { rows: columns.map((c) => ({ column_name: c })) };
      }
      // Emulate: WHERE LOWER(username) = LOWER($1) [OR LOWER(email) = LOWER($1)]
      const id = String(params[0]).toLowerCase();
      const matched = rows.filter((r) => {
        if (String(r.username || '').toLowerCase() === id) return true;
        if (columnSet.has('email') && String(r.email || '').toLowerCase() === id) return true;
        return false;
      });
      return { rows: matched };
    }
  };
}

function loadUserDb(rows, opts) {
  // Re-require fresh so the cached column-names promise doesn't leak the pool
  // from a prior test (the cache keys on nothing but pool identity).
  delete require.cache[require.resolve('./user')];
  shared.setDatabase({ pool: makePool(rows, opts), query: null, getClient: null, knex: null });
  return require('./user');
}

describe('getUserByUsername (FN-1730 login resolution)', () => {
  it('resolves by username with the exact (lowercased) value set at signup', async () => {
    const userDb = loadUserDb([
      { id: 1, username: 'john.smith', email: 'john@acme.com', password_hash: 'hash1' }
    ]);
    const user = await userDb.getUserByUsername('john.smith');
    assert.equal(user.id, 1);
  });

  it('resolves by email', async () => {
    const userDb = loadUserDb([
      { id: 1, username: 'john.smith', email: 'john@acme.com', password_hash: 'hash1' }
    ]);
    const user = await userDb.getUserByUsername('john@acme.com');
    assert.equal(user.id, 1);
  });

  it('matches the username case-insensitively (user typed different casing)', async () => {
    const userDb = loadUserDb([
      { id: 1, username: 'john.smith', email: 'john@acme.com', password_hash: 'hash1' }
    ]);
    const user = await userDb.getUserByUsername('John.Smith');
    assert.equal(user.id, 1, 'casing should not prevent resolution');
  });

  it('matches an uppercased email case-insensitively', async () => {
    const userDb = loadUserDb([
      { id: 1, username: 'john.smith', email: 'john@acme.com', password_hash: 'hash1' }
    ]);
    const user = await userDb.getUserByUsername('JOHN@ACME.COM');
    assert.equal(user.id, 1);
  });

  it('prefers the username match over a different row that collides by email', async () => {
    // Row 2 was created earlier with username "trial". A new trial admin (row 9)
    // happens to have email "trial@acme.com". Logging in by the username "trial"
    // must resolve to row 2 (the username owner), not row 9.
    const userDb = loadUserDb([
      { id: 9, username: 'acme.admin', email: 'trial@acme.com', password_hash: 'hash9' },
      { id: 2, username: 'trial', email: 'someone@else.com', password_hash: 'hash2' }
    ]);
    const user = await userDb.getUserByUsername('trial');
    assert.equal(user.id, 2, 'username owner must win over an email collision');
    assert.equal(user.password_hash, 'hash2');
  });

  it('returns the single matching row when only one matches', async () => {
    const userDb = loadUserDb([
      { id: 5, username: 'solo', email: 'solo@acme.com', password_hash: 'h5' }
    ]);
    const user = await userDb.getUserByUsername('solo');
    assert.equal(user.id, 5);
  });

  it('returns undefined for a blank identifier without querying', async () => {
    const userDb = loadUserDb([
      { id: 1, username: 'john.smith', email: 'john@acme.com', password_hash: 'hash1' }
    ]);
    assert.equal(await userDb.getUserByUsername(''), undefined);
    assert.equal(await userDb.getUserByUsername('   '), undefined);
  });

  it('returns undefined when nothing matches', async () => {
    const userDb = loadUserDb([
      { id: 1, username: 'john.smith', email: 'john@acme.com', password_hash: 'hash1' }
    ]);
    assert.equal(await userDb.getUserByUsername('nobody'), undefined);
  });
});
