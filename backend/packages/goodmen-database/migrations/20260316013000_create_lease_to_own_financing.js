'use strict';

/**
 * Lease-to-Own Truck Financing + Fleet Financing Dashboard schema.
 * Additive and backward-compatible.
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  if (!(await knex.schema.hasTable('lease_agreements'))) {
    await knex.schema.createTable('lease_agreements', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable(); // company scope
      t.uuid('operating_entity_id').nullable(); // MC / entity scope
      t.uuid('company_id').nullable();
      t.uuid('mc_id').nullable();
      t.uuid('driver_id').notNullable().references('id').inTable('drivers').onDelete('RESTRICT');
      t.uuid('truck_id').notNullable().references('id').inTable('vehicles').onDelete('RESTRICT');
      t.text('agreement_number').notNullable();

      t.decimal('purchase_price', 14, 2).notNullable().defaultTo(0);
      t.decimal('down_payment', 14, 2).notNullable().defaultTo(0);
      t.decimal('financed_principal', 14, 2).notNullable().defaultTo(0);
      t.decimal('interest_rate', 8, 4).notNullable().defaultTo(0);
      t.decimal('total_payable', 14, 2).notNullable().defaultTo(0);
      t.integer('term_months').notNullable().defaultTo(12);
      t.text('payment_frequency').notNullable().defaultTo('weekly'); // weekly | biweekly | monthly
      t.decimal('payment_amount', 14, 2).notNullable().defaultTo(0);
      t.decimal('balloon_payment', 14, 2).nullable();
      t.boolean('allow_payment_override').notNullable().defaultTo(false);

      t.boolean('auto_deduction_enabled').notNullable().defaultTo(true);
      t.integer('grace_period_days').notNullable().defaultTo(3);
      t.text('late_fee_type').nullable(); // fixed | percent
      t.decimal('late_fee_amount', 14, 2).nullable();

      t.text('maintenance_responsibility').nullable();
      t.text('insurance_responsibility').nullable();
      t.jsonb('default_rule_config').nullable();

      t.date('agreement_start_date').notNullable();
      t.date('agreement_end_date').nullable();
      t.timestamp('generated_at').nullable();
      t.timestamp('sent_for_signature_at').nullable();
      t.timestamp('signed_at').nullable();
      t.timestamp('activated_at').nullable();

      t.text('status').notNullable().defaultTo('draft');
      t.decimal('remaining_balance', 14, 2).notNullable().defaultTo(0);

      t.text('document_url').nullable();
      t.text('document_storage_key').nullable();
      t.jsonb('driver_signature_meta').nullable();
      t.jsonb('company_signature_meta').nullable();
      t.text('notes').nullable();

      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.uuid('updated_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_agreements_tenant ON lease_agreements(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_agreements_entity ON lease_agreements(operating_entity_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_agreements_company ON lease_agreements(company_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_agreements_mc ON lease_agreements(mc_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_agreements_driver ON lease_agreements(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_agreements_truck ON lease_agreements(truck_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_agreements_status ON lease_agreements(status)');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_agreements_tenant_number ON lease_agreements(tenant_id, agreement_number)');
    await knex.raw("CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_agreements_active_truck ON lease_agreements(truck_id) WHERE status IN ('active','overdue','pending_signature')");
    await knex.raw("CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_agreements_active_driver ON lease_agreements(driver_id) WHERE status IN ('active','overdue','pending_signature')");
  }

  if (!(await knex.schema.hasTable('lease_payment_schedule'))) {
    await knex.schema.createTable('lease_payment_schedule', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('agreement_id').notNullable().references('id').inTable('lease_agreements').onDelete('CASCADE');
      t.integer('installment_number').notNullable();
      t.date('due_date').notNullable();
      t.decimal('amount_due', 14, 2).notNullable().defaultTo(0);
      t.decimal('amount_paid', 14, 2).notNullable().defaultTo(0);
      t.decimal('remaining_due', 14, 2).notNullable().defaultTo(0);
      t.decimal('balance_after_payment', 14, 2).notNullable().defaultTo(0);
      t.text('status').notNullable().defaultTo('pending'); // pending | partial | paid | overdue | skipped | waived
      t.timestamp('paid_at').nullable();
      t.timestamp('overdue_at').nullable();
      t.decimal('late_fee_applied', 14, 2).notNullable().defaultTo(0);
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_schedule_agreement ON lease_payment_schedule(agreement_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_schedule_due_date ON lease_payment_schedule(due_date)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_schedule_status ON lease_payment_schedule(status)');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_schedule_agreement_installment ON lease_payment_schedule(agreement_id, installment_number)');
  }

  if (!(await knex.schema.hasTable('lease_payment_transactions'))) {
    await knex.schema.createTable('lease_payment_transactions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('agreement_id').notNullable().references('id').inTable('lease_agreements').onDelete('CASCADE');
      t.uuid('payment_schedule_id').nullable().references('id').inTable('lease_payment_schedule').onDelete('SET NULL');
      t.uuid('settlement_id').nullable().references('id').inTable('settlements').onDelete('SET NULL');
      t.decimal('amount_paid', 14, 2).notNullable().defaultTo(0);
      t.text('payment_method').notNullable().defaultTo('manual'); // settlement_deduction | manual | external | adjustment
      t.date('payment_date').notNullable();
      t.text('reference_number').nullable();
      t.text('notes').nullable();
      t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_txn_agreement ON lease_payment_transactions(agreement_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_txn_schedule ON lease_payment_transactions(payment_schedule_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_txn_settlement ON lease_payment_transactions(settlement_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_txn_payment_date ON lease_payment_transactions(payment_date)');
    await knex.raw("CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_txn_settlement_schedule_method ON lease_payment_transactions(settlement_id, payment_schedule_id, payment_method) WHERE settlement_id IS NOT NULL AND payment_schedule_id IS NOT NULL AND payment_method='settlement_deduction'");
  }

  if (!(await knex.schema.hasTable('lease_risk_snapshots'))) {
    await knex.schema.createTable('lease_risk_snapshots', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('agreement_id').notNullable().references('id').inTable('lease_agreements').onDelete('CASCADE');
      t.uuid('driver_id').notNullable().references('id').inTable('drivers').onDelete('CASCADE');
      t.timestamp('calculated_at').notNullable().defaultTo(knex.fn.now());
      t.integer('risk_score').notNullable().defaultTo(0); // 0-100
      t.text('risk_level').notNullable().defaultTo('low'); // low | medium | high
      t.integer('overdue_count_recent').notNullable().defaultTo(0);
      t.integer('partial_payment_count_recent').notNullable().defaultTo(0);
      t.integer('consecutive_shortfalls').notNullable().defaultTo(0);
      t.decimal('avg_net_settlement_recent', 14, 2).nullable();
      t.decimal('volatility_metric', 14, 4).nullable();
      t.jsonb('reason_codes').nullable();
      t.text('recommended_action').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_risk_agreement ON lease_risk_snapshots(agreement_id, calculated_at DESC)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_risk_driver ON lease_risk_snapshots(driver_id, calculated_at DESC)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_risk_level ON lease_risk_snapshots(risk_level)');
  }

  if (!(await knex.schema.hasTable('lease_agreement_audit_log'))) {
    await knex.schema.createTable('lease_agreement_audit_log', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('agreement_id').notNullable().references('id').inTable('lease_agreements').onDelete('CASCADE');
      t.uuid('tenant_id').notNullable();
      t.uuid('actor_id').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.text('event_type').notNullable();
      t.jsonb('payload').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_audit_agreement ON lease_agreement_audit_log(agreement_id, created_at DESC)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_lease_audit_tenant ON lease_agreement_audit_log(tenant_id, created_at DESC)');
  }

  if (await knex.schema.hasTable('vehicles')) {
    const hasOwnerType = await knex.schema.hasColumn('vehicles', 'owner_type');
    const hasLeasedDriverId = await knex.schema.hasColumn('vehicles', 'leased_driver_id');
    const hasTitleStatus = await knex.schema.hasColumn('vehicles', 'title_status');

    if (!hasOwnerType || !hasLeasedDriverId || !hasTitleStatus) {
      await knex.schema.alterTable('vehicles', (t) => {
        if (!hasOwnerType) t.text('owner_type').nullable().defaultTo('company_owned');
        if (!hasLeasedDriverId) t.uuid('leased_driver_id').nullable().references('id').inTable('drivers').onDelete('SET NULL');
        if (!hasTitleStatus) t.text('title_status').nullable();
      });
    }

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_owner_type ON vehicles(owner_type)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_leased_driver ON vehicles(leased_driver_id)');
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('vehicles')) {
    const hasOwnerType = await knex.schema.hasColumn('vehicles', 'owner_type');
    const hasLeasedDriverId = await knex.schema.hasColumn('vehicles', 'leased_driver_id');
    const hasTitleStatus = await knex.schema.hasColumn('vehicles', 'title_status');

    await knex.schema.alterTable('vehicles', (t) => {
      if (hasOwnerType) t.dropColumn('owner_type');
      if (hasLeasedDriverId) t.dropColumn('leased_driver_id');
      if (hasTitleStatus) t.dropColumn('title_status');
    });
  }

  await knex.schema.dropTableIfExists('lease_agreement_audit_log');
  await knex.schema.dropTableIfExists('lease_risk_snapshots');
  await knex.schema.dropTableIfExists('lease_payment_transactions');
  await knex.schema.dropTableIfExists('lease_payment_schedule');
  await knex.schema.dropTableIfExists('lease_agreements');
};
