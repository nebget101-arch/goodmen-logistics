'use strict';

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  if (!(await knex.schema.hasTable('ifta_quarters'))) {
    await knex.schema.createTable('ifta_quarters', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.uuid('company_id').nullable();
      t.uuid('mc_id').nullable();

      t.integer('quarter').notNullable();
      t.integer('tax_year').notNullable();
      t.text('filing_entity_name').nullable();
      t.text('status').notNullable().defaultTo('draft'); // draft | under_review | finalized | exported
      t.jsonb('selected_truck_ids').notNullable().defaultTo('[]');

      t.decimal('total_taxable_miles', 14, 2).notNullable().defaultTo(0);
      t.decimal('total_fleet_miles', 14, 2).notNullable().defaultTo(0);
      t.decimal('total_gallons', 14, 2).notNullable().defaultTo(0);
      t.decimal('fleet_mpg', 12, 4).notNullable().defaultTo(0);
      t.decimal('total_due_credit', 14, 2).notNullable().defaultTo(0);
      t.integer('latest_snapshot_version').notNullable().defaultTo(0);

      t.integer('ai_readiness_score').nullable();
      t.text('ai_narrative').nullable();

      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('finalized_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('finalized_at').nullable();
      t.timestamp('exported_at').nullable();

      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_quarters_tenant ON ifta_quarters(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_quarters_entity ON ifta_quarters(operating_entity_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_quarters_period ON ifta_quarters(tax_year, quarter)');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_ifta_quarters_tenant_entity_period ON ifta_quarters(tenant_id, COALESCE(operating_entity_id,\'00000000-0000-0000-0000-000000000000\'::uuid), tax_year, quarter)');
  }

  if (!(await knex.schema.hasTable('ifta_tax_rates'))) {
    await knex.schema.createTable('ifta_tax_rates', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.text('jurisdiction').notNullable();
      t.decimal('tax_rate', 12, 6).notNullable().defaultTo(0);
      t.date('effective_from').notNullable();
      t.date('effective_to').nullable();
      t.text('source').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_tax_rates_jurisdiction ON ifta_tax_rates(jurisdiction, effective_from DESC)');
  }

  if (!(await knex.schema.hasTable('ifta_miles_entries'))) {
    await knex.schema.createTable('ifta_miles_entries', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('quarter_id').notNullable().references('id').inTable('ifta_quarters').onDelete('CASCADE');
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.uuid('truck_id').nullable().references('id').inTable('vehicles').onDelete('SET NULL');
      t.text('unit').notNullable();
      t.text('jurisdiction').notNullable();
      t.decimal('taxable_miles', 14, 2).notNullable().defaultTo(0);
      t.decimal('non_taxable_miles', 14, 2).notNullable().defaultTo(0);
      t.decimal('total_miles', 14, 2).notNullable().defaultTo(0);
      t.text('source').notNullable().defaultTo('manual');
      t.text('notes').nullable();
      t.boolean('is_deleted').notNullable().defaultTo(false);
      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_miles_quarter ON ifta_miles_entries(quarter_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_miles_tenant_jurisdiction ON ifta_miles_entries(tenant_id, jurisdiction)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_miles_unit ON ifta_miles_entries(unit)');
  }

  if (!(await knex.schema.hasTable('ifta_fuel_entries'))) {
    await knex.schema.createTable('ifta_fuel_entries', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('quarter_id').notNullable().references('id').inTable('ifta_quarters').onDelete('CASCADE');
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.uuid('truck_id').nullable().references('id').inTable('vehicles').onDelete('SET NULL');
      t.date('purchase_date').notNullable();
      t.text('unit').notNullable();
      t.text('jurisdiction').notNullable();
      t.text('vendor').nullable();
      t.text('receipt_invoice_number').nullable();
      t.decimal('gallons', 14, 2).notNullable().defaultTo(0);
      t.decimal('amount', 14, 2).notNullable().defaultTo(0);
      t.text('fuel_type').notNullable().defaultTo('diesel');
      t.boolean('tax_paid').notNullable().defaultTo(true);
      t.text('attachment_link').nullable();
      t.text('source').notNullable().defaultTo('manual');
      t.text('notes').nullable();
      t.boolean('duplicate_suspected').notNullable().defaultTo(false);
      t.boolean('purchase_outside_quarter').notNullable().defaultTo(false);
      t.boolean('is_deleted').notNullable().defaultTo(false);
      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_fuel_quarter ON ifta_fuel_entries(quarter_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_fuel_tenant_jurisdiction ON ifta_fuel_entries(tenant_id, jurisdiction)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_fuel_receipt ON ifta_fuel_entries(receipt_invoice_number)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_fuel_purchase_date ON ifta_fuel_entries(purchase_date DESC)');
  }

  if (!(await knex.schema.hasTable('ifta_jurisdiction_summary'))) {
    await knex.schema.createTable('ifta_jurisdiction_summary', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('quarter_id').notNullable().references('id').inTable('ifta_quarters').onDelete('CASCADE');
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.integer('snapshot_version').notNullable().defaultTo(1);
      t.boolean('is_current').notNullable().defaultTo(true);
      t.text('jurisdiction').notNullable();
      t.decimal('total_miles', 14, 2).notNullable().defaultTo(0);
      t.decimal('taxable_miles', 14, 2).notNullable().defaultTo(0);
      t.decimal('tax_paid_gallons', 14, 2).notNullable().defaultTo(0);
      t.decimal('total_gallons', 14, 2).notNullable().defaultTo(0);
      t.decimal('taxable_gallons', 14, 2).notNullable().defaultTo(0);
      t.decimal('net_taxable_gallons', 14, 2).notNullable().defaultTo(0);
      t.decimal('tax_rate', 12, 6).notNullable().defaultTo(0);
      t.decimal('tax_due_credit', 14, 2).notNullable().defaultTo(0);
      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_summary_quarter_current ON ifta_jurisdiction_summary(quarter_id, is_current, jurisdiction)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_summary_snapshot ON ifta_jurisdiction_summary(quarter_id, snapshot_version DESC)');
  }

  if (!(await knex.schema.hasTable('ifta_ai_findings'))) {
    await knex.schema.createTable('ifta_ai_findings', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('quarter_id').notNullable().references('id').inTable('ifta_quarters').onDelete('CASCADE');
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.text('finding_type').notNullable();
      t.text('severity').notNullable().defaultTo('info'); // info | warning | blocker
      t.text('title').notNullable();
      t.text('details').nullable();
      t.boolean('resolved').notNullable().defaultTo(false);
      t.text('resolved_notes').nullable();
      t.uuid('resolved_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('resolved_at').nullable();
      t.boolean('is_archived').notNullable().defaultTo(false);
      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_findings_quarter ON ifta_ai_findings(quarter_id, is_archived, severity)');
  }

  if (!(await knex.schema.hasTable('ifta_exports'))) {
    await knex.schema.createTable('ifta_exports', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('quarter_id').notNullable().references('id').inTable('ifta_quarters').onDelete('CASCADE');
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.text('export_type').notNullable();
      t.text('file_name').nullable();
      t.text('storage_key').nullable();
      t.jsonb('payload_json').nullable();
      t.uuid('exported_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_exports_quarter ON ifta_exports(quarter_id, created_at DESC)');
  }

  if (!(await knex.schema.hasTable('ifta_source_files'))) {
    await knex.schema.createTable('ifta_source_files', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('quarter_id').notNullable().references('id').inTable('ifta_quarters').onDelete('CASCADE');
      t.uuid('tenant_id').notNullable();
      t.uuid('operating_entity_id').nullable();
      t.text('file_type').notNullable(); // miles | fuel
      t.text('source_name').notNullable();
      t.text('mime_type').nullable();
      t.integer('row_count').notNullable().defaultTo(0);
      t.jsonb('metadata').nullable();
      t.uuid('uploaded_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ifta_source_files_quarter ON ifta_source_files(quarter_id, created_at DESC)');
  }

  const existingRates = await knex('ifta_tax_rates').count('* as count').first();
  if (Number(existingRates?.count || 0) === 0) {
    const defaults = [
      ['AL', 0.1900], ['AZ', 0.2600], ['AR', 0.2250], ['CA', 0.7390], ['CO', 0.2050], ['CT', 0.4920],
      ['DE', 0.2200], ['FL', 0.3340], ['GA', 0.3520], ['IA', 0.3250], ['ID', 0.3200], ['IL', 0.4540],
      ['IN', 0.3300], ['KS', 0.2400], ['KY', 0.2970], ['LA', 0.2000], ['MA', 0.2400], ['MD', 0.3700],
      ['ME', 0.3120], ['MI', 0.2860], ['MN', 0.2850], ['MO', 0.2450], ['MS', 0.1840], ['MT', 0.3275],
      ['NC', 0.3680], ['ND', 0.2300], ['NE', 0.2530], ['NH', 0.2220], ['NJ', 0.4390], ['NM', 0.1888],
      ['NV', 0.2720], ['NY', 0.6090], ['OH', 0.4700], ['OK', 0.2000], ['OR', 0.3800], ['PA', 0.7410],
      ['RI', 0.3700], ['SC', 0.2820], ['SD', 0.2800], ['TN', 0.2740], ['TX', 0.2000], ['UT', 0.3550],
      ['VA', 0.2160], ['VT', 0.3200], ['WA', 0.4940], ['WI', 0.3290], ['WV', 0.3570], ['WY', 0.2400],
    ];
    await knex('ifta_tax_rates').insert(defaults.map(([jurisdiction, taxRate]) => ({
      jurisdiction,
      tax_rate: taxRate,
      effective_from: '2026-01-01',
      source: 'seed-default',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    })));
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ifta_source_files');
  await knex.schema.dropTableIfExists('ifta_exports');
  await knex.schema.dropTableIfExists('ifta_ai_findings');
  await knex.schema.dropTableIfExists('ifta_jurisdiction_summary');
  await knex.schema.dropTableIfExists('ifta_fuel_entries');
  await knex.schema.dropTableIfExists('ifta_miles_entries');
  await knex.schema.dropTableIfExists('ifta_tax_rates');
  await knex.schema.dropTableIfExists('ifta_quarters');
};
