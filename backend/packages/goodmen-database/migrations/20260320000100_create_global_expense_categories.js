'use strict';

const STANDARD_CATEGORIES = [
  { code: 3, parent_code: null, persistent: true, name: 'Detention', active: true, type: 'revenue', description: '', notes: null },
  { code: 2, parent_code: null, persistent: true, name: 'Lumper', active: true, type: 'revenue', description: '', notes: null },
  { code: 98, parent_code: null, persistent: true, name: 'Other', active: true, type: 'revenue', description: '', notes: null },
  { code: 1009, parent_code: null, persistent: false, name: '2290 Highway tax', active: true, type: 'expense', description: '', notes: null },
  { code: 1000, parent_code: null, persistent: false, name: 'Advance Pay', active: true, type: 'expense', description: '', notes: null },
  { code: 1003, parent_code: 11, persistent: false, name: 'Down payment', active: true, type: 'expense', description: 'Sub-account of Insurance', notes: null },
  { code: 27, parent_code: null, persistent: true, name: 'Driver payments', active: true, type: 'expense', description: '', notes: null },
  { code: 1008, parent_code: null, persistent: false, name: 'ELD', active: true, type: 'expense', description: '', notes: null },
  { code: 26, parent_code: null, persistent: true, name: 'Factoring Fee', active: true, type: 'expense', description: '', notes: null },
  { code: 5, parent_code: null, persistent: true, name: 'Fuel', active: true, type: 'expense', description: '', notes: null },
  { code: 10, parent_code: null, persistent: true, name: 'IFTA Tax', active: true, type: 'expense', description: '', notes: null },
  { code: 1011, parent_code: null, persistent: false, name: 'Inspection', active: true, type: 'expense', description: '', notes: null },
  { code: 11, parent_code: null, persistent: false, name: 'Insurance', active: true, type: 'expense', description: '', notes: null },
  { code: 24, parent_code: null, persistent: false, name: 'Internet', active: true, type: 'expense', description: '', notes: null },
  { code: 20, parent_code: null, persistent: false, name: 'Legal & Professional', active: true, type: 'expense', description: '', notes: null },
  { code: 1001, parent_code: null, persistent: false, name: 'Maintenance', active: true, type: 'expense', description: '', notes: null },
  { code: 29, parent_code: null, persistent: true, name: 'NM, KY, NY, OR, CT miles tax', active: true, type: 'expense', description: '', notes: null },
  { code: 17, parent_code: null, persistent: false, name: 'Office Expenses', active: true, type: 'expense', description: '', notes: null },
  { code: 12, parent_code: null, persistent: false, name: 'Office Rent', active: true, type: 'expense', description: '', notes: null },
  { code: 100, parent_code: null, persistent: true, name: 'Other', active: true, type: 'expense', description: '', notes: null },
  { code: 18, parent_code: null, persistent: false, name: 'Parking', active: true, type: 'expense', description: '', notes: null },
  { code: 21, parent_code: null, persistent: false, name: 'Permits', active: true, type: 'expense', description: '', notes: null },
  { code: 28, parent_code: null, persistent: true, name: 'Quick Pay fee', active: true, type: 'expense', description: '', notes: null },
  { code: 15, parent_code: null, persistent: false, name: 'Rent', active: true, type: 'expense', description: '', notes: null },
  { code: 13, parent_code: null, persistent: false, name: 'Repairs', active: true, type: 'expense', description: '', notes: null },
  { code: 16, parent_code: null, persistent: false, name: 'Software', active: true, type: 'expense', description: '', notes: null },
  { code: 19, parent_code: null, persistent: false, name: 'Supplies', active: true, type: 'expense', description: '', notes: null },
  { code: 25, parent_code: null, persistent: false, name: 'Telephone', active: true, type: 'expense', description: '', notes: null },
  { code: 14, parent_code: null, persistent: true, name: 'Tolls', active: true, type: 'expense', description: '', notes: null },
  { code: 1004, parent_code: null, persistent: false, name: 'TONU', active: true, type: 'expense', description: '', notes: null },
  { code: 1005, parent_code: null, persistent: false, name: 'Towing', active: true, type: 'expense', description: '', notes: null },
  { code: 1006, parent_code: null, persistent: false, name: 'Trailer Rent', active: true, type: 'expense', description: '', notes: null },
  { code: 22, parent_code: null, persistent: false, name: 'Travel', active: true, type: 'expense', description: '', notes: null },
  { code: 1010, parent_code: null, persistent: false, name: 'Truck Payment', active: true, type: 'expense', description: '', notes: null },
  { code: 23, parent_code: null, persistent: false, name: 'Truck Registration', active: true, type: 'expense', description: '', notes: null },
  { code: 1002, parent_code: null, persistent: false, name: 'Truck Wash', active: true, type: 'expense', description: '', notes: null },
  { code: 1007, parent_code: null, persistent: false, name: 'Zelle Payment', active: true, type: 'expense', description: '', notes: null }
];

const BACKUP_TABLE = 'expense_category_global_backup';
const FK_BACKUP_TABLE = 'expense_category_fk_backup';

async function dropCategoryForeignKeys(knex) {
  await knex.raw('ALTER TABLE settlement_adjustment_items DROP CONSTRAINT IF EXISTS settlement_adjustment_items_category_id_foreign');
  await knex.raw('ALTER TABLE imported_expense_items DROP CONSTRAINT IF EXISTS imported_expense_items_category_id_foreign');
}

