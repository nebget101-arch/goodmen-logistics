/**
 * FN-1280 — Create nightly rollup tables.
 *
 * Three tables keyed by (tenant_id, day) store pre-aggregated metrics
 * computed by the nightly cron (FN-1279 / rollup.cron.js).  All upserts
 * use ON CONFLICT (tenant_id, day) DO UPDATE, so idempotency is guaranteed
 * at the DB layer.
 *
 * daily_incident_metrics   — per-tenant daily incident KPIs
 * daily_vendor_sla         — per-tenant daily vendor dispatch / SLA KPIs
 * daily_payment_metrics    — per-tenant daily payment KPIs
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // ── daily_incident_metrics ─────────────────────────────────────────────
  const hasIncident = await knex.schema.hasTable('daily_incident_metrics');
  if (!hasIncident) {
    await knex.schema.createTable('daily_incident_metrics', (t) => {
      t.uuid('tenant_id').notNullable();
      t.date('day').notNullable();
      t.integer('total_incidents').notNullable().defaultTo(0);
      t.integer('resolved_incidents').notNullable().defaultTo(0);
      t.integer('critical_incidents').notNullable().defaultTo(0);
      t.float('avg_resolution_hours').nullable();
      t.timestamp('computed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE daily_incident_metrics
      ADD CONSTRAINT uq_daily_incident_metrics_tenant_day
      UNIQUE (tenant_id, day)
    `);

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_daily_incident_metrics_tenant_day
      ON daily_incident_metrics (tenant_id, day DESC)
    `);
  }

  // ── daily_vendor_sla ───────────────────────────────────────────────────
  const hasVendor = await knex.schema.hasTable('daily_vendor_sla');
  if (!hasVendor) {
    await knex.schema.createTable('daily_vendor_sla', (t) => {
      t.uuid('tenant_id').notNullable();
      t.date('day').notNullable();
      t.integer('dispatches_total').notNullable().defaultTo(0);
      t.integer('dispatches_accepted').notNullable().defaultTo(0);
      t.float('avg_eta_minutes').nullable();
      t.float('avg_response_minutes').nullable();
      t.integer('sla_met_count').notNullable().defaultTo(0);
      t.timestamp('computed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE daily_vendor_sla
      ADD CONSTRAINT uq_daily_vendor_sla_tenant_day
      UNIQUE (tenant_id, day)
    `);

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_daily_vendor_sla_tenant_day
      ON daily_vendor_sla (tenant_id, day DESC)
    `);
  }

  // ── daily_payment_metrics ──────────────────────────────────────────────
  const hasPayment = await knex.schema.hasTable('daily_payment_metrics');
  if (!hasPayment) {
    await knex.schema.createTable('daily_payment_metrics', (t) => {
      t.uuid('tenant_id').notNullable();
      t.date('day').notNullable();
      t.integer('payment_count').notNullable().defaultTo(0);
      t.float('total_amount').notNullable().defaultTo(0);
      t.float('avg_payment_amount').nullable();
      t.integer('failed_count').notNullable().defaultTo(0);
      t.timestamp('computed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE daily_payment_metrics
      ADD CONSTRAINT uq_daily_payment_metrics_tenant_day
      UNIQUE (tenant_id, day)
    `);

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_daily_payment_metrics_tenant_day
      ON daily_payment_metrics (tenant_id, day DESC)
    `);
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('daily_payment_metrics');
  await knex.schema.dropTableIfExists('daily_vendor_sla');
  await knex.schema.dropTableIfExists('daily_incident_metrics');
};
