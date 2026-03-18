'use strict';

function normalizeMc(value) {
  const v = (value || '').toString().trim().toUpperCase();
  return v || null;
}

exports.up = async function up(knex) {
  const hasBrokers = await knex.schema.hasTable('brokers');
  if (!hasBrokers) return;

  const hasTenants = await knex.schema.hasTable('tenants');
  if (!hasTenants) return;

  // 1) Create tenant overlay table for broker custom fields.
  const hasOverrides = await knex.schema.hasTable('tenant_broker_overrides');
  if (!hasOverrides) {
    await knex.schema.createTable('tenant_broker_overrides', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.uuid('broker_id').notNullable().references('id').inTable('brokers').onDelete('CASCADE');
      table.decimal('credit_score', 5, 2).nullable();
      table.string('payment_rating', 20).nullable();
      table.text('broker_notes').nullable();
      table.boolean('is_blocked').notNullable().defaultTo(false);
      table.boolean('is_preferred').notNullable().defaultTo(false);
      table.timestamps(true, true);
      table.unique(['tenant_id', 'broker_id']);
    });
  }

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_tbo_tenant ON tenant_broker_overrides(tenant_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_tbo_broker ON tenant_broker_overrides(broker_id)');

  const hasTenantCol = await knex.schema.hasColumn('brokers', 'tenant_id');
  if (!hasTenantCol) {
    return;
  }

  const brokerRows = await knex('brokers')
    .select(
      'id',
      'tenant_id',
      'mc_number',
      'credit_score',
      'payment_rating',
      'broker_notes',
      'created_at'
    )
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc');

  const canonicalByMc = new Map(); // mc -> canonical broker_id
  const canonicalByBrokerId = new Map(); // source broker_id -> canonical broker_id

  for (const row of brokerRows) {
    const mc = normalizeMc(row.mc_number);
    if (!mc) {
      canonicalByBrokerId.set(row.id, row.id);
      continue;
    }
    if (!canonicalByMc.has(mc)) {
      canonicalByMc.set(mc, row.id);
    }
    canonicalByBrokerId.set(row.id, canonicalByMc.get(mc));
  }

  const hasLoads = await knex.schema.hasTable('loads');
  if (hasLoads) {
    for (const row of brokerRows) {
      const canonicalId = canonicalByBrokerId.get(row.id);
      if (!canonicalId || canonicalId === row.id) continue;
      // eslint-disable-next-line no-await-in-loop
      await knex('loads').where({ broker_id: row.id }).update({ broker_id: canonicalId });
    }
  }

  for (const row of brokerRows) {
    if (!row.tenant_id) continue;
    const canonicalId = canonicalByBrokerId.get(row.id) || row.id;

    // eslint-disable-next-line no-await-in-loop
    await knex.raw(
      `
      INSERT INTO tenant_broker_overrides (
        tenant_id, broker_id, credit_score, payment_rating, broker_notes,
        is_blocked, is_preferred, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, false, false, NOW(), NOW())
      ON CONFLICT (tenant_id, broker_id)
      DO UPDATE SET
        credit_score = COALESCE(EXCLUDED.credit_score, tenant_broker_overrides.credit_score),
        payment_rating = COALESCE(EXCLUDED.payment_rating, tenant_broker_overrides.payment_rating),
        broker_notes = COALESCE(EXCLUDED.broker_notes, tenant_broker_overrides.broker_notes),
        updated_at = NOW()
      `,
      [row.tenant_id, canonicalId, row.credit_score, row.payment_rating, row.broker_notes]
    );
  }

  const duplicateBrokerIds = brokerRows
    .filter((row) => {
      const mc = normalizeMc(row.mc_number);
      if (!mc) return false;
      const canonicalId = canonicalByBrokerId.get(row.id);
      return canonicalId && canonicalId !== row.id;
    })
    .map((row) => row.id);

  if (duplicateBrokerIds.length > 0) {
    await knex('brokers').whereIn('id', duplicateBrokerIds).delete();
  }

  await knex.raw('DROP INDEX IF EXISTS idx_brokers_tenant_id');

  const stillHasTenantCol = await knex.schema.hasColumn('brokers', 'tenant_id');
  if (stillHasTenantCol) {
    await knex.schema.alterTable('brokers', (table) => {
      table.dropColumn('tenant_id');
    });
  }
};

exports.down = async function down(knex) {
  const hasBrokers = await knex.schema.hasTable('brokers');
  if (!hasBrokers) return;

  const hasTenants = await knex.schema.hasTable('tenants');
  if (!hasTenants) return;

  const hasTenantCol = await knex.schema.hasColumn('brokers', 'tenant_id');
  if (!hasTenantCol) {
    await knex.schema.alterTable('brokers', (table) => {
      table.uuid('tenant_id').nullable().references('id').inTable('tenants').onDelete('RESTRICT');
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_brokers_tenant_id ON brokers(tenant_id)');
  }

  const hasOverrides = await knex.schema.hasTable('tenant_broker_overrides');
  if (hasOverrides) {
    // Best-effort rollback: choose the earliest override row per broker and
    // copy fields back to brokers. (Deduplicated broker rows are not expanded.)
    const overrides = await knex('tenant_broker_overrides')
      .select('tenant_id', 'broker_id', 'credit_score', 'payment_rating', 'broker_notes', 'created_at')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc');

    const firstByBroker = new Map();
    for (const row of overrides) {
      if (!firstByBroker.has(row.broker_id)) {
        firstByBroker.set(row.broker_id, row);
      }
    }

    for (const [, row] of firstByBroker.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await knex('brokers')
        .where({ id: row.broker_id })
        .update({
          tenant_id: row.tenant_id,
          credit_score: row.credit_score,
          payment_rating: row.payment_rating,
          broker_notes: row.broker_notes,
          updated_at: knex.fn.now(),
        });
    }

    await knex.raw('DROP INDEX IF EXISTS idx_tbo_tenant');
    await knex.raw('DROP INDEX IF EXISTS idx_tbo_broker');
    await knex.schema.dropTableIfExists('tenant_broker_overrides');
  }
};
