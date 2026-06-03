/**
 * Migration: create location_bins table — FN-687
 *
 * Dedicated bin/shelf storage locations within a parent location.
 * Replaces free-text bin_location with a proper FK-based system.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('location_bins', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('location_id').notNullable()
      .references('id').inTable('locations').onDelete('CASCADE');
    t.text('bin_code').notNullable();
    t.text('bin_name').nullable();
    t.text('bin_type').nullable(); // SHELF, RACK, FLOOR, CABINET, FREEZER, OUTDOOR
    t.text('zone').nullable();
    t.text('aisle').nullable();
    t.text('shelf').nullable();
    t.text('position').nullable();
    t.text('capacity_notes').nullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // UNIQUE constraint: one bin_code per location
  await knex.schema.raw(
    'CREATE UNIQUE INDEX uq_location_bins_code ON location_bins (location_id, bin_code)'
  );

  // Tenant lookup index
  await knex.schema.raw(
    'CREATE INDEX idx_location_bins_tenant ON location_bins (tenant_id)'
  );

  // Location + active filter index
  await knex.schema.raw(
    'CREATE INDEX idx_location_bins_location ON location_bins (location_id, active)'
  );
};

exports.down = async function (knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS idx_location_bins_location');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_location_bins_tenant');
  await knex.schema.raw('DROP INDEX IF EXISTS uq_location_bins_code');
  await knex.schema.dropTableIfExists('location_bins');
};
