/* eslint-disable no-console */
const knexFactory = require('knex');
const knexfile = require('../knexfile');

async function run() {
  const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const config = knexfile[env] || knexfile.production;
  const knex = knexFactory(config);

  try {
    const hasLoads = await knex.schema.hasTable('loads');
    if (!hasLoads) {
      console.log('[pre-migrate] loads table not found, skipping normalization');
      return;
    }

    const hasStatus = await knex.schema.hasColumn('loads', 'status');
    const hasBillingStatus = await knex.schema.hasColumn('loads', 'billing_status');

    if (hasStatus) {
      // Normalize status to values accepted by older load status constraints.
      await knex.raw(`
        UPDATE loads
        SET status = CASE
          WHEN status IS NULL OR TRIM(status::text) = '' THEN 'NEW'
          WHEN UPPER(REGEXP_REPLACE(TRIM(status::text), '[^A-Z0-9]+', '_', 'g')) IN ('NEW') THEN 'NEW'
          WHEN UPPER(REGEXP_REPLACE(TRIM(status::text), '[^A-Z0-9]+', '_', 'g')) IN ('DRAFT') THEN 'NEW'
          WHEN UPPER(REGEXP_REPLACE(TRIM(status::text), '[^A-Z0-9]+', '_', 'g')) IN ('CANCELLED') THEN 'CANCELLED'
          WHEN UPPER(REGEXP_REPLACE(TRIM(status::text), '[^A-Z0-9]+', '_', 'g')) IN ('CANCELED') THEN 'CANCELED'
          WHEN UPPER(REGEXP_REPLACE(TRIM(status::text), '[^A-Z0-9]+', '_', 'g')) IN ('TONU') THEN 'TONU'
          WHEN UPPER(REGEXP_REPLACE(TRIM(status::text), '[^A-Z0-9]+', '_', 'g')) IN ('DISPATCHED') THEN 'DISPATCHED'
          WHEN UPPER(REGEXP_REPLACE(TRIM(status::text), '[^A-Z0-9]+', '_', 'g')) IN ('EN_ROUTE', 'ENROUTE') THEN 'EN_ROUTE'
          WHEN UPPER(REGEXP_REPLACE(TRIM(status::text), '[^A-Z0-9]+', '_', 'g')) IN ('PICKED_UP', 'PICKEDUP') THEN 'PICKED_UP'
          WHEN UPPER(REGEXP_REPLACE(TRIM(status::text), '[^A-Z0-9]+', '_', 'g')) IN ('IN_TRANSIT', 'INTRANSIT') THEN 'IN_TRANSIT'
          WHEN UPPER(REGEXP_REPLACE(TRIM(status::text), '[^A-Z0-9]+', '_', 'g')) IN ('DELIVERED', 'COMPLETE', 'COMPLETED') THEN 'DELIVERED'
          ELSE 'NEW'
        END
      `);
      console.log('[pre-migrate] loads.status normalized');
    }

    if (hasBillingStatus) {
      await knex.raw(`
        UPDATE loads
        SET billing_status = CASE
          WHEN billing_status IS NULL OR TRIM(billing_status::text) = '' THEN 'PENDING'
          WHEN UPPER(REGEXP_REPLACE(TRIM(billing_status::text), '[^A-Z0-9]+', '_', 'g')) IN ('PENDING') THEN 'PENDING'
          WHEN UPPER(REGEXP_REPLACE(TRIM(billing_status::text), '[^A-Z0-9]+', '_', 'g')) IN ('CANCELLED') THEN 'CANCELLED'
          WHEN UPPER(REGEXP_REPLACE(TRIM(billing_status::text), '[^A-Z0-9]+', '_', 'g')) IN ('CANCELED') THEN 'CANCELED'
          WHEN UPPER(REGEXP_REPLACE(TRIM(billing_status::text), '[^A-Z0-9]+', '_', 'g')) IN ('BOL_RECEIVED', 'BOLRECEIVED') THEN 'BOL_RECEIVED'
          WHEN UPPER(REGEXP_REPLACE(TRIM(billing_status::text), '[^A-Z0-9]+', '_', 'g')) IN ('INVOICED') THEN 'INVOICED'
          WHEN UPPER(REGEXP_REPLACE(TRIM(billing_status::text), '[^A-Z0-9]+', '_', 'g')) IN ('SENT_TO_FACTORING', 'SENTTOFACTORING') THEN 'SENT_TO_FACTORING'
          WHEN UPPER(REGEXP_REPLACE(TRIM(billing_status::text), '[^A-Z0-9]+', '_', 'g')) IN ('FUNDED') THEN 'FUNDED'
          WHEN UPPER(REGEXP_REPLACE(TRIM(billing_status::text), '[^A-Z0-9]+', '_', 'g')) IN ('PAID') THEN 'PAID'
          ELSE 'PENDING'
        END
      `);
      console.log('[pre-migrate] loads.billing_status normalized');
    }
  } finally {
    await knex.destroy();
  }
}

run()
  .then(() => {
    console.log('[pre-migrate] normalization complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[pre-migrate] normalization failed:', err.message);
    process.exit(1);
  });
