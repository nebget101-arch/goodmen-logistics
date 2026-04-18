/**
 * FN-741 — Create load_ai_extractions cache table.
 *
 * Stores AI extraction results keyed by (tenant_id, SHA-256 pdf_hash).
 * Repeated uploads of the same PDF within the 7-day TTL return the cached
 * result immediately without an OpenAI API call.
 *
 * Schema
 *   id               UUID PK  (auto-generated)
 *   tenant_id        UUID NOT NULL
 *   pdf_hash         TEXT NOT NULL  (SHA-256 hex of raw PDF bytes)
 *   extracted_data   JSONB NOT NULL (full extractLoadFromPdf result)
 *   extraction_method TEXT         ('pdf-parse' | 'pdftotext' | 'vision' | ...)
 *   created_at       TIMESTAMPTZ DEFAULT now()
 *
 * Constraints
 *   UNIQUE (tenant_id, pdf_hash)  — one cached result per tenant+hash
 *   INDEX  (created_at)           — efficient TTL range scans
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('load_ai_extractions');
  if (hasTable) return;

  await knex.schema.createTable('load_ai_extractions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').notNullable();
    table.text('pdf_hash').notNullable();         // SHA-256 hex, 64 chars
    table.jsonb('extracted_data').notNullable();
    table.text('extraction_method').nullable();   // 'pdf-parse' | 'pdftotext' | 'vision' | null
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // One cached result per (tenant, pdf hash)
  await knex.raw(`
    ALTER TABLE load_ai_extractions
    ADD CONSTRAINT uq_load_ai_extractions_tenant_hash
    UNIQUE (tenant_id, pdf_hash)
  `);

  // Index on created_at for TTL range queries / nightly cleanup jobs
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_load_ai_extractions_created_at
    ON load_ai_extractions (created_at)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('load_ai_extractions');
};
