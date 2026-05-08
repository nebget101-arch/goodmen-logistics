// FN-1507 — adds mechanic_user_id to work_order_labor_items
// Backend already references this column in services/work-orders.service.js
// (SELECT/JOIN, INSERT, UPDATE) but the column was never added, causing
// GET 500 and PUT 400 on work-order detail/save flows. See parent FN-1506.

exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('work_order_labor_items', 'mechanic_user_id');
  if (!hasColumn) {
    await knex.schema.alterTable('work_order_labor_items', (table) => {
      table.uuid('mechanic_user_id').nullable();
    });
  }

  // FK guarded — Postgres has no ADD CONSTRAINT IF NOT EXISTS
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'work_order_labor_items_mechanic_user_id_foreign'
      ) THEN
        ALTER TABLE work_order_labor_items
          ADD CONSTRAINT work_order_labor_items_mechanic_user_id_foreign
          FOREIGN KEY (mechanic_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END$$;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS work_order_labor_items_mechanic_user_id_idx
      ON work_order_labor_items(mechanic_user_id);
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS work_order_labor_items_mechanic_user_id_idx;');
  await knex.raw('ALTER TABLE work_order_labor_items DROP CONSTRAINT IF EXISTS work_order_labor_items_mechanic_user_id_foreign;');
  const hasColumn = await knex.schema.hasColumn('work_order_labor_items', 'mechanic_user_id');
  if (hasColumn) {
    await knex.schema.alterTable('work_order_labor_items', (table) => {
      table.dropColumn('mechanic_user_id');
    });
  }
};
