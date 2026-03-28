/**
 * FN-483: Create fuel_cards table for Account -> Card hierarchy.
 *
 * fuel_cards holds individual cards under a fuel_card_account.
 * Also adds fuel_card_id to fuel_card_driver_assignments so
 * assignments can optionally reference a specific card.
 */
exports.up = async function (knex) {
  // ─── 1. fuel_cards table ──────────────────────────────────────────────────────
  const hasTable = await knex.schema.hasTable('fuel_cards');
  if (!hasTable) {
    await knex.schema.createTable('fuel_cards', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('fuel_card_account_id').notNullable();
      t.text('card_number_masked').notNullable();
      t.text('card_number_last4').nullable();
      t.text('status').notNullable().defaultTo('active'); // active | inactive | lost | stolen
      t.text('notes').nullable();
      t.timestamps(true, true);
    });

    // FK: fuel_card_account_id -> fuel_card_accounts.id
    const hasFuelCardAccounts = await knex.schema.hasTable('fuel_card_accounts');
    if (hasFuelCardAccounts) {
      await knex.raw(`
        ALTER TABLE fuel_cards
          ADD CONSTRAINT fk_fc_fuel_card_account
          FOREIGN KEY (fuel_card_account_id) REFERENCES fuel_card_accounts(id)
          ON DELETE CASCADE;
      `);
    }

    // CHECK constraint on status
    await knex.raw(`
      ALTER TABLE fuel_cards
        ADD CONSTRAINT chk_fc_status
        CHECK (status IN ('active', 'inactive', 'lost', 'stolen'));
    `);

    // Indexes
    await knex.raw('CREATE INDEX idx_fc_tenant ON fuel_cards(tenant_id)');
    await knex.raw('CREATE INDEX idx_fc_account ON fuel_cards(fuel_card_account_id)');
    await knex.raw('CREATE UNIQUE INDEX uq_fc_tenant_card_number ON fuel_cards(tenant_id, card_number_masked)');
  }

  // ─── 2. Add fuel_card_id to fuel_card_driver_assignments ──────────────────────
  const hasAssignments = await knex.schema.hasTable('fuel_card_driver_assignments');
  if (hasAssignments) {
    const hasCol = await knex.schema.hasColumn('fuel_card_driver_assignments', 'fuel_card_id');
    if (!hasCol) {
      await knex.schema.alterTable('fuel_card_driver_assignments', (t) => {
        t.uuid('fuel_card_id').nullable();
      });

      // FK: fuel_card_id -> fuel_cards.id
      if (!hasTable) {
        await knex.raw(`
          ALTER TABLE fuel_card_driver_assignments
            ADD CONSTRAINT fk_fcda_fuel_card
            FOREIGN KEY (fuel_card_id) REFERENCES fuel_cards(id)
            ON DELETE SET NULL;
        `);
      }

      await knex.raw('CREATE INDEX idx_fcda_fuel_card ON fuel_card_driver_assignments(fuel_card_id)');
    }
  }
};

exports.down = async function (knex) {
  // Remove fuel_card_id from assignments
  const hasAssignments = await knex.schema.hasTable('fuel_card_driver_assignments');
  if (hasAssignments) {
    const hasCol = await knex.schema.hasColumn('fuel_card_driver_assignments', 'fuel_card_id');
    if (hasCol) {
      await knex.raw('ALTER TABLE fuel_card_driver_assignments DROP CONSTRAINT IF EXISTS fk_fcda_fuel_card');
      await knex.raw('DROP INDEX IF EXISTS idx_fcda_fuel_card');
      await knex.schema.alterTable('fuel_card_driver_assignments', (t) => {
        t.dropColumn('fuel_card_id');
      });
    }
  }

  // Drop fuel_cards table
  await knex.schema.dropTableIfExists('fuel_cards');
};
