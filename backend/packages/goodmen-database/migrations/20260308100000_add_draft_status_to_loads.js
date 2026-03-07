/**
 * Add DRAFT status to loads for bulk-uploaded rate confirmations before validation.
 */
exports.up = async function(knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  await knex.raw(`ALTER TABLE loads DROP CONSTRAINT IF EXISTS loads_status_check`);
  await knex.raw(`
    ALTER TABLE loads
    ADD CONSTRAINT loads_status_check
    CHECK (status IN (
      'DRAFT', 'NEW', 'CANCELLED', 'CANCELED', 'TONU',
      'DISPATCHED', 'EN_ROUTE', 'PICKED_UP', 'PICKED UP',
      'IN_TRANSIT', 'DELIVERED'
    ))
  `);
};

exports.down = async function(knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  await knex.raw(`UPDATE loads SET status = 'NEW' WHERE status = 'DRAFT'`);
  await knex.raw(`ALTER TABLE loads DROP CONSTRAINT IF EXISTS loads_status_check`);
  await knex.raw(`
    ALTER TABLE loads
    ADD CONSTRAINT loads_status_check
    CHECK (status IN (
      'NEW', 'CANCELLED', 'CANCELED', 'TONU',
      'DISPATCHED', 'EN_ROUTE', 'PICKED_UP', 'PICKED UP',
      'IN_TRANSIT', 'DELIVERED'
    ))
  `);
};
