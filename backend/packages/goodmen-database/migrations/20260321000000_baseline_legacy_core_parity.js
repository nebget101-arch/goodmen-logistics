'use strict';

/**
 * Baseline parity migration for fresh databases.
 *
 * Creates legacy/core tables that existed historically outside the Knex chain
 * (or were skipped by guarded migrations), so fresh dev/staging DBs can reach
 * schema parity with long-lived environments.
 *
 * Idempotent by design.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTenants = await knex.schema.hasTable('tenants');
  const hasOperatingEntities = await knex.schema.hasTable('operating_entities');
  const hasLocations = await knex.schema.hasTable('locations');

  const hasDriversBefore = await knex.schema.hasTable('drivers');
  if (!hasDriversBefore) {
    await knex.schema.createTable('drivers', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));

      table.string('first_name', 100).notNullable();
      table.string('last_name', 100).notNullable();
      table.string('email', 255).notNullable().unique();
      table.string('phone', 20);

      // Legacy CDL/compliance columns (kept for compatibility)
      table.string('cdl_number', 50).notNullable();
      table.string('cdl_state', 2).notNullable();
      table.string('cdl_class', 10).notNullable();
      table.specificType('endorsements', 'text[]');
      table.date('cdl_expiry');
      table.date('medical_cert_expiry');
      table.date('last_mvr_check');
      table.string('clearinghouse_status', 50);

      table.date('hire_date');
      table.string('status', 20).defaultTo('active');
      table.integer('dqf_completeness').defaultTo(0);
      table.text('address');
      table.date('date_of_birth');

      // Added by later migrations in long-lived envs
      table.text('driver_type').notNullable().defaultTo('company');
      table.text('pay_basis');
      table.decimal('pay_rate', 10, 4);
      table.decimal('pay_percentage', 5, 2);
      table.date('termination_date');
      table.uuid('truck_id');
      table.uuid('trailer_id');
      table.uuid('co_driver_id').references('id').inTable('drivers');

      if (hasTenants) {
        table.uuid('tenant_id').references('id').inTable('tenants').onDelete('RESTRICT');
      } else {
        table.uuid('tenant_id');
      }

      if (hasOperatingEntities) {
        table
          .uuid('operating_entity_id')
          .references('id')
          .inTable('operating_entities')
          .onDelete('RESTRICT');
      } else {
        table.uuid('operating_entity_id');
      }

      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drivers_email ON drivers(email)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drivers_cdl_expiry ON drivers(cdl_expiry)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drivers_medical_cert_expiry ON drivers(medical_cert_expiry)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drivers_tenant_id ON drivers(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drivers_operating_entity_id ON drivers(operating_entity_id)');
  }

  const hasVehiclesBefore = await knex.schema.hasTable('vehicles');
  if (!hasVehiclesBefore) {
    const hasDriversNow = await knex.schema.hasTable('drivers');

    await knex.schema.createTable('vehicles', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));

      table.string('unit_number', 50).notNullable().unique();
      table.string('vin', 17).notNullable().unique();
      table.string('make', 100).notNullable();
      table.string('model', 100).notNullable();
      table.integer('year').notNullable();
      table.string('license_plate', 20);
      table.string('state', 2);

      table.string('vehicle_type', 20).defaultTo('truck');
      table.string('status', 20).defaultTo('in-service');
      table.integer('mileage').defaultTo(0);
      table.date('inspection_expiry');
      table.date('next_pm_due');
      table.integer('next_pm_mileage');
      table.string('eld_device_id', 50);
      table.date('insurance_expiry');
      table.date('registration_expiry');
      table.text('oos_reason');

      table.boolean('company_owned').defaultTo(true);
      table.boolean('is_deleted').defaultTo(false);

      if (hasLocations) {
        table.uuid('location_id').references('id').inTable('locations').onDelete('SET NULL');
      } else {
        table.uuid('location_id');
      }

      if (hasTenants) {
        table.uuid('tenant_id').references('id').inTable('tenants').onDelete('RESTRICT');
      } else {
        table.uuid('tenant_id');
      }

      if (hasOperatingEntities) {
        table
          .uuid('operating_entity_id')
          .references('id')
          .inTable('operating_entities')
          .onDelete('RESTRICT');
      } else {
        table.uuid('operating_entity_id');
      }

      table.text('owner_type');
      if (hasDriversNow) {
        table.uuid('leased_driver_id').references('id').inTable('drivers').onDelete('SET NULL');
      } else {
        table.uuid('leased_driver_id');
      }
      table.text('title_status');
      table.jsonb('trailer_details');

      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_unit_number ON vehicles(unit_number)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_next_pm_due ON vehicles(next_pm_due)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_id ON vehicles(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_operating_entity_id ON vehicles(operating_entity_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_owner_type ON vehicles(owner_type)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicles_leased_driver ON vehicles(leased_driver_id)');
  }

  const hasAuditLogs = await knex.schema.hasTable('audit_logs');
  if (!hasAuditLogs) {
    await knex.schema.createTable('audit_logs', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.string('entity_type', 50).notNullable();
      table.uuid('entity_id').notNullable();
      table.string('action', 50).notNullable();
      table.jsonb('changes');
      table.string('performed_by', 100);
      table.string('ip_address', 45);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)');
  }

  const hasHosRecords = await knex.schema.hasTable('hos_records');
  if (!hasHosRecords) {
    const hasDriversNow = await knex.schema.hasTable('drivers');

    await knex.schema.createTable('hos_records', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      const driverId = table.uuid('driver_id').notNullable();
      if (hasDriversNow) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }
      table.date('record_date').notNullable();
      table.decimal('on_duty_hours', 4, 2).defaultTo(0);
      table.decimal('driving_hours', 4, 2).defaultTo(0);
      table.decimal('off_duty_hours', 4, 2).defaultTo(0);
      table.decimal('sleeper_berth_hours', 4, 2).defaultTo(0);
      table.specificType('violations', 'text[]');
      table.string('status', 20).defaultTo('compliant');
      table.string('eld_device_id', 50);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.unique(['driver_id', 'record_date']);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_hos_records_driver_id ON hos_records(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_hos_records_date ON hos_records(record_date)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_hos_records_status ON hos_records(status)');
  }

  const hasHosLogs = await knex.schema.hasTable('hos_logs');
  if (!hasHosLogs) {
    const hasHosRecordsNow = await knex.schema.hasTable('hos_records');

    await knex.schema.createTable('hos_logs', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      const hosRecordId = table.uuid('hos_record_id').notNullable();
      if (hasHosRecordsNow) {
        hosRecordId.references('id').inTable('hos_records').onDelete('CASCADE');
      }
      table.time('log_time').notNullable();
      table.string('status', 50).notNullable();
      table.text('location');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_hos_logs_hos_record_id ON hos_logs(hos_record_id)');
  }

  const hasMaintenanceRecords = await knex.schema.hasTable('maintenance_records');
  if (!hasMaintenanceRecords) {
    const hasVehiclesNow = await knex.schema.hasTable('vehicles');

    await knex.schema.createTable('maintenance_records', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      const vehicleId = table.uuid('vehicle_id').notNullable();
      if (hasVehiclesNow) {
        vehicleId.references('id').inTable('vehicles').onDelete('CASCADE');
      }
      table.string('type', 50).notNullable();
      table.text('description');
      table.date('date_performed');
      table.integer('mileage');
      table.string('mechanic_name', 100);
      table.decimal('cost', 10, 2).defaultTo(0);
      table.string('status', 20).defaultTo('pending');
      table.specificType('parts_used', 'text[]');
      table.date('next_service_due');
      table.string('priority', 20);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle_id ON maintenance_records(vehicle_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_records(status)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_maintenance_date ON maintenance_records(date_performed)');
  }

  const hasDrugAlcoholTests = await knex.schema.hasTable('drug_alcohol_tests');
  if (!hasDrugAlcoholTests) {
    const hasDriversNow = await knex.schema.hasTable('drivers');

    await knex.schema.createTable('drug_alcohol_tests', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      const driverId = table.uuid('driver_id').notNullable();
      if (hasDriversNow) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }
      table.string('test_type', 50).notNullable();
      table.date('test_date').notNullable();
      table.string('result', 20).notNullable();
      table.string('testing_facility', 255);
      table.string('collector_name', 100);
      table.string('specimen', 50);
      table.specificType('substances_tested', 'text[]');
      table.string('certified_by', 100);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drug_tests_driver_id ON drug_alcohol_tests(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_drug_tests_date ON drug_alcohol_tests(test_date)');
  }

  const hasDqfDocuments = await knex.schema.hasTable('dqf_documents');
  if (!hasDqfDocuments) {
    const hasDriversNow = await knex.schema.hasTable('drivers');

    await knex.schema.createTable('dqf_documents', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      const driverId = table.uuid('driver_id').notNullable();
      if (hasDriversNow) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }
      table.string('document_type', 100).notNullable();
      table.string('file_name', 255).notNullable();
      table.string('file_path', 500).notNullable();
      table.integer('file_size');
      table.string('mime_type', 100);
      table.string('uploaded_by', 255);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dqf_documents_driver ON dqf_documents(driver_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_dqf_documents_type ON dqf_documents(document_type)');
  }

  const hasVehicleDocuments = await knex.schema.hasTable('vehicle_documents');
  if (!hasVehicleDocuments) {
    const hasVehiclesNow = await knex.schema.hasTable('vehicles');

    await knex.schema.createTable('vehicle_documents', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      const vehicleId = table.uuid('vehicle_id').notNullable();
      if (hasVehiclesNow) {
        vehicleId.references('id').inTable('vehicles').onDelete('CASCADE');
      }
      table.string('document_type', 100).notNullable();
      table.string('file_name', 255).notNullable();
      table.string('file_path', 500).notNullable();
      table.integer('file_size');
      table.string('mime_type', 100);
      table.date('expiry_date');
      table.string('uploaded_by', 255);
      table.text('notes');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicle_documents_type ON vehicle_documents(document_type)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_vehicle_documents_expiry ON vehicle_documents(expiry_date)');
  }

  const hasDriverLicenses = await knex.schema.hasTable('driver_licenses');
  if (!hasDriverLicenses) {
    const hasDriversNow = await knex.schema.hasTable('drivers');

    await knex.schema.createTable('driver_licenses', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      const driverId = table.uuid('driver_id').notNullable();
      if (hasDriversNow) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }
      table.text('cdl_state').notNullable();
      table.text('cdl_number').notNullable();
      table.text('cdl_class');
      table.text('endorsements');
      table.date('cdl_expiry');
      table.unique(['driver_id']);
      table.unique(['cdl_state', 'cdl_number']);
    });
  }

  const hasDriverCompliance = await knex.schema.hasTable('driver_compliance');
  if (!hasDriverCompliance) {
    const hasDriversNow = await knex.schema.hasTable('drivers');

    await knex.schema.createTable('driver_compliance', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      const driverId = table.uuid('driver_id').notNullable();
      if (hasDriversNow) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }
      table.date('medical_cert_expiry');
      table.date('last_mvr_check');
      table.text('clearinghouse_status').defaultTo('unknown');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.unique(['driver_id']);
    });
  }

  const hasDriverLicenseConflicts = await knex.schema.hasTable('driver_license_conflicts');
  if (!hasDriverLicenseConflicts) {
    const hasDriversNow = await knex.schema.hasTable('drivers');

    await knex.schema.createTable('driver_license_conflicts', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      const driverId = table.uuid('driver_id').notNullable();
      if (hasDriversNow) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }
      table.text('cdl_state').notNullable();
      table.text('cdl_number').notNullable();
      table.text('reason').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

/**
 * Keep rollback intentionally non-destructive.
 *
 * @param {import('knex').Knex} _knex
 */
exports.down = async function down(_knex) {
  // no-op
};
