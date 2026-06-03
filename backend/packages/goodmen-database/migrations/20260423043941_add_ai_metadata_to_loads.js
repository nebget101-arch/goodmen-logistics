/**
 * FN-816 — Add ai_metadata JSONB column to loads.
 *
 * Stores AI extraction confidence payload for loads created from rate-con
 * uploads. Shape:
 *   {
 *     "overall_confidence": 0.92,
 *     "extracted_at": "2026-04-19T12:34:00Z",
 *     "source_document": "rate-con.pdf",
 *     "fields": { "broker_name": 0.98, "rate": 0.85, ... }
 *   }
 *
 * Additive and nullable: existing rows remain NULL and legacy (non-AI)
 * flows are unaffected. A GIN index supports per-field lookups such as
 * `WHERE ai_metadata->'fields' ? 'broker_name'`.
 */
exports.up = async function up(knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  const hasAiMetadata = await knex.schema.hasColumn('loads', 'ai_metadata');
  if (!hasAiMetadata) {
    await knex.schema.alterTable('loads', (table) => {
      table.jsonb('ai_metadata').nullable();
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_loads_ai_metadata
    ON loads USING GIN (ai_metadata)
  `);
};

exports.down = async function down(knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  await knex.raw('DROP INDEX IF EXISTS idx_loads_ai_metadata');

  const hasAiMetadata = await knex.schema.hasColumn('loads', 'ai_metadata');
  if (!hasAiMetadata) return;

  await knex.schema.alterTable('loads', (table) => {
    table.dropColumn('ai_metadata');
  });
};
