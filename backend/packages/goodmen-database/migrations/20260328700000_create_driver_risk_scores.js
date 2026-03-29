/**
 * FN-479: Composite Risk Scoring Engine.
 *
 * Creates the `driver_risk_scores` table for composite (all-category) risk
 * scores, and adds scoring-related columns to the existing `driver_risk_events`
 * table (source_id, source_table, weight_applied, recency_multiplier).
 */
exports.up = async function (knex) {
  // 1. driver_risk_scores — composite scores across all categories
  if (!(await knex.schema.hasTable('driver_risk_scores'))) {
    await knex.schema.createTable('driver_risk_scores', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('driver_id').notNullable();
      t.decimal('score', 5, 2).notNullable().defaultTo(0);
      t.text('risk_level').notNullable().defaultTo('low'); // low|medium|high|critical
      t.text('trend').nullable(); // improving|stable|worsening
      t.jsonb('category_scores').nullable(); // breakdown by category
      t.timestamp('calculated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.integer('event_count').defaultTo(0);
      t.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drs_tenant ON driver_risk_scores(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drs_driver ON driver_risk_scores(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drs_calculated_at ON driver_risk_scores(calculated_at)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drs_risk_level ON driver_risk_scores(risk_level)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drs_tenant_driver ON driver_risk_scores(tenant_id, driver_id)');
  }

  // 2. Add scoring columns to existing driver_risk_events (if missing)
  const hasSourceId = await knex.schema.hasColumn('driver_risk_events', 'source_id');
  if (!hasSourceId) {
    await knex.schema.alterTable('driver_risk_events', (t) => {
      t.uuid('source_id').nullable();
      t.text('source_table').nullable();
      t.decimal('weight_applied', 8, 4).nullable();
      t.decimal('recency_multiplier', 5, 4).nullable();
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dre_source ON driver_risk_events(source_table, source_id)');
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('driver_risk_scores');

  const hasSourceId = await knex.schema.hasColumn('driver_risk_events', 'source_id');
  if (hasSourceId) {
    await knex.schema.alterTable('driver_risk_events', (t) => {
      t.dropColumn('source_id');
      t.dropColumn('source_table');
      t.dropColumn('weight_applied');
      t.dropColumn('recency_multiplier');
    });
  }
};
