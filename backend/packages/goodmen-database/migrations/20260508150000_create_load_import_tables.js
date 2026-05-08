/**
 * FN-1589 — Create load_import_batches + load_import_rows tables.
 *
 * Backs the spreadsheet → loads import pipeline (FN-1584 epic):
 *   - load_import_batches: one row per uploaded CSV/XLSX file. Tracks
 *     the parse → stage → commit lifecycle, R2 storage key, AI column
 *     mapping + confidences, and post-commit summary counts.
 *   - load_import_rows: one row per source spreadsheet row. Stages raw
 *     + AI-normalized values, validation outcome, error messages, and
 *     the resulting load_id once a row is committed.
 *
 * FK conventions (per project rules):
 *   tenant_id           → tenants.id            ON DELETE RESTRICT  (hard ref)
 *   created_by          → users.id              ON DELETE RESTRICT  (hard ref)
 *   operating_entity_id → operating_entities.id ON DELETE SET NULL  (soft ref)
 *   resulting_load_id   → loads.id              ON DELETE SET NULL  (soft ref)
 *   batch_id            → load_import_batches.id ON DELETE CASCADE  (child rows
 *                                                                    die with parent)
 */
exports.up = async function (knex) {
  // ---- load_import_batches ----------------------------------------------
  const hasBatches = await knex.schema.hasTable('load_import_batches');
  if (!hasBatches) {
    await knex.schema.createTable('load_import_batches', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table
        .uuid('tenant_id')
        .notNullable()
        .references('id')
        .inTable('tenants')
        .onDelete('RESTRICT');
      table
        .uuid('operating_entity_id')
        .nullable()
        .references('id')
        .inTable('operating_entities')
        .onDelete('SET NULL');
      table.text('file_name').notNullable();
      table.text('file_hash').notNullable(); // SHA-256 hex, 64 chars
      table.bigInteger('file_size_bytes').nullable();
      table.text('storage_key').nullable(); // R2 object key
      table.integer('row_count').nullable();
      table.text('status').notNullable().defaultTo('pending');
      table.jsonb('ai_metadata').nullable();
      table.jsonb('result_summary').nullable();
      table
        .uuid('created_by')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT');
      table
        .timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
      table.timestamp('committed_at', { useTz: true }).nullable();
    });

    await knex.raw(`
      ALTER TABLE load_import_batches
      ADD CONSTRAINT chk_load_import_batches_status
      CHECK (status IN ('pending','parsing','staged','committing','committed','failed'))
    `);

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_load_import_batches_tenant_id
      ON load_import_batches (tenant_id)
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_load_import_batches_status
      ON load_import_batches (status)
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_load_import_batches_tenant_file_hash
      ON load_import_batches (tenant_id, file_hash)
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_load_import_batches_created_at
      ON load_import_batches (created_at)
    `);
  }

  // ---- load_import_rows -------------------------------------------------
  const hasRows = await knex.schema.hasTable('load_import_rows');
  if (!hasRows) {
    await knex.schema.createTable('load_import_rows', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table
        .uuid('batch_id')
        .notNullable()
        .references('id')
        .inTable('load_import_batches')
        .onDelete('CASCADE');
      table.integer('source_row_index').notNullable();
      table.jsonb('raw_values').notNullable();
      table.jsonb('normalized_values').nullable();
      table.text('validation_status').notNullable().defaultTo('pending');
      table.jsonb('error_messages').nullable();
      table.decimal('confidence_score', 4, 3).nullable();
      table
        .uuid('resulting_load_id')
        .nullable()
        .references('id')
        .inTable('loads')
        .onDelete('SET NULL');
      table
        .timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE load_import_rows
      ADD CONSTRAINT chk_load_import_rows_validation_status
      CHECK (validation_status IN ('pending','ok','needs_review','duplicate','error'))
    `);

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_load_import_rows_batch_id
      ON load_import_rows (batch_id)
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_load_import_rows_batch_validation
      ON load_import_rows (batch_id, validation_status)
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_load_import_rows_resulting_load_id
      ON load_import_rows (resulting_load_id)
      WHERE resulting_load_id IS NOT NULL
    `);
  }
};

exports.down = async function (knex) {
  // children first, then parent (rows reference batches)
  await knex.schema.dropTableIfExists('load_import_rows');
  await knex.schema.dropTableIfExists('load_import_batches');
};