async function addCategoryForeignKeys(knex) {
  await knex.raw(`
    ALTER TABLE settlement_adjustment_items
    ADD CONSTRAINT settlement_adjustment_items_category_id_foreign
    FOREIGN KEY (category_id) REFERENCES expense_payment_categories(id) ON DELETE SET NULL
  `);
  await knex.raw(`
    ALTER TABLE imported_expense_items
    ADD CONSTRAINT imported_expense_items_category_id_foreign
    FOREIGN KEY (category_id) REFERENCES expense_payment_categories(id) ON DELETE SET NULL
  `);
}

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  if (!(await knex.schema.hasTable('global_expense_categories'))) {
    await knex.schema.createTable('global_expense_categories', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.integer('code').notNullable().unique();
      table.integer('parent_code').nullable();
      table.boolean('persistent').notNullable().defaultTo(true);
      table.text('name').notNullable();
      table.boolean('active').notNullable().defaultTo(true);
      table.enu('type', ['expense', 'revenue']).notNullable();
      table.text('description').nullable();
      table.text('notes').nullable();
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_gec_type ON global_expense_categories(type)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_gec_active ON global_expense_categories(active)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_gec_parent ON global_expense_categories(parent_code)');
  }

  if (!(await knex.schema.hasTable(BACKUP_TABLE))) {
    await knex.schema.createTable(BACKUP_TABLE, (table) => {
      table.uuid('original_id').primary();
      table.uuid('tenant_id').nullable();
      table.integer('code').notNullable();
      table.integer('parent_code').nullable();
      table.boolean('persistent').notNullable();
      table.text('name').notNullable();
      table.boolean('active').notNullable();
      table.enu('type', ['expense', 'revenue']).notNullable();
      table.text('description').nullable();
      table.text('notes').nullable();
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
    });
  }

  if (!(await knex.schema.hasTable(FK_BACKUP_TABLE))) {
    await knex.schema.createTable(FK_BACKUP_TABLE, (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('table_name').notNullable();
      table.uuid('row_id').notNullable();
      table.uuid('old_category_id').notNullable();
      table.uuid('new_category_id').notNullable();
      table.timestamps(true, true);
      table.unique(['table_name', 'row_id']);
    });
  }

  for (const category of STANDARD_CATEGORIES) {
    const existing = await knex('global_expense_categories').where({ code: category.code }).first('id');
    if (existing) {
      await knex('global_expense_categories').where({ id: existing.id }).update({
        ...category,
        updated_at: knex.fn.now(),
      });
    } else {
      await knex('global_expense_categories').insert({
        ...category,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    }
  }

  const tenantPersistentRows = await knex('expense_payment_categories').where({ persistent: true }).select('*');

  for (const row of tenantPersistentRows) {
    const exists = await knex(BACKUP_TABLE).where({ original_id: row.id }).first('original_id');
    if (!exists) {
      await knex(BACKUP_TABLE).insert({
        original_id: row.id,
        tenant_id: row.tenant_id,
        code: row.code,
        parent_code: row.parent_code,
        persistent: row.persistent,
        name: row.name,
        active: row.active,
        type: row.type,
        description: row.description,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }
  }

  await dropCategoryForeignKeys(knex);

  for (const row of tenantPersistentRows) {
    const globalRow = await knex('global_expense_categories').where({ code: row.code }).first('id');
    if (!globalRow) continue;

    for (const tableName of ['settlement_adjustment_items', 'imported_expense_items']) {
      const referencingRows = await knex(tableName).where({ category_id: row.id }).select('id');
      for (const refRow of referencingRows) {
        await knex(FK_BACKUP_TABLE)
          .insert({
            table_name: tableName,
            row_id: refRow.id,
            old_category_id: row.id,
            new_category_id: globalRow.id,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now(),
          })
          .onConflict(['table_name', 'row_id'])
          .merge({
            old_category_id: row.id,
            new_category_id: globalRow.id,
            updated_at: knex.fn.now(),
          });
      }

      await knex(tableName).where({ category_id: row.id }).update({ category_id: globalRow.id });
    }
  }

  await knex('expense_payment_categories').where({ persistent: true }).delete();
};

exports.down = async function down(knex) {
  await dropCategoryForeignKeys(knex);

  if (await knex.schema.hasTable(BACKUP_TABLE)) {
    const backups = await knex(BACKUP_TABLE).select('*').orderBy('code', 'asc');
    for (const row of backups) {
      const existing = await knex('expense_payment_categories').where({ id: row.original_id }).first('id');
      if (!existing) {
        await knex('expense_payment_categories').insert({
          id: row.original_id,
          tenant_id: row.tenant_id,
          code: row.code,
          parent_code: row.parent_code,
          persistent: row.persistent,
          name: row.name,
          active: row.active,
          type: row.type,
          description: row.description,
          notes: row.notes,
          created_at: row.created_at || knex.fn.now(),
          updated_at: row.updated_at || knex.fn.now(),
        });
      }
    }
  }

  if (await knex.schema.hasTable(FK_BACKUP_TABLE)) {
    const fkBackups = await knex(FK_BACKUP_TABLE).select('*').orderBy('created_at', 'asc');
    for (const row of fkBackups) {
      await knex(row.table_name)
        .where({ id: row.row_id, category_id: row.new_category_id })
        .update({ category_id: row.old_category_id });
    }
  }

  await addCategoryForeignKeys(knex);

  await knex.schema.dropTableIfExists('global_expense_categories');
  await knex.schema.dropTableIfExists(FK_BACKUP_TABLE);
  await knex.schema.dropTableIfExists(BACKUP_TABLE);
};
