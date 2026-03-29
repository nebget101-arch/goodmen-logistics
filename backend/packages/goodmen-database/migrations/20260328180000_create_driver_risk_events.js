'use strict';

/**
 * FN-474: Create driver_risk_events table for tracking safety events
 * from FMCSA inspections, accidents, HOS violations, etc.
 * Also adds match columns to fmcsa_inspection_history for fleet matching.
 */

exports.up = async function (knex) {
  // 1. driver_risk_events — stores matched safety events per driver
  if (!(await knex.schema.hasTable('driver_risk_events'))) {
    await knex.schema.createTable('driver_risk_events', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('driver_id').notNullable().references('id').inTable('drivers').onDelete('CASCADE');
      t.uuid('vehicle_id').nullable().references('id').inTable('vehicles').onDelete('SET NULL');
      t.text('event_type').notNullable(); // inspection, violation, accident, hos_violation, claim
      t.text('event_source').notNullable().defaultTo('fmcsa'); // fmcsa, manual, eld, insurance
      t.text('source_id').nullable(); // FK to source record (e.g., fmcsa_inspection_history.id)
      t.date('event_date').notNullable();
      t.text('description').nullable();
      t.text('severity').notNullable().defaultTo('low'); // low, medium, high, critical
      t.integer('severity_weight').notNullable().defaultTo(1);
      t.boolean('oos_flag').notNullable().defaultTo(false); // out of service
      t.integer('violation_count').notNullable().defaultTo(0);
      t.jsonb('details').nullable(); // full event details (violations, etc.)
      t.text('match_method').nullable(); // vin, plate, cdl, name_fuzzy, manual
      t.decimal('match_confidence', 5, 4).nullable();
      t.text('resolution_status').notNullable().defaultTo('open'); // open, acknowledged, resolved, disputed
      t.text('resolution_notes').nullable();
      t.uuid('resolved_by').nullable();
      t.timestamp('resolved_at').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_driver_risk_events_tenant ON driver_risk_events(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_driver_risk_events_driver ON driver_risk_events(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_driver_risk_events_date ON driver_risk_events(event_date DESC)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_driver_risk_events_type ON driver_risk_events(event_type)');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_risk_events_source ON driver_risk_events(driver_id, event_source, source_id) WHERE source_id IS NOT NULL');
  }

  // 2. Add match columns to fmcsa_inspection_history
  const hasMatchStatus = await knex.schema.hasColumn('fmcsa_inspection_history', 'match_status');
  if (!hasMatchStatus) {
    await knex.schema.alterTable('fmcsa_inspection_history', (t) => {
      t.text('match_status').defaultTo('unmatched'); // unmatched, matched, manual, failed
      t.text('match_method').nullable(); // vin, plate, cdl, name_fuzzy, manual
      t.decimal('match_confidence', 5, 4).nullable();
      t.uuid('matched_driver_id').nullable();
      t.uuid('matched_vehicle_id').nullable();
      t.uuid('matched_by_user_id').nullable();
      t.timestamp('matched_at').nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasMatchStatus = await knex.schema.hasColumn('fmcsa_inspection_history', 'match_status');
  if (hasMatchStatus) {
    await knex.schema.alterTable('fmcsa_inspection_history', (t) => {
      t.dropColumn('match_status');
      t.dropColumn('match_method');
      t.dropColumn('match_confidence');
      t.dropColumn('matched_driver_id');
      t.dropColumn('matched_vehicle_id');
      t.dropColumn('matched_by_user_id');
      t.dropColumn('matched_at');
    });
  }
  await knex.schema.dropTableIfExists('driver_risk_events');
};
