/**
 * Fuel Import Module – schema migration.
 * Tables:
 *   fuel_providers, fuel_card_accounts,
 *   fuel_import_mapping_profiles,
 *   fuel_import_batches, fuel_import_batch_rows,
 *   fuel_transactions, fuel_transaction_exceptions
 *
 * All tables are additive – existing data is never touched.
 */
exports.up = async function (knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // ─── 1. fuel_providers ──────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('fuel_providers'))) {
    await knex.schema.createTable('fuel_providers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.text('provider_code').notNullable(); // efs | comdata | wex | rts | tcs | generic
      t.text('display_name').notNullable();
      t.text('import_method').notNullable().defaultTo('manual_upload'); // manual_upload | sftp | api
      t.text('status').notNullable().defaultTo('active'); // active | inactive
      t.text('notes').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_providers_tenant ON fuel_providers(tenant_id)');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_providers_tenant_code ON fuel_providers(tenant_id, provider_code)');
  }

  // ─── 2. fuel_card_accounts ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('fuel_card_accounts'))) {
    await knex.schema.createTable('fuel_card_accounts', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.uuid('provider_id').nullable().references('id').inTable('fuel_providers').onDelete('SET NULL');
      t.text('provider_name').notNullable(); // denormalised for quick display
      t.text('display_name').notNullable();
      t.text('account_number_masked').nullable();
      t.text('import_method').notNullable().defaultTo('manual_upload');
      // JSON: { matchByUnit: true, matchByCard: true, fuzzyUnit: false }
      t.jsonb('default_matching_rules').nullable();
      t.text('status').notNullable().defaultTo('active');
      t.text('notes').nullable();
      t.uuid('created_by').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_card_accounts_tenant ON fuel_card_accounts(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_card_accounts_provider ON fuel_card_accounts(provider_id)');
  }

  // ─── 3. fuel_import_mapping_profiles ─────────────────────────────────────────
  if (!(await knex.schema.hasTable('fuel_import_mapping_profiles'))) {
    await knex.schema.createTable('fuel_import_mapping_profiles', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.text('profile_name').notNullable();
      t.text('provider_name').nullable();
      // JSON: { transaction_date: 'Date', gallons: 'QTY', ... }
      t.jsonb('column_map').notNullable();
      t.boolean('is_default').notNullable().defaultTo(false);
      t.text('parser_version').notNullable().defaultTo('v1');
      t.uuid('created_by').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_mapping_profiles_tenant ON fuel_import_mapping_profiles(tenant_id)');
  }

  // ─── 4. fuel_import_batches ──────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('fuel_import_batches'))) {
    await knex.schema.createTable('fuel_import_batches', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.uuid('fuel_card_account_id').nullable().references('id').inTable('fuel_card_accounts').onDelete('SET NULL');
      t.text('provider_name').notNullable();
      t.text('source_file_name').notNullable();
      t.text('source_file_storage_key').nullable();
      t.text('import_status').notNullable().defaultTo('pending');
      // pending | validating | validated | importing | completed | failed | rolled_back
      t.integer('total_rows').notNullable().defaultTo(0);
      t.integer('success_rows').notNullable().defaultTo(0);
      t.integer('warning_rows').notNullable().defaultTo(0);
      t.integer('failed_rows').notNullable().defaultTo(0);
      t.uuid('imported_by_user_id').nullable();
      t.timestamp('started_at').nullable();
      t.timestamp('completed_at').nullable();
      t.text('parser_version').notNullable().defaultTo('v1');
      t.text('notes').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_batches_tenant ON fuel_import_batches(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_batches_status ON fuel_import_batches(import_status)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_batches_started ON fuel_import_batches(started_at DESC)');
  }

  // ─── 5. fuel_import_batch_rows ────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('fuel_import_batch_rows'))) {
    await knex.schema.createTable('fuel_import_batch_rows', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('batch_id').notNullable().references('id').inTable('fuel_import_batches').onDelete('CASCADE');
      t.integer('row_number').notNullable();
      t.jsonb('raw_payload').nullable();
      t.jsonb('normalized_payload').nullable();
      t.jsonb('validation_errors').nullable();
      t.jsonb('warnings').nullable();
      t.jsonb('match_result').nullable();
      t.text('resolution_status').notNullable().defaultTo('pending');
      // pending | valid | warning | failed | imported | skipped
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_batch_rows_batch ON fuel_import_batch_rows(batch_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_batch_rows_status ON fuel_import_batch_rows(resolution_status)');
  }

  // ─── 6. fuel_transactions ─────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('fuel_transactions'))) {
    await knex.schema.createTable('fuel_transactions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.text('provider_name').notNullable();
      t.uuid('fuel_card_account_id').nullable().references('id').inTable('fuel_card_accounts').onDelete('SET NULL');
      t.text('external_transaction_id').nullable();
      t.date('transaction_date').notNullable();
      t.date('posted_date').nullable();
      // FK references (nullable – may not match)
      t.uuid('truck_id').nullable();
      t.uuid('trailer_id').nullable();
      t.uuid('driver_id').nullable();
      t.uuid('load_id').nullable();
      t.uuid('settlement_id').nullable();
      // Raw strings from the file (for display + re-matching)
      t.text('unit_number_raw').nullable();
      t.text('driver_name_raw').nullable();
      t.text('card_number_masked').nullable();
      // Vendor / location
      t.text('vendor_name').nullable();
      t.text('location_name').nullable();
      t.text('address').nullable();
      t.text('city').nullable();
      t.text('state').nullable();
      t.text('jurisdiction_state').nullable();
      // Amounts
      t.decimal('gallons', 10, 4).notNullable().defaultTo(0);
      t.decimal('amount', 14, 2).notNullable().defaultTo(0);
      t.decimal('price_per_gallon', 10, 4).nullable();
      t.text('currency').notNullable().defaultTo('USD');
      t.integer('odometer').nullable();
      t.text('product_type').nullable();
      // Status flags
      t.text('matched_status').notNullable().defaultTo('unmatched');
      // unmatched | partial | matched | manual
      t.text('validation_status').notNullable().defaultTo('valid');
      // valid | warning | duplicate | error
      t.text('settlement_link_status').notNullable().defaultTo('none');
      // none | pending | linked | excluded
      t.boolean('is_manual').notNullable().defaultTo(false);
      // Source provenance
      t.uuid('source_batch_id').nullable().references('id').inTable('fuel_import_batches').onDelete('SET NULL');
      t.integer('source_row_number').nullable();
      t.uuid('created_by').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_txn_tenant ON fuel_transactions(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_txn_date ON fuel_transactions(transaction_date DESC)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_txn_truck ON fuel_transactions(truck_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_txn_driver ON fuel_transactions(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_txn_batch ON fuel_transactions(source_batch_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_txn_matched ON fuel_transactions(matched_status)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_txn_ext_id ON fuel_transactions(tenant_id, external_transaction_id)');
  }

  // ─── 7. fuel_transaction_exceptions ─────────────────────────────────────────
  if (!(await knex.schema.hasTable('fuel_transaction_exceptions'))) {
    await knex.schema.createTable('fuel_transaction_exceptions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('fuel_transaction_id').notNullable().references('id').inTable('fuel_transactions').onDelete('CASCADE');
      t.uuid('tenant_id').notNullable();
      t.text('exception_type').notNullable(); // unmatched_truck | unmatched_driver | duplicate | validation_error | etc.
      t.text('exception_message').nullable();
      t.text('resolution_status').notNullable().defaultTo('open'); // open | resolved | ignored | reprocessed
      t.uuid('resolved_by').nullable();
      t.timestamp('resolved_at').nullable();
      t.text('resolution_notes').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_exceptions_tenant ON fuel_transaction_exceptions(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_exceptions_txn ON fuel_transaction_exceptions(fuel_transaction_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fuel_exceptions_status ON fuel_transaction_exceptions(resolution_status)');
  }
};

exports.down = async function (knex) {
  // Drop in reverse FK dependency order
  await knex.schema.dropTableIfExists('fuel_transaction_exceptions');
  await knex.schema.dropTableIfExists('fuel_transactions');
  await knex.schema.dropTableIfExists('fuel_import_batch_rows');
  await knex.schema.dropTableIfExists('fuel_import_batches');
  await knex.schema.dropTableIfExists('fuel_import_mapping_profiles');
  await knex.schema.dropTableIfExists('fuel_card_accounts');
  await knex.schema.dropTableIfExists('fuel_providers');
};
