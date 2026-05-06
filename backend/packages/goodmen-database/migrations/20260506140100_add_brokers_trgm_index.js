'use strict';

/**
 * FN-1427: Trigram (GIN) indexes for fuzzy broker search.
 *
 * The broker list endpoint uses `ILIKE '%term%'` on legal_name, dba_name, and
 * mc_number. Sequential scans are fine on dev, but with the FMCSA sync the
 * `brokers` table will grow to hundreds of thousands of active broker
 * authorities — pg_trgm GIN indexes keep `/api/brokers?q=` fast at scale.
 *
 * pg_trgm is created if missing (also created by the fmcsa schema migration,
 * so this is idempotent). gin_trgm_ops is the operator class needed for
 * substring + ILIKE acceleration.
 */

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS brokers_legal_name_trgm_idx ON brokers USING gin (legal_name gin_trgm_ops)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS brokers_dba_name_trgm_idx ON brokers USING gin (dba_name gin_trgm_ops)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS brokers_mc_number_trgm_idx ON brokers USING gin (mc_number gin_trgm_ops)',
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS brokers_mc_number_trgm_idx');
  await knex.raw('DROP INDEX IF EXISTS brokers_dba_name_trgm_idx');
  await knex.raw('DROP INDEX IF EXISTS brokers_legal_name_trgm_idx');
  // Leave pg_trgm in place — other parts of the app (fmcsa schema) depend on it.
};
