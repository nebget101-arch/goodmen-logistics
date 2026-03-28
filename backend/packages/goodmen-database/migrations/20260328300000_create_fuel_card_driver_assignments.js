/**
 * FN-460: Create fuel_card_driver_assignments table.
 * Tracks which driver is assigned to which fuel card, with history.
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('fuel_card_driver_assignments');
  if (exists) return;

  await knex.schema.createTable('fuel_card_driver_assignments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable();
    table.uuid('fuel_card_account_id').notNullable();
    table.uuid('driver_id').notNullable();
    table.string('card_number_last4', 4).nullable();
    table.date('assigned_date').notNullable().defaultTo(knex.fn.now());
    table.date('revoked_date').nullable();
    table.text('status').notNullable().defaultTo('active');
    table.uuid('assigned_by').nullable();
    table.uuid('revoked_by').nullable();
    table.text('notes').nullable();
    table.timestamps(true, true);
  });

  // FK: fuel_card_account_id → fuel_card_accounts.id
  const hasFuelCardAccounts = await knex.schema.hasTable('fuel_card_accounts');
  if (hasFuelCardAccounts) {
    await knex.raw(`
      ALTER TABLE fuel_card_driver_assignments
        ADD CONSTRAINT fk_fcda_fuel_card_account
        FOREIGN KEY (fuel_card_account_id) REFERENCES fuel_card_accounts(id)
        ON DELETE CASCADE;
    `);
  }

  // FK: driver_id → drivers.id
  const hasDrivers = await knex.schema.hasTable('drivers');
  if (hasDrivers) {
    await knex.raw(`
      ALTER TABLE fuel_card_driver_assignments
        ADD CONSTRAINT fk_fcda_driver
        FOREIGN KEY (driver_id) REFERENCES drivers(id)
        ON DELETE CASCADE;
    `);
  }

  // CHECK constraint on status
  await knex.raw(`
    ALTER TABLE fuel_card_driver_assignments
      ADD CONSTRAINT chk_fcda_status
      CHECK (status IN ('active', 'revoked'));
  `);

  // Indexes
  await knex.raw(`
    CREATE INDEX idx_fcda_tenant ON fuel_card_driver_assignments(tenant_id);
  `);
  await knex.raw(`
    CREATE INDEX idx_fcda_card ON fuel_card_driver_assignments(fuel_card_account_id);
  `);
  await knex.raw(`
    CREATE INDEX idx_fcda_driver ON fuel_card_driver_assignments(driver_id);
  `);

  // Unique partial index: one active driver per card
  await knex.raw(`
    CREATE UNIQUE INDEX idx_fcda_one_active_per_card
    ON fuel_card_driver_assignments(fuel_card_account_id)
    WHERE status = 'active';
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('fuel_card_driver_assignments');
};
