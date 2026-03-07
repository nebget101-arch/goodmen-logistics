/**
 * Extend brokers table for EzLoads dataset: legal_name, dba_name, authority_type,
 * status, street, country, optional AI scoring columns. Add indexes for dispatcher search.
 */
exports.up = async function(knex) {
  const hasBrokers = await knex.schema.hasTable('brokers');
  if (!hasBrokers) {
    await knex.schema.createTable('brokers', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('legal_name').notNullable();
      table.text('dba_name');
      table.string('mc_number', 20);
      table.string('dot_number', 20);
      table.string('authority_type', 20);
      table.string('status', 20);
      table.string('phone', 20);
      table.text('email');
      table.text('street');
      table.string('city', 100);
      table.string('state', 20);
      table.string('zip', 20);
      table.string('country', 20).defaultTo('US');
      table.timestamps(true, true);
      // Optional columns for future AI load scoring
      table.decimal('credit_score', 5, 2);
      table.string('payment_rating', 20);
      table.date('insurance_expiry');
      table.text('broker_notes');
    });
  } else {
    const addCol = async (col, cb) => {
      const exists = await knex.schema.hasColumn('brokers', col);
      if (!exists) await knex.schema.alterTable('brokers', cb);
    };
    await addCol('legal_name', (t) => t.text('legal_name'));
    await addCol('dba_name', (t) => t.text('dba_name'));
    await addCol('authority_type', (t) => t.string('authority_type', 20));
    await addCol('status', (t) => t.string('status', 20));
    await addCol('street', (t) => t.text('street'));
    await addCol('country', (t) => t.string('country', 20).defaultTo('US'));
    await addCol('credit_score', (t) => t.decimal('credit_score', 5, 2));
    await addCol('payment_rating', (t) => t.string('payment_rating', 20));
    await addCol('insurance_expiry', (t) => t.date('insurance_expiry'));
    await addCol('broker_notes', (t) => t.text('broker_notes'));

    // Backfill legal_name from name for existing rows
    const hasName = await knex.schema.hasColumn('brokers', 'name');
    const hasLegalName = await knex.schema.hasColumn('brokers', 'legal_name');
    if (hasName && hasLegalName) {
      await knex.raw(
        `UPDATE brokers SET legal_name = COALESCE(NULLIF(TRIM(legal_name), ''), name, 'Unknown') WHERE legal_name IS NULL OR TRIM(legal_name) = ''`
      );
    }
    // Set legal_name NOT NULL only after backfill
    try {
      await knex.raw(
        `ALTER TABLE brokers ALTER COLUMN legal_name SET NOT NULL`
      );
    } catch (e) {
      // Ignore if already NOT NULL
    }
  }

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_broker_mc ON brokers(mc_number)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_broker_dot ON brokers(dot_number)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_broker_name ON brokers(legal_name)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_broker_state ON brokers(state)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_broker_city ON brokers(city)');
};

exports.down = async function(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_broker_city');
  await knex.raw('DROP INDEX IF EXISTS idx_broker_state');
  await knex.raw('DROP INDEX IF EXISTS idx_broker_name');
  await knex.raw('DROP INDEX IF EXISTS idx_broker_dot');
  await knex.raw('DROP INDEX IF EXISTS idx_broker_mc');

  const hasBrokers = await knex.schema.hasTable('brokers');
  if (hasBrokers) {
    const dropCol = async (col) => {
      const exists = await knex.schema.hasColumn('brokers', col);
      if (exists) await knex.schema.alterTable('brokers', (t) => t.dropColumn(col));
    };
    await dropCol('broker_notes');
    await dropCol('insurance_expiry');
    await dropCol('payment_rating');
    await dropCol('credit_score');
    await dropCol('country');
    await dropCol('street');
    await dropCol('status');
    await dropCol('authority_type');
    await dropCol('dba_name');
    await dropCol('legal_name');
  }
};
