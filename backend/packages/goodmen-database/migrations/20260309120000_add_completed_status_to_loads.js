/**
 * Add COMPLETED status to loads (for data with status 'completed' / COMPLETED).
 * Normalizes existing lowercase 'completed' to 'COMPLETED'.
 */
exports.up = async function (knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  await knex.raw(`UPDATE loads SET status = 'COMPLETED' WHERE LOWER(status::text) = 'completed'`);
  await knex.raw(`ALTER TABLE loads DROP CONSTRAINT IF EXISTS loads_status_check`);
  await knex.raw(`
    ALTER TABLE loads
    ADD CONSTRAINT loads_status_check
    CHECK (status IN (
      'DRAFT', 'NEW', 'CANCELLED', 'CANCELED', 'TONU',
      'DISPATCHED', 'EN_ROUTE', 'PICKED_UP', 'PICKED UP',
      'IN_TRANSIT', 'DELIVERED', 'COMPLETED'
    ))
  `);
};

exports.down = async function (knex) {
  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) return;

  await knex.raw(`UPDATE loads SET status = 'DELIVERED' WHERE status = 'COMPLETED'`);
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
