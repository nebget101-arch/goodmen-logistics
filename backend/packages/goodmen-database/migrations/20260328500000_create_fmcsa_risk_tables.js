/**
 * FN-473: Create FMCSA Inspection, Violation, Risk Scoring & Risk Event Tables.
 * Supports the FMCSA driver safety intelligence system: roadside inspections,
 * individual violations, composite risk scores, MVR/PSP extracted records,
 * and a full lifecycle driver risk event log.
 */
exports.up = async function (knex) {
  // 1. fmcsa_inspections
  if (!(await knex.schema.hasTable('fmcsa_inspections'))) {
    await knex.schema.createTable('fmcsa_inspections', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.text('report_number').notNullable().unique();
      t.date('inspection_date').notNullable();
      t.text('inspection_state').notNullable();
      t.text('inspection_type').notNullable();
      t.text('carrier_id').nullable();
      t.text('carrier_name').nullable();
      t.text('vehicle_vin').nullable();
      t.text('vehicle_plate').nullable();
      t.text('vehicle_state').nullable();
      t.text('driver_cdl').nullable();
      t.text('driver_name_raw').nullable();
      // Fleet matching
      t.uuid('truck_id').nullable();
      t.uuid('driver_id').nullable();
      t.text('match_status').notNullable().defaultTo('unmatched');
      t.decimal('match_confidence', 5, 2).nullable();
      t.text('match_method').nullable();
      t.text('match_notes').nullable();
      // Outcome
      t.boolean('out_of_service_vehicle').defaultTo(false);
      t.boolean('out_of_service_driver').defaultTo(false);
      t.integer('oos_violation_count').defaultTo(0);
      t.integer('total_violation_count').defaultTo(0);
      t.decimal('severity_weight', 8, 4).nullable();
      t.text('source').defaultTo('fmcsa_api');
      t.jsonb('raw_payload').nullable();
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fmcsa_insp_tenant ON fmcsa_inspections(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fmcsa_insp_date ON fmcsa_inspections(inspection_date)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fmcsa_insp_truck ON fmcsa_inspections(truck_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fmcsa_insp_driver ON fmcsa_inspections(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fmcsa_insp_match_status ON fmcsa_inspections(match_status)');
    // report_number unique index is created by .unique() above; no extra raw needed
  }

  // 2. fmcsa_violations
  if (!(await knex.schema.hasTable('fmcsa_violations'))) {
    await knex.schema.createTable('fmcsa_violations', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('inspection_id').notNullable().references('id').inTable('fmcsa_inspections').onDelete('CASCADE');
      t.text('violation_code').notNullable();
      t.text('violation_description').nullable();
      t.text('basic_category').nullable();
      t.integer('severity').defaultTo(1);
      t.boolean('oos_violation').defaultTo(false);
      t.text('unit_type').nullable();
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fmcsa_viol_inspection ON fmcsa_violations(inspection_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fmcsa_viol_tenant ON fmcsa_violations(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fmcsa_viol_basic_category ON fmcsa_violations(basic_category)');
  }

  // 3. fmcsa_driver_risk_scores
  if (!(await knex.schema.hasTable('fmcsa_driver_risk_scores'))) {
    await knex.schema.createTable('fmcsa_driver_risk_scores', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('driver_id').notNullable();
      t.date('score_date').notNullable().defaultTo(knex.raw('CURRENT_DATE'));
      t.decimal('composite_score', 5, 2).notNullable().defaultTo(0);
      // Component scores
      t.decimal('inspection_score', 5, 2).defaultTo(0);
      t.decimal('oos_score', 5, 2).defaultTo(0);
      t.decimal('violation_score', 5, 2).defaultTo(0);
      t.decimal('mvr_score', 5, 2).defaultTo(0);
      t.decimal('accident_score', 5, 2).defaultTo(0);
      // Trend
      t.decimal('previous_score', 5, 2).nullable();
      t.decimal('score_delta', 5, 2).nullable();
      t.text('trend').defaultTo('stable');
      // Metadata
      t.integer('inspection_count').defaultTo(0);
      t.integer('oos_count').defaultTo(0);
      t.integer('violation_count').defaultTo(0);
      t.integer('lookback_days').defaultTo(365);
      t.text('calculation_notes').nullable();
      t.timestamps(true, true);
    });

    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_fdrs_tenant_driver_date ON fmcsa_driver_risk_scores(tenant_id, driver_id, score_date)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fdrs_tenant ON fmcsa_driver_risk_scores(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fdrs_driver ON fmcsa_driver_risk_scores(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fdrs_score_date ON fmcsa_driver_risk_scores(score_date)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_fdrs_composite_score ON fmcsa_driver_risk_scores(composite_score)');
  }

  // 4. mvr_extracted_records
  if (!(await knex.schema.hasTable('mvr_extracted_records'))) {
    await knex.schema.createTable('mvr_extracted_records', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('driver_id').notNullable();
      t.text('document_type').notNullable().defaultTo('mvr');
      t.text('document_ref').nullable();
      t.timestamp('extraction_date', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.text('record_type').notNullable();
      t.date('record_date').nullable();
      t.text('state').nullable();
      t.text('description').nullable();
      t.text('violation_code').nullable();
      t.text('severity').nullable();
      t.date('conviction_date').nullable();
      t.integer('points').defaultTo(0);
      t.boolean('is_dui').defaultTo(false);
      t.boolean('is_preventable').nullable();
      t.boolean('at_fault').nullable();
      t.integer('injuries').defaultTo(0);
      t.integer('fatalities').defaultTo(0);
      t.text('license_class').nullable();
      t.integer('suspension_days').nullable();
      t.text('raw_text').nullable();
      t.decimal('ai_confidence', 5, 2).nullable();
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_mvr_tenant ON mvr_extracted_records(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_mvr_driver ON mvr_extracted_records(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_mvr_record_type ON mvr_extracted_records(record_type)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_mvr_record_date ON mvr_extracted_records(record_date)');
  }

  // 5. driver_risk_events
  if (!(await knex.schema.hasTable('driver_risk_events'))) {
    await knex.schema.createTable('driver_risk_events', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('driver_id').notNullable();
      t.text('event_type').notNullable();
      t.timestamp('event_date', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.text('severity').defaultTo('info');
      t.text('title').notNullable();
      t.text('description').nullable();
      // Source references
      t.uuid('fmcsa_inspection_id').nullable().references('id').inTable('fmcsa_inspections').onDelete('SET NULL');
      t.uuid('mvr_record_id').nullable().references('id').inTable('mvr_extracted_records').onDelete('SET NULL');
      // Score impact
      t.decimal('score_before', 5, 2).nullable();
      t.decimal('score_after', 5, 2).nullable();
      t.decimal('score_delta', 5, 2).nullable();
      // Resolution
      t.boolean('is_resolved').defaultTo(false);
      t.timestamp('resolved_at', { useTz: true }).nullable();
      t.uuid('resolved_by').nullable();
      t.text('resolution_notes').nullable();
      // Meta
      t.uuid('created_by').nullable();
      t.jsonb('metadata').nullable();
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dre_tenant ON driver_risk_events(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dre_driver ON driver_risk_events(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dre_event_type ON driver_risk_events(event_type)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dre_event_date ON driver_risk_events(event_date)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dre_severity ON driver_risk_events(severity)');
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('driver_risk_events');
  await knex.schema.dropTableIfExists('mvr_extracted_records');
  await knex.schema.dropTableIfExists('fmcsa_driver_risk_scores');
  await knex.schema.dropTableIfExists('fmcsa_violations');
  await knex.schema.dropTableIfExists('fmcsa_inspections');
};
