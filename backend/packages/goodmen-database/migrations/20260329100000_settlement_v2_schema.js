/**
 * FN-495 — Settlement V2 Schema Foundations
 *
 * Changes:
 *   1. vehicles            — add equipment_owner_id (FK → contacts.id, conditional), equipment_owner_name
 *   2. driver_compensation_profiles — data migration: company_driver → driver, delete hired_driver_for_owner rows
 *   3. expense_responsibility_profiles — add split_type, driver_percentage, driver_fixed_amount, owner_fixed_amount
 *   4. recurring_deduction_rules — applies_when already exists; no-op (guarded by hasColumn)
 *   5. settlements         — add settlement_type, equipment_owner_id, truck_id, carried_balance,
 *                            carried_balance_from_settlement_id
 *   6. NEW settlement_balance_transfers
 *   7. NEW idle_truck_alerts
 */
exports.up = async function (knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasContacts = await knex.schema.hasTable('contacts');
  const hasDrivers  = await knex.schema.hasTable('drivers');
  const hasVehicles = await knex.schema.hasTable('vehicles');
  const hasUsers    = await knex.schema.hasTable('users');

  // ---------------------------------------------------------------------------
  // 1. vehicles — equipment owner columns
  // ---------------------------------------------------------------------------
  if (hasVehicles) {
    const hasOwnerId   = await knex.schema.hasColumn('vehicles', 'equipment_owner_id');
    const hasOwnerName = await knex.schema.hasColumn('vehicles', 'equipment_owner_name');

    await knex.schema.alterTable('vehicles', (table) => {
      if (!hasOwnerId) {
        const col = table.uuid('equipment_owner_id').nullable();
        if (hasContacts) {
          col.references('id').inTable('contacts').onDelete('SET NULL');
        }
      }
      if (!hasOwnerName) {
        table.text('equipment_owner_name').nullable();
      }
    });

    if (!hasOwnerId) {
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_equipment_owner ON vehicles(equipment_owner_id)');
    }
  }

  // ---------------------------------------------------------------------------
  // 2. driver_compensation_profiles — rename company_driver → driver, remove hired_driver_for_owner
  // ---------------------------------------------------------------------------
  if (await knex.schema.hasTable('driver_compensation_profiles')) {
    // Rename company_driver values to driver
    await knex.raw(`
      UPDATE driver_compensation_profiles
      SET profile_type = 'driver'
      WHERE profile_type = 'company_driver'
    `);

    // Remove rows with hired_driver_for_owner (no longer a valid type)
    await knex.raw(`
      DELETE FROM driver_compensation_profiles
      WHERE profile_type = 'hired_driver_for_owner'
    `);
  }

  // ---------------------------------------------------------------------------
  // 3. expense_responsibility_profiles — add split config columns
  // ---------------------------------------------------------------------------
  if (await knex.schema.hasTable('expense_responsibility_profiles')) {
    const hasSplitType      = await knex.schema.hasColumn('expense_responsibility_profiles', 'split_type');
    const hasDriverPct      = await knex.schema.hasColumn('expense_responsibility_profiles', 'driver_percentage');
    const hasDriverFixed    = await knex.schema.hasColumn('expense_responsibility_profiles', 'driver_fixed_amount');
    const hasOwnerFixed     = await knex.schema.hasColumn('expense_responsibility_profiles', 'owner_fixed_amount');

    await knex.schema.alterTable('expense_responsibility_profiles', (table) => {
      if (!hasSplitType)   table.text('split_type').nullable(); // 'percentage' | 'fixed_amount'
      if (!hasDriverPct)   table.decimal('driver_percentage', 5, 2).nullable();
      if (!hasDriverFixed) table.decimal('driver_fixed_amount', 12, 2).nullable();
      if (!hasOwnerFixed)  table.decimal('owner_fixed_amount', 12, 2).nullable();
    });
  }

  // ---------------------------------------------------------------------------
  // 4. recurring_deduction_rules — applies_when (already exists from prior migration; guard only)
  // ---------------------------------------------------------------------------
  if (await knex.schema.hasTable('recurring_deduction_rules')) {
    const hasAppliesWhen = await knex.schema.hasColumn('recurring_deduction_rules', 'applies_when');
    if (!hasAppliesWhen) {
      await knex.schema.alterTable('recurring_deduction_rules', (table) => {
        table.text('applies_when').nullable().defaultTo('always');
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5. settlements — dual settlement columns
  // ---------------------------------------------------------------------------
  if (await knex.schema.hasTable('settlements')) {
    const hasSettlementType  = await knex.schema.hasColumn('settlements', 'settlement_type');
    const hasOwnerId         = await knex.schema.hasColumn('settlements', 'equipment_owner_id');
    const hasTruckId         = await knex.schema.hasColumn('settlements', 'truck_id');
    const hasCarriedBalance  = await knex.schema.hasColumn('settlements', 'carried_balance');
    const hasCarriedFrom     = await knex.schema.hasColumn('settlements', 'carried_balance_from_settlement_id');

    await knex.schema.alterTable('settlements', (table) => {
      if (!hasSettlementType) table.text('settlement_type').nullable().defaultTo('driver'); // 'driver' | 'equipment_owner'
      if (!hasOwnerId)        table.uuid('equipment_owner_id').nullable();
      if (!hasTruckId) {
        const col = table.uuid('truck_id').nullable();
        if (hasVehicles) {
          col.references('id').inTable('vehicles').onDelete('SET NULL');
        }
      }
      if (!hasCarriedBalance) table.decimal('carried_balance', 14, 2).notNullable().defaultTo(0);
      if (!hasCarriedFrom)    table.uuid('carried_balance_from_settlement_id').nullable();
    });

    if (!hasOwnerId) {
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_settlements_equipment_owner ON settlements(equipment_owner_id)');
    }
    if (!hasTruckId) {
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_settlements_truck ON settlements(truck_id)');
    }
    if (!hasSettlementType) {
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_settlements_type ON settlements(settlement_type)');
    }
  }

  // ---------------------------------------------------------------------------
  // 6. NEW settlement_balance_transfers
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('settlement_balance_transfers'))) {
    await knex.schema.createTable('settlement_balance_transfers', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable();

      const sourceDriverId = table.uuid('source_driver_id').nullable();
      if (hasDrivers) {
        sourceDriverId.references('id').inTable('drivers').onDelete('SET NULL');
      }

      table.uuid('source_settlement_id').nullable().references('id').inTable('settlements').onDelete('SET NULL');
      table.uuid('target_equipment_owner_id').nullable();
      table.uuid('target_settlement_id').nullable().references('id').inTable('settlements').onDelete('SET NULL');

      table.decimal('amount', 14, 2).notNullable();
      table.text('reason').notNullable(); // 'driver_quit' | 'driver_terminated' | 'manual'
      table.text('status').notNullable().defaultTo('pending_approval'); // 'pending_approval' | 'approved' | 'applied' | 'rejected'

      table.timestamp('requested_at').notNullable().defaultTo(knex.fn.now());
      const requestedBy = table.uuid('requested_by').nullable();
      if (hasUsers) requestedBy.references('id').inTable('users').onDelete('SET NULL');

      table.timestamp('reviewed_at').nullable();
      const reviewedBy = table.uuid('reviewed_by').nullable();
      if (hasUsers) reviewedBy.references('id').inTable('users').onDelete('SET NULL');

      table.text('review_notes').nullable();
      table.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_sbt_tenant ON settlement_balance_transfers(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_sbt_source_driver ON settlement_balance_transfers(source_driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_sbt_target_owner ON settlement_balance_transfers(target_equipment_owner_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_sbt_status ON settlement_balance_transfers(status)');
  }

  // ---------------------------------------------------------------------------
  // 7. NEW idle_truck_alerts
  // ---------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('idle_truck_alerts'))) {
    await knex.schema.createTable('idle_truck_alerts', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable();

      const vehicleId = table.uuid('vehicle_id').notNullable();
      if (hasVehicles) vehicleId.references('id').inTable('vehicles').onDelete('CASCADE');

      const driverId = table.uuid('driver_id').nullable();
      if (hasDrivers) driverId.references('id').inTable('drivers').onDelete('SET NULL');

      table.uuid('equipment_owner_id').nullable();

      table.text('alert_type').notNullable(); // 'week_1_idle' | 'week_2_no_response' | 'deactivation_suggested'
      table.decimal('accrued_deductions', 14, 2).notNullable().defaultTo(0);
      table.jsonb('notified_roles').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
      table.text('response_status').nullable(); // 'pending' | 'acknowledged' | 'resolved' | 'escalated'
      table.text('response_notes').nullable();

      const respondedBy = table.uuid('responded_by').nullable();
      if (hasUsers) respondedBy.references('id').inTable('users').onDelete('SET NULL');

      table.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ita_tenant ON idle_truck_alerts(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ita_vehicle ON idle_truck_alerts(vehicle_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ita_driver ON idle_truck_alerts(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ita_owner ON idle_truck_alerts(equipment_owner_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ita_alert_type ON idle_truck_alerts(alert_type)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ita_tenant_vehicle ON idle_truck_alerts(tenant_id, vehicle_id)');
  }
};

exports.down = async function (knex) {
  // Drop new tables
  await knex.schema.dropTableIfExists('idle_truck_alerts');
  await knex.schema.dropTableIfExists('settlement_balance_transfers');

  // Remove settlements columns
  if (await knex.schema.hasTable('settlements')) {
    await knex.schema.alterTable('settlements', (table) => {
      table.dropColumn('carried_balance_from_settlement_id');
      table.dropColumn('carried_balance');
      table.dropColumn('truck_id');
      table.dropColumn('equipment_owner_id');
      table.dropColumn('settlement_type');
    });
  }

  // Remove expense_responsibility_profiles columns
  if (await knex.schema.hasTable('expense_responsibility_profiles')) {
    await knex.schema.alterTable('expense_responsibility_profiles', (table) => {
      table.dropColumn('owner_fixed_amount');
      table.dropColumn('driver_fixed_amount');
      table.dropColumn('driver_percentage');
      table.dropColumn('split_type');
    });
  }

  // Remove vehicles columns
  if (await knex.schema.hasTable('vehicles')) {
    await knex.schema.alterTable('vehicles', (table) => {
      table.dropColumn('equipment_owner_name');
      table.dropColumn('equipment_owner_id');
    });
  }

  // NOTE: compensation_type data migration is NOT reversed (destructive — hired_driver_for_owner rows deleted)
  // Reversing company_driver → driver rename is possible but not safe without knowing original data
};
