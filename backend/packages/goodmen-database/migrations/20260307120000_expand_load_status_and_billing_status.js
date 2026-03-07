/**
 * Expand loads.status and loads.billing_status to support additional values.
 * Replaces PostgreSQL enum with VARCHAR + CHECK constraint for flexibility.
 *
 * Load status: New, Canceled, TONU, Dispatched, En Route, Picked-up, Delivered
 * Billing status: Pending, Canceled, BOL received, Invoiced, Sent to factoring, Funded, Paid
 */
exports.up = async function(knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  // Convert status from enum to varchar, allow new values
  await knex.raw(`
    ALTER TABLE loads
    ALTER COLUMN status TYPE VARCHAR(50) USING status::text
  `);
  await knex.raw(`
    ALTER TABLE loads
    DROP CONSTRAINT IF EXISTS loads_status_check
  `);
  await knex.raw(`
    ALTER TABLE loads
    ADD CONSTRAINT loads_status_check
    CHECK (status IN (
      'NEW', 'CANCELLED', 'CANCELED', 'TONU',
      'DISPATCHED', 'EN_ROUTE', 'PICKED_UP', 'PICKED UP',
      'IN_TRANSIT', 'DELIVERED'
    ))
  `);

  // Convert billing_status from enum to varchar, allow new values
  await knex.raw(`
    ALTER TABLE loads
    ALTER COLUMN billing_status TYPE VARCHAR(50) USING billing_status::text
  `);
  await knex.raw(`
    ALTER TABLE loads
    DROP CONSTRAINT IF EXISTS loads_billing_status_check
  `);
  await knex.raw(`
    ALTER TABLE loads
    ADD CONSTRAINT loads_billing_status_check
    CHECK (billing_status IN (
      'PENDING', 'CANCELLED', 'CANCELED', 'BOL_RECEIVED', 'BOL RECEIVED',
      'INVOICED', 'SENT_TO_FACTORING', 'SENT TO FACTORING',
      'FUNDED', 'PAID'
    ))
  `);

  // Drop orphaned enum types (knex may create loads_status_enum etc.)
  for (const name of ['loads_status_enum', 'loads_billing_status_enum']) {
    try {
      await knex.raw(`DROP TYPE IF EXISTS ${name} CASCADE`);
    } catch (_e) { /* ignore */ }
  }
};

exports.down = async function(knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  await knex.raw(`ALTER TABLE loads DROP CONSTRAINT IF EXISTS loads_status_check`);
  await knex.raw(`ALTER TABLE loads DROP CONSTRAINT IF EXISTS loads_billing_status_check`);

  // Restore enum - map unknown values to closest match
  await knex.raw(`
    ALTER TABLE loads
    ALTER COLUMN status TYPE VARCHAR(20)
    USING CASE
      WHEN status IN ('TONU','EN_ROUTE','PICKED_UP','PICKED UP') THEN 'DISPATCHED'
      WHEN status IN ('CANCELED') THEN 'CANCELLED'
      ELSE COALESCE(NULLIF(status, ''), 'NEW')
    END
  `);
  await knex.raw(`
    ALTER TABLE loads
    ALTER COLUMN billing_status TYPE VARCHAR(20)
    USING CASE
      WHEN billing_status IN ('BOL_RECEIVED','BOL RECEIVED','SENT_TO_FACTORING','SENT TO FACTORING') THEN 'INVOICED'
      WHEN billing_status IN ('CANCELED') THEN 'PENDING'
      ELSE COALESCE(NULLIF(billing_status, ''), 'PENDING')
    END
  `);
};
