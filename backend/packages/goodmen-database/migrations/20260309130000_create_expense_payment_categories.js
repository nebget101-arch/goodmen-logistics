/**
 * Create expense and payment categories table with seeded data
 */
exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // Create the categories table
  if (!(await knex.schema.hasTable('expense_payment_categories'))) {
    await knex.schema.createTable('expense_payment_categories', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.integer('code').notNullable().unique(); // unique code for each category
      table.integer('parent_code').nullable(); // for sub-categories
      table.boolean('persistent').notNullable().defaultTo(false); // system-defined categories that can't be deleted
      table.text('name').notNullable();
      table.boolean('active').notNullable().defaultTo(true);
      table.enu('type', ['expense', 'revenue']).notNullable();
      table.text('description').nullable();
      table.text('notes').nullable();
      table.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_epc_type ON expense_payment_categories(type)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_epc_active ON expense_payment_categories(active)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_epc_parent ON expense_payment_categories(parent_code)');
  }

  // Seed the predefined categories
  const categories = [
    // Revenue categories
    { code: 3, parent_code: null, persistent: true, name: 'Detention', active: true, type: 'revenue', description: '', notes: null },
    { code: 2, parent_code: null, persistent: true, name: 'Lumper', active: true, type: 'revenue', description: '', notes: null },
    { code: 98, parent_code: null, persistent: true, name: 'Other', active: true, type: 'revenue', description: '', notes: null },

    // Expense categories
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

  // Insert categories
  for (const category of categories) {
    await knex('expense_payment_categories').insert(category);
  }

  // Add category_id column to settlement_adjustment_items if it doesn't exist
  const hasColumn = await knex.schema.hasColumn('settlement_adjustment_items', 'category_id');
  if (!hasColumn) {
    await knex.schema.alterTable('settlement_adjustment_items', (table) => {
      table.uuid('category_id').nullable().references('id').inTable('expense_payment_categories').onDelete('SET NULL');
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_sai_category ON settlement_adjustment_items(category_id)');
  }

  // Add category_id column to imported_expense_items if it doesn't exist
  const hasImportedColumn = await knex.schema.hasColumn('imported_expense_items', 'category_id');
  if (!hasImportedColumn) {
    await knex.schema.alterTable('imported_expense_items', (table) => {
      table.uuid('category_id').nullable().references('id').inTable('expense_payment_categories').onDelete('SET NULL');
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_iei_category ON imported_expense_items(category_id)');
  }
};

exports.down = async function(knex) {
  // Remove foreign key columns first
  const hasColumn = await knex.schema.hasColumn('settlement_adjustment_items', 'category_id');
  if (hasColumn) {
    await knex.schema.alterTable('settlement_adjustment_items', (table) => {
      table.dropColumn('category_id');
    });
  }

  const hasImportedColumn = await knex.schema.hasColumn('imported_expense_items', 'category_id');
  if (hasImportedColumn) {
    await knex.schema.alterTable('imported_expense_items', (table) => {
      table.dropColumn('category_id');
    });
  }

  // Drop the categories table
  await knex.schema.dropTableIfExists('expense_payment_categories');
};
