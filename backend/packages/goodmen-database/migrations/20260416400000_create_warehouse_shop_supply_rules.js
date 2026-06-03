/**
 * FN-689 — Create warehouse_shop_supply_rules table
 *
 * Defines which warehouse location supplies which shop location.
 * Application layer is responsible for validating that:
 *   - warehouse_location_id references a location with type = 'WAREHOUSE'
 *   - shop_location_id references a location with type = 'SHOP'
 *
 * DB-level constraints:
 *   - UNIQUE (warehouse_location_id, shop_location_id)
 *   - CHECK  warehouse_location_id <> shop_location_id  (no self-supply)
 *   - FK both ON DELETE CASCADE
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

exports.up = async function (knex) {
  await knex.schema.createTable('warehouse_shop_supply_rules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();

    // FK to locations — warehouse side
    t.uuid('warehouse_location_id').notNullable()
      .references('id').inTable('locations').onDelete('CASCADE');

    // FK to locations — shop side
    t.uuid('shop_location_id').notNullable()
      .references('id').inTable('locations').onDelete('CASCADE');

    // Optional descriptive fields
    t.text('notes').nullable();
    t.boolean('active').notNullable().defaultTo(true);

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // UNIQUE: one supply rule per (warehouse, shop) pair
  await knex.raw(
    `CREATE UNIQUE INDEX uq_wssr_warehouse_shop
     ON warehouse_shop_supply_rules (warehouse_location_id, shop_location_id)`
  );

  // Tenant lookup index
  await knex.raw(
    `CREATE INDEX idx_wssr_tenant
     ON warehouse_shop_supply_rules (tenant_id)`
  );

  // Warehouse lookup index (which shops does this warehouse supply?)
  await knex.raw(
    `CREATE INDEX idx_wssr_warehouse
     ON warehouse_shop_supply_rules (warehouse_location_id)`
  );

  // Shop lookup index (which warehouses supply this shop?)
  await knex.raw(
    `CREATE INDEX idx_wssr_shop
     ON warehouse_shop_supply_rules (shop_location_id)`
  );

  // CHECK: a location cannot supply itself
  await knex.raw(`
    ALTER TABLE warehouse_shop_supply_rules
    ADD CONSTRAINT chk_wssr_no_self_supply
    CHECK (warehouse_location_id <> shop_location_id)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_wssr_shop');
  await knex.raw('DROP INDEX IF EXISTS idx_wssr_warehouse');
  await knex.raw('DROP INDEX IF EXISTS idx_wssr_tenant');
  await knex.raw('DROP INDEX IF EXISTS uq_wssr_warehouse_shop');
  await knex.schema.dropTableIfExists('warehouse_shop_supply_rules');
};
