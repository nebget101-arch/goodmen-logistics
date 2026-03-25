/**
 * FN-219: Fix missing columns caused by competing migrations.
 *
 * Problem: Migration 20260324100200 added is_dot_regulated to
 * driver_past_employers but NOT contact_email/contact_fax/position_held.
 * Migration 20260324120000 then skipped its ALTER TABLE because
 * is_dot_regulated already existed.
 *
 * Also: driver_investigation_history_file was created with
 * related_employer_id (by 20260324100200) but the service queries
 * past_employer_id. We add past_employer_id as an alias column.
 */
exports.up = async function (knex) {
  // 1) Add missing columns to driver_past_employers
  const hasPE = await knex.schema.hasTable('driver_past_employers');
  if (hasPE) {
    const cols = [
      { name: 'contact_email', fn: (t) => t.text('contact_email') },
      { name: 'contact_fax', fn: (t) => t.text('contact_fax') },
      { name: 'position_held', fn: (t) => t.text('position_held') },
      { name: 'contact_name', fn: (t) => t.text('contact_name') },
      { name: 'contact_phone', fn: (t) => t.text('contact_phone') },
    ];

    for (const col of cols) {
      const exists = await knex.schema.hasColumn('driver_past_employers', col.name);
      if (!exists) {
        await knex.schema.alterTable('driver_past_employers', col.fn);
      }
    }
  }

  // 2) Fix driver_investigation_history_file: add past_employer_id if missing
  const hasHF = await knex.schema.hasTable('driver_investigation_history_file');
  if (hasHF) {
    const hasPastEmployerId = await knex.schema.hasColumn('driver_investigation_history_file', 'past_employer_id');
    if (!hasPastEmployerId) {
      // Check if related_employer_id exists (from the earlier migration)
      const hasRelatedEmployerId = await knex.schema.hasColumn('driver_investigation_history_file', 'related_employer_id');
      if (hasRelatedEmployerId) {
        // Rename related_employer_id -> past_employer_id
        await knex.raw('ALTER TABLE driver_investigation_history_file RENAME COLUMN related_employer_id TO past_employer_id');
      } else {
        // Just add the column
        await knex.schema.alterTable('driver_investigation_history_file', (t) => {
          t.uuid('past_employer_id');
        });
      }
    }

    // Also add description column if missing (earlier migration used 'summary' instead)
    const hasDescription = await knex.schema.hasColumn('driver_investigation_history_file', 'description');
    if (!hasDescription) {
      const hasSummary = await knex.schema.hasColumn('driver_investigation_history_file', 'summary');
      if (hasSummary) {
        await knex.raw('ALTER TABLE driver_investigation_history_file RENAME COLUMN summary TO description');
      } else {
        await knex.schema.alterTable('driver_investigation_history_file', (t) => {
          t.text('description');
        });
      }
    }

    // Add metadata column if missing
    const hasMetadata = await knex.schema.hasColumn('driver_investigation_history_file', 'metadata');
    if (!hasMetadata) {
      await knex.schema.alterTable('driver_investigation_history_file', (t) => {
        t.jsonb('metadata').defaultTo('{}');
      });
    }
  }
};

exports.down = async function () {
  // Corrective migration — no rollback needed
};
