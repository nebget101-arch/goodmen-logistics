/**
 * Drop NOT NULL on parts.category so the Quick Add Invoice flow can save
 * line items the AI vision pipeline did not classify. The original schema
 * (20260216_create_inventory_schema.js) declared the column notNullable().
 * No default is introduced — empty stays empty so the UI decides how to render.
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('parts');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('parts', 'category');
  if (!hasColumn) return;

  await knex.raw(`
    ALTER TABLE parts
    ALTER COLUMN category DROP NOT NULL
  `);
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('parts');
  if (!hasTable) return;

  // Backfill any rows that were inserted with NULL while the constraint was relaxed.
  await knex.raw(`
    UPDATE parts SET category = 'Uncategorized' WHERE category IS NULL
  `);

  await knex.raw(`
    ALTER TABLE parts
    ALTER COLUMN category SET NOT NULL
  `);
};
