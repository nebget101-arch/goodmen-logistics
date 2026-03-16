'use strict';

/**
 * Toll Import Module – Phase 1 schema scaffold.
 * Additive only.
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  if (!(await knex.schema.hasTable('toll_providers'))) {
    await knex.schema.createTable('toll_providers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.text('provider_code').notNullable();
      t.text('display_name').notNullable();
      t.text('import_method').notNullable().defaultTo('manual_upload');
      t.text('status').notNullable().defaultTo('active');
      t.text('notes').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_providers_tenant ON toll_providers(tenant_id)');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_toll_providers_tenant_code ON toll_providers(tenant_id, provider_code)');
  }

  if (!(await knex.schema.hasTable('toll_accounts'))) {
    await knex.schema.createTable('toll_accounts', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.uuid('provider_id').nullable().references('id').inTable('toll_providers').onDelete('SET NULL');
      t.text('provider_name').notNullable();
      t.text('display_name').notNullable();
      t.text('account_number_masked').nullable();
      t.text('import_method').notNullable().defaultTo('manual_upload');
      t.jsonb('default_matching_rules').nullable();
      t.text('status').notNullable().defaultTo('active');
      t.text('notes').nullable();
      t.uuid('created_by').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_accounts_tenant ON toll_accounts(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_accounts_provider ON toll_accounts(provider_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_accounts_entity ON toll_accounts(operating_entity_id)');
  }

  if (!(await knex.schema.hasTable('toll_devices'))) {
    await knex.schema.createTable('toll_devices', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.uuid('toll_account_id').notNullable().references('id').inTable('toll_accounts').onDelete('CASCADE');
      t.text('device_number_masked').nullable();
      t.text('plate_number').nullable();
      t.uuid('truck_id').nullable();
      t.uuid('trailer_id').nullable();
      t.uuid('driver_id').nullable();
      t.date('effective_start_date').nullable();
      t.date('effective_end_date').nullable();
      t.text('status').notNullable().defaultTo('active');
      t.text('notes').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_devices_tenant ON toll_devices(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_devices_account ON toll_devices(toll_account_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_devices_truck ON toll_devices(truck_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_devices_driver ON toll_devices(driver_id)');
  }

  if (!(await knex.schema.hasTable('toll_import_mapping_profiles'))) {
    await knex.schema.createTable('toll_import_mapping_profiles', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.text('profile_name').notNullable();
      t.text('provider_name').nullable();
      t.jsonb('column_map').notNullable();
      t.boolean('is_default').notNullable().defaultTo(false);
      t.text('parser_version').notNullable().defaultTo('v1');
      t.uuid('created_by').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_mapping_profiles_tenant ON toll_import_mapping_profiles(tenant_id)');
  }

  if (!(await knex.schema.hasTable('toll_import_batches'))) {
    await knex.schema.createTable('toll_import_batches', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.uuid('toll_account_id').nullable().references('id').inTable('toll_accounts').onDelete('SET NULL');
      t.text('provider_name').notNullable();
      t.text('source_file_name').notNullable();
      t.text('source_file_storage_key').nullable();
      t.text('import_status').notNullable().defaultTo('pending');
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
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_batches_tenant ON toll_import_batches(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_batches_status ON toll_import_batches(import_status)');
  }

  if (!(await knex.schema.hasTable('toll_import_batch_rows'))) {
    await knex.schema.createTable('toll_import_batch_rows', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('batch_id').notNullable().references('id').inTable('toll_import_batches').onDelete('CASCADE');
      t.integer('row_number').notNullable();
      t.jsonb('raw_payload').nullable();
      t.jsonb('normalized_payload').nullable();
      t.jsonb('validation_errors').nullable();
      t.jsonb('warnings').nullable();
      t.jsonb('match_result').nullable();
      t.text('dedupe_hash').nullable();
      t.text('resolution_status').notNullable().defaultTo('pending');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_batch_rows_batch ON toll_import_batch_rows(batch_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_batch_rows_status ON toll_import_batch_rows(resolution_status)');
  }

  if (!(await knex.schema.hasTable('toll_transactions'))) {
    await knex.schema.createTable('toll_transactions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.text('provider_name').notNullable();
      t.uuid('toll_account_id').nullable().references('id').inTable('toll_accounts').onDelete('SET NULL');
      t.uuid('toll_device_id').nullable().references('id').inTable('toll_devices').onDelete('SET NULL');
      t.text('external_transaction_id').nullable();
      t.date('transaction_date').notNullable();
      t.date('posted_date').nullable();
      t.uuid('truck_id').nullable();
      t.uuid('trailer_id').nullable();
      t.uuid('driver_id').nullable();
      t.uuid('load_id').nullable();
      t.uuid('settlement_id').nullable();
      t.uuid('settlement_adjustment_item_id').nullable();
      t.text('unit_number_raw').nullable();
      t.text('driver_name_raw').nullable();
      t.text('device_number_masked').nullable();
      t.text('plate_number_raw').nullable();
      t.text('plaza_name').nullable();
      t.text('entry_location').nullable();
      t.text('exit_location').nullable();
      t.text('city').nullable();
      t.text('state').nullable();
      t.decimal('amount', 14, 2).notNullable().defaultTo(0);
      t.text('currency').notNullable().defaultTo('USD');
      t.text('matched_status').notNullable().defaultTo('unmatched');
      t.text('validation_status').notNullable().defaultTo('valid');
      t.text('settlement_link_status').notNullable().defaultTo('none');
      t.boolean('is_manual').notNullable().defaultTo(false);
      t.uuid('source_batch_id').nullable().references('id').inTable('toll_import_batches').onDelete('SET NULL');
      t.integer('source_row_number').nullable();
      t.text('dedupe_hash').nullable();
      t.uuid('created_by').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_txn_tenant ON toll_transactions(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_txn_date ON toll_transactions(transaction_date DESC)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_txn_driver ON toll_transactions(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_txn_truck ON toll_transactions(truck_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_txn_batch ON toll_transactions(source_batch_id)');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_toll_txn_tenant_dedupe ON toll_transactions(tenant_id, dedupe_hash) WHERE dedupe_hash IS NOT NULL');
  }

  if (!(await knex.schema.hasTable('toll_transaction_exceptions'))) {
    await knex.schema.createTable('toll_transaction_exceptions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('toll_transaction_id').notNullable().references('id').inTable('toll_transactions').onDelete('CASCADE');
      t.uuid('tenant_id').notNullable();
      t.text('exception_type').notNullable();
      t.text('exception_message').nullable();
      t.text('resolution_status').notNullable().defaultTo('open');
      t.uuid('resolved_by').nullable();
      t.timestamp('resolved_at').nullable();
      t.text('resolution_notes').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_ex_tenant ON toll_transaction_exceptions(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_ex_txn ON toll_transaction_exceptions(toll_transaction_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_toll_ex_status ON toll_transaction_exceptions(resolution_status)');
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('toll_transaction_exceptions');
  await knex.schema.dropTableIfExists('toll_transactions');
  await knex.schema.dropTableIfExists('toll_import_batch_rows');
  await knex.schema.dropTableIfExists('toll_import_batches');
  await knex.schema.dropTableIfExists('toll_import_mapping_profiles');
  await knex.schema.dropTableIfExists('toll_devices');
  await knex.schema.dropTableIfExists('toll_accounts');
  await knex.schema.dropTableIfExists('toll_providers');
};
