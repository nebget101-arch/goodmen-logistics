exports.up = async function up(knex) {
  await knex.schema.alterTable('fmcsa_safety_snapshots', (t) => {
    // US Inspection data (24-month)
    t.integer('vehicle_inspections').nullable();
    t.integer('driver_inspections').nullable();
    t.integer('hazmat_inspections').nullable();
    t.integer('iep_inspections').nullable();
    t.integer('vehicle_oos').nullable();
    t.integer('driver_oos').nullable();
    t.integer('hazmat_oos').nullable();
    t.decimal('vehicle_oos_rate', 5, 1).nullable();
    t.decimal('driver_oos_rate', 5, 1).nullable();
    t.decimal('hazmat_oos_rate', 5, 1).nullable();
    t.decimal('vehicle_oos_national_avg', 5, 2).nullable();
    t.decimal('driver_oos_national_avg', 5, 2).nullable();
    t.decimal('hazmat_oos_national_avg', 5, 2).nullable();

    // US Crash data (24-month)
    t.integer('crashes_fatal').nullable();
    t.integer('crashes_injury').nullable();
    t.integer('crashes_tow').nullable();
    t.integer('crashes_total').nullable();

    // USDOT status (from snapshot page)
    t.text('usdot_status').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('fmcsa_safety_snapshots', (t) => {
    t.dropColumn('vehicle_inspections');
    t.dropColumn('driver_inspections');
    t.dropColumn('hazmat_inspections');
    t.dropColumn('iep_inspections');
    t.dropColumn('vehicle_oos');
    t.dropColumn('driver_oos');
    t.dropColumn('hazmat_oos');
    t.dropColumn('vehicle_oos_rate');
    t.dropColumn('driver_oos_rate');
    t.dropColumn('hazmat_oos_rate');
    t.dropColumn('vehicle_oos_national_avg');
    t.dropColumn('driver_oos_national_avg');
    t.dropColumn('hazmat_oos_national_avg');
    t.dropColumn('crashes_fatal');
    t.dropColumn('crashes_injury');
    t.dropColumn('crashes_tow');
    t.dropColumn('crashes_total');
    t.dropColumn('usdot_status');
  });
};
