/**
 * Add operation_classification, carrier_operation, and cargo_carried
 * text columns to fmcsa_safety_snapshots.
 *
 * These store comma-separated lists of selected items scraped from the
 * SAFER Company Snapshot checkbox sections.
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('fmcsa_safety_snapshots', (t) => {
    t.text('operation_classification').nullable();
    t.text('carrier_operation').nullable();
    t.text('cargo_carried').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('fmcsa_safety_snapshots', (t) => {
    t.dropColumn('operation_classification');
    t.dropColumn('carrier_operation');
    t.dropColumn('cargo_carried');
  });
};
