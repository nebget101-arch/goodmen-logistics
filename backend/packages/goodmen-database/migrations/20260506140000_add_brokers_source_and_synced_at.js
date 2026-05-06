'use strict';

/**
 * FN-1427: Distinguish manually-entered brokers from FMCSA-imported ones so the
 * authority sync can never clobber tenant-curated rows.
 *
 *   source            – 'manual' | 'fmcsa'  (default 'manual' so existing rows
 *                       are protected from the first sync)
 *   fmcsa_synced_at   – timestamptz; set by the sync job, NULL for manual rows.
 */

exports.up = async function up(knex) {
  const hasSource = await knex.schema.hasColumn('brokers', 'source');
  if (!hasSource) {
    await knex.schema.alterTable('brokers', (t) => {
      t.text('source').notNullable().defaultTo('manual');
    });
    // Existing rows pre-date this column — they were entered manually.
    await knex.raw("UPDATE brokers SET source = 'manual' WHERE source IS NULL");
    await knex.raw(
      "ALTER TABLE brokers ADD CONSTRAINT brokers_source_check CHECK (source IN ('manual', 'fmcsa'))",
    );
  }

  const hasSyncedAt = await knex.schema.hasColumn('brokers', 'fmcsa_synced_at');
  if (!hasSyncedAt) {
    await knex.schema.alterTable('brokers', (t) => {
      t.timestamp('fmcsa_synced_at', { useTz: true }).nullable();
    });
  }

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_broker_source ON brokers(source)');
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_broker_source');
  await knex.raw('ALTER TABLE brokers DROP CONSTRAINT IF EXISTS brokers_source_check');

  const hasSyncedAt = await knex.schema.hasColumn('brokers', 'fmcsa_synced_at');
  if (hasSyncedAt) {
    await knex.schema.alterTable('brokers', (t) => {
      t.dropColumn('fmcsa_synced_at');
    });
  }

  const hasSource = await knex.schema.hasColumn('brokers', 'source');
  if (hasSource) {
    await knex.schema.alterTable('brokers', (t) => {
      t.dropColumn('source');
    });
  }
};
