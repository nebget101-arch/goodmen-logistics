/**
 * Expand driver schema with driver_licenses and driver_compliance tables
 * plus additional employment/pay fields on drivers.
 *
 * Idempotent and safe to re-run.
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // 1) Ensure drivers table exists (legacy schema)
  const hasDrivers = await knex.schema.hasTable('drivers');
  if (!hasDrivers) {
    // Nothing to do – schema.sql not applied in this environment.
    return;
  }

  // 2) Create driver_licenses table
  const hasDriverLicenses = await knex.schema.hasTable('driver_licenses');
  if (!hasDriverLicenses) {
    await knex.schema.createTable('driver_licenses', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table
        .uuid('driver_id')
        .notNullable()
        .references('id')
        .inTable('drivers')
        .onDelete('CASCADE');
      table.text('cdl_state').notNullable();
      table.text('cdl_number').notNullable();
      table.text('cdl_class');
      table.text('endorsements');
      table.date('cdl_expiry');

      table.unique(['driver_id']);
      table.unique(['cdl_state', 'cdl_number']);
    });
  }

  // 3) Create driver_compliance table
  const hasDriverCompliance = await knex.schema.hasTable('driver_compliance');
  if (!hasDriverCompliance) {
    await knex.schema.createTable('driver_compliance', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table
        .uuid('driver_id')
        .notNullable()
        .references('id')
        .inTable('drivers')
        .onDelete('CASCADE');
      table.date('medical_cert_expiry');
      table.date('last_mvr_check');
      table.text('clearinghouse_status').defaultTo('unknown');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.unique(['driver_id']);
    });
  }

  // 4) Add new employment/pay fields to drivers if missing
  const addColumnIfMissing = async (columnName, cb) => {
    const hasCol = await knex.schema.hasColumn('drivers', columnName);
    if (!hasCol) {
      await knex.schema.alterTable('drivers', cb);
    }
  };

  await addColumnIfMissing('driver_type', (table) => {
    table
      .text('driver_type')
      .notNullable()
      .defaultTo('company')
      .checkIn(['company', 'owner_operator']);
  });

  await addColumnIfMissing('pay_basis', (table) => {
    table
      .text('pay_basis')
      .nullable()
      .checkIn(['per_mile', 'percentage', 'flatpay', 'hourly']);
  });

  await addColumnIfMissing('pay_rate', (table) => {
    table.decimal('pay_rate', 10, 4).nullable();
  });

  await addColumnIfMissing('pay_percentage', (table) => {
    table.decimal('pay_percentage', 5, 2).nullable();
  });

  await addColumnIfMissing('termination_date', (table) => {
    table.date('termination_date').nullable();
  });

  await addColumnIfMissing('truck_id', (table) => {
    table.uuid('truck_id').nullable();
  });

  await addColumnIfMissing('trailer_id', (table) => {
    table.uuid('trailer_id').nullable();
  });

  await addColumnIfMissing('co_driver_id', (table) => {
    table
      .uuid('co_driver_id')
      .nullable()
      .references('id')
      .inTable('drivers');
  });
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');

  // Drop aux tables if they exist
  await knex.schema.dropTableIfExists('driver_compliance');
  await knex.schema.dropTableIfExists('driver_licenses');

  if (!hasDrivers) return;

  // Remove added columns from drivers (guarded)
  const dropColumnIfExists = async (columnName) => {
    const hasCol = await knex.schema.hasColumn('drivers', columnName);
    if (hasCol) {
      await knex.schema.alterTable('drivers', (table) => {
        table.dropColumn(columnName);
      });
    }
  };

  await dropColumnIfExists('driver_type');
  await dropColumnIfExists('pay_basis');
  await dropColumnIfExists('pay_rate');
  await dropColumnIfExists('pay_percentage');
  await dropColumnIfExists('termination_date');
  await dropColumnIfExists('truck_id');
  await dropColumnIfExists('trailer_id');
  await dropColumnIfExists('co_driver_id');
};

