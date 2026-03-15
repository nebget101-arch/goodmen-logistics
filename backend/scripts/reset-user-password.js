#!/usr/bin/env node
'use strict';

const path = require('path');
const requireFromRoot = require(path.join(__dirname, '..', 'packages', 'goodmen-shared', 'internal', 'require-from-root'));
const bcrypt = requireFromRoot('bcrypt');
const db = require(path.join(__dirname, '..', 'packages', 'goodmen-shared', 'config', 'database'));

async function main() {
  const identifier = String(process.argv[2] || '').trim();
  const newPassword = String(process.argv[3] || '').trim();

  if (!identifier || !newPassword) {
    console.error('Usage: node backend/scripts/reset-user-password.js <username-or-email> <new-password>');
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const result = await db.query(
    `UPDATE users
     SET password_hash = $2, updated_at = NOW()
     WHERE username = $1 OR LOWER(email) = LOWER($1)
     RETURNING id, username, email`,
    [identifier, passwordHash]
  );

  if (!result.rows.length) {
    console.error('No user found for that username/email.');
    process.exit(1);
  }

  const user = result.rows[0];
  console.log(`Password reset for user ${user.username} (${user.email || 'no-email'})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to reset password:', err.message || err);
    process.exit(1);
  });
