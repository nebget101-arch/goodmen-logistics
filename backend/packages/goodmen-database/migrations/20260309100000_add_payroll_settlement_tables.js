/**
 * Add payroll/settlement domain tables (additive only).
 * No changes to existing drivers, loads, or vehicles columns.
 *
 * Tables: payees, driver_compensation_profiles, expense_responsibility_profiles,
 * driver_payee_assignments, payroll_periods, settlements, settlement_load_items,
 * settlement_adjustment_items, recurring_deduction_rules, imported_expense_sources,
 * imported_expense_items.
 */
exports.up = async function (knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasVehicles = await knex.schema.hasTable('vehicles');

  // ---------------------------------------------------------------------------
  // 1. payees
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('payees'))) {
    await knex.schema.createTable('payees', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('type').notNullable(); // company | driver | owner | external_company | contractor
      table.text('name').notNullable();
      table.uuid('contact_id').nullable(); // optional link to users or external
      table.text('email').nullable();
      table.text('phone').nullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_payees_type ON payees(type)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_payees_is_active ON payees(is_active)');
  }

  // ---------------------------------------------------------------------------
  // 2. driver_compensation_profiles
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('driver_compensation_profiles'))) {
    await knex.schema.createTable('driver_compensation_profiles', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('driver_id').notNullable().references('id').inTable('drivers').onDelete('CASCADE');
      table.text('profile_type').notNullable(); // company_driver | owner_operator | hired_driver_for_owner
      table.text('pay_model').notNullable(); // per_mile | percentage | flat_weekly | flat_per_load
      table.decimal('percentage_rate', 5, 2).nullable();
      table.decimal('cents_per_mile', 10, 4).nullable();
      table.decimal('flat_weekly_amount', 12, 2).nullable();
      table.decimal('flat_per_load_amount', 12, 2).nullable();
      table.boolean('expense_sharing_enabled').notNullable().defaultTo(false);
      table.date('effective_start_date').notNullable();
      table.date('effective_end_date').nullable();
      table.text('status').notNullable().defaultTo('active'); // active | inactive | superseded
      table.text('notes').nullable();
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dcp_driver ON driver_compensation_profiles(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dcp_effective ON driver_compensation_profiles(effective_start_date, effective_end_date)');
  }

  // ---------------------------------------------------------------------------
  // 3. expense_responsibility_profiles
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('expense_responsibility_profiles'))) {
    await knex.schema.createTable('expense_responsibility_profiles', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('driver_id').nullable().references('id').inTable('drivers').onDelete('CASCADE');
      table.uuid('compensation_profile_id').nullable().references('id').inTable('driver_compensation_profiles').onDelete('SET NULL');
      table.text('fuel_responsibility').nullable(); // company | driver | owner | shared
      table.text('insurance_responsibility').nullable();
      table.text('eld_responsibility').nullable();
      table.text('trailer_rent_responsibility').nullable();
      table.text('toll_responsibility').nullable();
      table.text('repairs_responsibility').nullable();
      table.jsonb('custom_rules').nullable().defaultTo(knex.raw("'{}'::jsonb"));
      table.date('effective_start_date').notNullable();
      table.date('effective_end_date').nullable();
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_erp_driver ON expense_responsibility_profiles(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_erp_comp ON expense_responsibility_profiles(compensation_profile_id)');
  }

  // ---------------------------------------------------------------------------
  // 4. driver_payee_assignments
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('driver_payee_assignments'))) {
    await knex.schema.createTable('driver_payee_assignments', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('driver_id').notNullable().references('id').inTable('drivers').onDelete('CASCADE');
      table.uuid('primary_payee_id').notNullable().references('id').inTable('payees').onDelete('RESTRICT');
      table.uuid('additional_payee_id').nullable().references('id').inTable('payees').onDelete('SET NULL');
      table.text('rule_type').notNullable(); // company_truck | owner_truck | owner_operator | custom
      table.date('effective_start_date').notNullable();
      table.date('effective_end_date').nullable();
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dpa_driver ON driver_payee_assignments(driver_id)');
  }

  // ---------------------------------------------------------------------------
  // 5. payroll_periods
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('payroll_periods'))) {
    await knex.schema.createTable('payroll_periods', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.date('period_start').notNullable();
      table.date('period_end').notNullable();
      table.text('run_type').notNullable().defaultTo('weekly');
      table.text('status').notNullable().defaultTo('draft'); // draft | open | processing | finalized | approved | emailed | void
      table.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.uuid('approved_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('approved_at').nullable();
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_pp_dates ON payroll_periods(period_start, period_end)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_pp_status ON payroll_periods(status)');
  }

  // ---------------------------------------------------------------------------
  // 6. settlements
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('settlements'))) {
    await knex.schema.createTable('settlements', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('payroll_period_id').notNullable().references('id').inTable('payroll_periods').onDelete('RESTRICT');
      table.uuid('driver_id').notNullable().references('id').inTable('drivers').onDelete('RESTRICT');
      table.uuid('compensation_profile_id').nullable().references('id').inTable('driver_compensation_profiles').onDelete('SET NULL');
      table.uuid('primary_payee_id').notNullable().references('id').inTable('payees').onDelete('RESTRICT');
      table.uuid('additional_payee_id').nullable().references('id').inTable('payees').onDelete('SET NULL');
      table.text('settlement_number').notNullable();
      table.text('settlement_status').notNullable().defaultTo('preparing'); // preparing | ready_for_review | approved | paid | void
      table.date('date').notNullable();
      table.decimal('subtotal_gross', 14, 2).notNullable().defaultTo(0);
      table.decimal('subtotal_driver_pay', 14, 2).notNullable().defaultTo(0);
      table.decimal('subtotal_additional_payee', 14, 2).notNullable().defaultTo(0);
      table.decimal('total_deductions', 14, 2).notNullable().defaultTo(0);
      table.decimal('total_advances', 14, 2).notNullable().defaultTo(0);
      table.decimal('net_pay_driver', 14, 2).notNullable().defaultTo(0);
      table.decimal('net_pay_additional_payee', 14, 2).notNullable().defaultTo(0);
      table.text('notes').nullable();
      table.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.uuid('approved_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('approved_at').nullable();
      table.timestamps(true, true);
    });
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_number ON settlements(settlement_number)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_settlements_period ON settlements(payroll_period_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_settlements_driver ON settlements(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(settlement_status)');
  }

  // ---------------------------------------------------------------------------
  // 7. settlement_load_items
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('settlement_load_items'))) {
    await knex.schema.createTable('settlement_load_items', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('settlement_id').notNullable().references('id').inTable('settlements').onDelete('CASCADE');
      table.uuid('load_id').notNullable().references('id').inTable('loads').onDelete('RESTRICT');
      table.date('pickup_date').nullable();
      table.date('delivery_date').nullable();
      table.decimal('loaded_miles', 10, 2).nullable();
      table.jsonb('pay_basis_snapshot').nullable().defaultTo(knex.raw("'{}'::jsonb"));
      table.decimal('gross_amount', 14, 2).notNullable().defaultTo(0);
      table.decimal('driver_pay_amount', 14, 2).notNullable().defaultTo(0);
      table.decimal('additional_payee_amount', 14, 2).nullable().defaultTo(0);
      table.uuid('included_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_sli_settlement ON settlement_load_items(settlement_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_sli_load ON settlement_load_items(load_id)');
    // Prevent same load in more than one non-void settlement: enforced in app or via partial unique index
    // (partial unique on load_id where settlement_id in (select id from settlements where settlement_status != 'void'))
    // For simplicity we enforce in application layer; optional: add trigger or partial unique.
  }

  // ---------------------------------------------------------------------------
  // 8. settlement_adjustment_items
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('settlement_adjustment_items'))) {
    await knex.schema.createTable('settlement_adjustment_items', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('settlement_id').notNullable().references('id').inTable('settlements').onDelete('CASCADE');
      table.text('item_type').notNullable(); // earning | deduction | reimbursement | advance | correction
      table.text('source_type').nullable(); // manual | scheduled_rule | imported_fuel | imported_toll | ...
      table.text('description').nullable();
      table.decimal('amount', 14, 2).notNullable(); // positive = earning/reimbursement, negative = deduction
      table.decimal('quantity', 12, 4).nullable();
      table.decimal('unit_rate', 14, 4).nullable();
      table.text('charge_party').nullable(); // driver | owner | company | shared
      table.text('apply_to').nullable(); // primary_payee | additional_payee | settlement
      table.uuid('source_reference_id').nullable();
      table.text('source_reference_type').nullable();
      table.date('occurrence_date').nullable();
      table.text('status').notNullable().defaultTo('pending'); // pending | applied | overridden | removed
      table.text('override_reason').nullable();
      table.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_sai_settlement ON settlement_adjustment_items(settlement_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_sai_source ON settlement_adjustment_items(source_reference_type, source_reference_id)');
  }

  // ---------------------------------------------------------------------------
  // 9. recurring_deduction_rules
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('recurring_deduction_rules'))) {
    await knex.schema.createTable('recurring_deduction_rules', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('driver_id').nullable().references('id').inTable('drivers').onDelete('CASCADE');
      table.uuid('payee_id').nullable().references('id').inTable('payees').onDelete('SET NULL');
      const equipmentId = table.uuid('equipment_id').nullable();
      if (hasVehicles) {
        equipmentId.references('id').inTable('vehicles').onDelete('SET NULL');
      }
      table.text('rule_scope').notNullable(); // driver | payee | truck | trailer | driver_and_truck
      table.text('description').nullable();
      table.text('amount_type').notNullable().defaultTo('fixed');
      table.decimal('amount', 14, 2).notNullable();
      table.text('frequency').notNullable().defaultTo('weekly');
      table.date('start_date').notNullable();
      table.date('end_date').nullable();
      table.text('source_type').nullable(); // insurance | eld | trailer_rent | admin_fee | other
      table.text('applies_when').nullable().defaultTo('always'); // always | only_if_load_exists | only_if_active
      table.boolean('enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_rdr_driver ON recurring_deduction_rules(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_rdr_payee ON recurring_deduction_rules(payee_id)');
  }

  // ---------------------------------------------------------------------------
  // 10. imported_expense_sources
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('imported_expense_sources'))) {
    await knex.schema.createTable('imported_expense_sources', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('source_type').notNullable(); // fuel_pdf | insurance_pdf | eld_invoice | toll_statement | csv_import | manual_upload
      table.text('file_id').nullable(); // or storage_key
      table.text('storage_key').nullable();
      table.timestamp('imported_at').notNullable().defaultTo(knex.fn.now());
      table.uuid('imported_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.text('parse_status').nullable(); // pending | parsed | failed
      table.jsonb('raw_metadata').nullable().defaultTo(knex.raw("'{}'::jsonb"));
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ies_imported_at ON imported_expense_sources(imported_at)');
  }

  // ---------------------------------------------------------------------------
  // 11. imported_expense_items
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('imported_expense_items'))) {
    await knex.schema.createTable('imported_expense_items', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('imported_source_id').notNullable().references('id').inTable('imported_expense_sources').onDelete('CASCADE');
      table.text('source_unique_key').nullable();
      table.text('external_reference').nullable();
      table.text('driver_match_key').nullable();
      table.text('truck_match_key').nullable();
      table.text('card_number').nullable();
      table.date('transaction_date').nullable();
      table.text('description').nullable();
      table.decimal('amount', 14, 2).notNullable();
      table.text('category').nullable();
      table.uuid('matched_driver_id').nullable().references('id').inTable('drivers').onDelete('SET NULL');
      table.uuid('matched_payee_id').nullable().references('id').inTable('payees').onDelete('SET NULL');
      const matchedVehicleId = table.uuid('matched_vehicle_id').nullable();
      if (hasVehicles) {
        matchedVehicleId.references('id').inTable('vehicles').onDelete('SET NULL');
      }
      table.decimal('match_confidence', 5, 4).nullable();
      table.uuid('settlement_adjustment_item_id').nullable().references('id').inTable('settlement_adjustment_items').onDelete('SET NULL');
      table.text('status').notNullable().defaultTo('unmatched'); // unmatched | matched | applied | ignored
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_iei_source ON imported_expense_items(imported_source_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_iei_driver ON imported_expense_items(matched_driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_iei_status ON imported_expense_items(status)');
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('imported_expense_items');
  await knex.schema.dropTableIfExists('imported_expense_sources');
  await knex.schema.dropTableIfExists('recurring_deduction_rules');
  await knex.schema.dropTableIfExists('settlement_adjustment_items');
  await knex.schema.dropTableIfExists('settlement_load_items');
  await knex.schema.dropTableIfExists('settlements');
  await knex.schema.dropTableIfExists('payroll_periods');
  await knex.schema.dropTableIfExists('driver_payee_assignments');
  await knex.schema.dropTableIfExists('expense_responsibility_profiles');
  await knex.schema.dropTableIfExists('driver_compensation_profiles');
  await knex.schema.dropTableIfExists('payees');
};
