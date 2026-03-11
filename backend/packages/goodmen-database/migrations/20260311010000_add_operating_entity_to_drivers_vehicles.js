'use strict';

exports.up = async function(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  if (hasDrivers) {
    const hasCol = await knex.schema.hasColumn('drivers', 'operating_entity_id');
    if (!hasCol) {
      await knex.schema.alterTable('drivers', (table) => {
        table.uuid('operating_entity_id').nullable().references('id').inTable('operating_entities').onDelete('RESTRICT');
      });
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_drivers_operating_entity_id ON drivers(operating_entity_id)');
    }
  }

  const hasVehicles = await knex.schema.hasTable('vehicles');
  if (hasVehicles) {
    const hasColV = await knex.schema.hasColumn('vehicles', 'operating_entity_id');
    if (!hasColV) {
      await knex.schema.alterTable('vehicles', (table) => {
        table.uuid('operating_entity_id').nullable().references('id').inTable('operating_entities').onDelete('RESTRICT');
      });
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_operating_entity_id ON vehicles(operating_entity_id)');
    }
  }
};

exports.down = async function(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  if (hasDrivers) {
    const hasCol = await knex.schema.hasColumn('drivers', 'operating_entity_id');
    if (hasCol) {
      await knex.schema.alterTable('drivers', (table) => {
        table.dropColumn('operating_entity_id');
      });
    }
  }

  const hasVehicles = await knex.schema.hasTable('vehicles');
  if (hasVehicles) {
    const hasColV = await knex.schema.hasColumn('vehicles', 'operating_entity_id');
    if (hasColV) {
      await knex.schema.alterTable('vehicles', (table) => {
        table.dropColumn('operating_entity_id');
      });
    }
  }
};
