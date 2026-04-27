'use strict';

/**
 * FN-985: Seed QA smoke user on dev for Playwright globalSetup.
 *
 * Idempotent: safe to re-run. Reads QA_SMOKE_USER and QA_SMOKE_PASSWORD from
 * env at migrate time. If either is missing (e.g. on environments where the
 * smoke suite is not configured), the user-seed step is skipped without
 * failing the migration. The is_test column is still ensured so billing/usage
 * reports can filter out QA accounts wherever they are seeded.
 *
 * Password hashing uses bcrypt cost 10 to match the auth service
 * (backend/packages/goodmen-shared/routes/auth.js, auth-users-service/routes/users.js,
 * scripts/reset-user-password.js — all use bcrypt.hash(pw, 10)).
 */

const bcrypt = require('bcrypt');

const BCRYPT_COST = 10;
const LEGACY_FULL_ACCESS_ROLE = 'admin';
const RBAC_FULL_ACCESS_ROLE_CODE = 'super_admin';

async function ensureIsTestColumn(knex) {
  const hasIsTest = await knex.schema.hasColumn('users', 'is_test');
  if (!hasIsTest) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('is_test').notNullable().defaultTo(false);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_users_is_test ON users(is_test)');
  }
}

async function upsertQaSmokeUser(knex, email, password) {
  const username = email;
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const existing = await knex('users')
    .whereRaw('LOWER(email) = ?', [email.toLowerCase()])
    .orWhere({ username })
    .first();

  let userId;
  if (existing) {
    userId = existing.id;
    const update = {
      username,
      email,
      password_hash: passwordHash,
      role: LEGACY_FULL_ACCESS_ROLE,
      is_test: true
    };
    if (await knex.schema.hasColumn('users', 'is_active')) update.is_active = true;
    if (await knex.schema.hasColumn('users', 'first_name') && !existing.first_name) update.first_name = 'QA';
    if (await knex.schema.hasColumn('users', 'last_name') && !existing.last_name) update.last_name = 'Smoke';
    await knex('users').where({ id: userId }).update(update);
  } else {
    const insert = {
      username,
      email,
      password_hash: passwordHash,
      role: LEGACY_FULL_ACCESS_ROLE,
      is_test: true
    };
    if (await knex.schema.hasColumn('users', 'is_active')) insert.is_active = true;
    if (await knex.schema.hasColumn('users', 'first_name')) insert.first_name = 'QA';
    if (await knex.schema.hasColumn('users', 'last_name')) insert.last_name = 'Smoke';
    const [row] = await knex('users').insert(insert).returning('id');
    userId = typeof row === 'object' ? row.id : row;
  }

  return userId;
}

async function ensureSuperAdminMapping(knex, userId) {
  const hasRoles = await knex.schema.hasTable('roles');
  const hasUserRoles = await knex.schema.hasTable('user_roles');
  if (!hasRoles || !hasUserRoles) return;

  const role = await knex('roles').where({ code: RBAC_FULL_ACCESS_ROLE_CODE }).first();
  if (!role) {
    console.warn(`[FN-985] role '${RBAC_FULL_ACCESS_ROLE_CODE}' not found — RBAC mapping skipped. Run RBAC seed first.`);
    return;
  }

  const exists = await knex('user_roles').where({ user_id: userId, role_id: role.id }).first();
  if (!exists) {
    await knex('user_roles').insert({ user_id: userId, role_id: role.id });
  }
}

exports.up = async function up(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) {
    console.warn('[FN-985] users table not found — skipping QA smoke user seed.');
    return;
  }

  await ensureIsTestColumn(knex);

  const email = process.env.QA_SMOKE_USER;
  const password = process.env.QA_SMOKE_PASSWORD;
  if (!email || !password) {
    console.warn('[FN-985] QA_SMOKE_USER / QA_SMOKE_PASSWORD not set — skipping seed (column ensured).');
    return;
  }

  const userId = await upsertQaSmokeUser(knex, email, password);
  await ensureSuperAdminMapping(knex, userId);
  console.log(`[FN-985] QA smoke user '${email}' seeded (is_test=true, role=${LEGACY_FULL_ACCESS_ROLE}+${RBAC_FULL_ACCESS_ROLE_CODE}).`);
};

exports.down = async function down(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) return;

  const email = process.env.QA_SMOKE_USER;
  if (!email) return;

  const user = await knex('users').whereRaw('LOWER(email) = ?', [email.toLowerCase()]).first();
  if (!user) return;

  const hasUserRoles = await knex.schema.hasTable('user_roles');
  if (hasUserRoles) {
    await knex('user_roles').where({ user_id: user.id }).delete();
  }
  await knex('users').where({ id: user.id }).delete();
};
