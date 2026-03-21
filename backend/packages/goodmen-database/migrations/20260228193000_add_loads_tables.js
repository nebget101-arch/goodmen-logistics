/**
 * Loads + related tables (stops, attachments, brokers, zip_codes)
 */
exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasUsers = await knex.schema.hasTable('users');
  const hasDrivers = await knex.schema.hasTable('drivers');
  const hasVehicles = await knex.schema.hasTable('vehicles');

  const hasBrokers = await knex.schema.hasTable('brokers');
  if (!hasBrokers) {
    await knex.schema.createTable('brokers', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.text('name').notNullable();
      table.text('mc_number');
      table.text('dot_number');
      table.text('phone');
      table.text('email');
      table.text('address1');
      table.text('address2');
      table.text('city');
      table.text('state');
      table.text('zip');
      table.text('notes');
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_brokers_name ON brokers (name)');
  }

  const hasZipCodes = await knex.schema.hasTable('zip_codes');
  if (!hasZipCodes) {
    await knex.schema.createTable('zip_codes', table => {
      table.text('zip').primary();
      table.text('city').notNullable();
      table.text('state').notNullable();
      table.text('county');
      table.decimal('latitude', 10, 6);
      table.decimal('longitude', 10, 6);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_zip_codes_city_state ON zip_codes (city, state)');
  }

  const hasLoads = await knex.schema.hasTable('loads');
  if (!hasLoads) {
    await knex.schema.createTable('loads', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.text('load_number').notNullable().unique();
      table.enu('status', ['NEW','DISPATCHED','IN_TRANSIT','DELIVERED','CANCELLED']).defaultTo('NEW');
      table.enu('billing_status', ['PENDING','FUNDED','INVOICED','PAID']).defaultTo('PENDING');
      const dispatcherUserId = table.uuid('dispatcher_user_id');
      if (hasUsers) {
        dispatcherUserId.references('id').inTable('users').onDelete('SET NULL');
      }
      const driverId = table.uuid('driver_id');
      if (hasDrivers) {
        driverId.references('id').inTable('drivers').onDelete('SET NULL');
      }
      const truckId = table.uuid('truck_id');
      if (hasVehicles) {
        truckId.references('id').inTable('vehicles').onDelete('SET NULL');
      }
      const trailerId = table.uuid('trailer_id');
      if (hasVehicles) {
        trailerId.references('id').inTable('vehicles').onDelete('SET NULL');
      }
      table.uuid('broker_id').references('id').inTable('brokers').onDelete('SET NULL');
      table.text('broker_name');
      table.text('po_number');
      table.decimal('rate', 10, 2).defaultTo(0);
      table.text('notes');
      table.date('completed_date');
      table.timestamps(true, true);
    });
  } else {
    const addColumnIfMissing = async (column, cb) => {
      const exists = await knex.schema.hasColumn('loads', column);
      if (!exists) {
        await knex.schema.alterTable('loads', cb);
      }
    };

    await addColumnIfMissing('load_number', table => {
      table.text('load_number').unique();
    });
    await addColumnIfMissing('status', table => {
      table.enu('status', ['NEW','DISPATCHED','IN_TRANSIT','DELIVERED','CANCELLED']).defaultTo('NEW');
    });
    await addColumnIfMissing('billing_status', table => {
      table.enu('billing_status', ['PENDING','FUNDED','INVOICED','PAID']).defaultTo('PENDING');
    });
    await addColumnIfMissing('dispatcher_user_id', table => {
      const dispatcherUserId = table.uuid('dispatcher_user_id');
      if (hasUsers) {
        dispatcherUserId.references('id').inTable('users').onDelete('SET NULL');
      }
    });
    await addColumnIfMissing('driver_id', table => {
      const driverId = table.uuid('driver_id');
      if (hasDrivers) {
        driverId.references('id').inTable('drivers').onDelete('SET NULL');
      }
    });
    await addColumnIfMissing('truck_id', table => {
      const truckId = table.uuid('truck_id');
      if (hasVehicles) {
        truckId.references('id').inTable('vehicles').onDelete('SET NULL');
      }
    });
    await addColumnIfMissing('trailer_id', table => {
      const trailerId = table.uuid('trailer_id');
      if (hasVehicles) {
        trailerId.references('id').inTable('vehicles').onDelete('SET NULL');
      }
    });
    await addColumnIfMissing('broker_id', table => {
      table.uuid('broker_id').references('id').inTable('brokers').onDelete('SET NULL');
    });
    await addColumnIfMissing('broker_name', table => {
      table.text('broker_name');
    });
    await addColumnIfMissing('po_number', table => {
      table.text('po_number');
    });
    await addColumnIfMissing('rate', table => {
      table.decimal('rate', 10, 2).defaultTo(0);
    });
    await addColumnIfMissing('notes', table => {
      table.text('notes');
    });
    await addColumnIfMissing('completed_date', table => {
      table.date('completed_date');
    });
  }

  const hasLoadStops = await knex.schema.hasTable('load_stops');
  if (!hasLoadStops) {
    await knex.schema.createTable('load_stops', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('load_id').notNullable().references('id').inTable('loads').onDelete('CASCADE');
      table.enu('stop_type', ['PICKUP','DELIVERY']).notNullable();
      table.date('stop_date');
      table.text('city');
      table.text('state');
      table.text('zip');
      table.text('address1');
      table.text('address2');
      table.integer('sequence').defaultTo(1);
      table.timestamps(true, true);
    });
  }

  const hasLoadAttachments = await knex.schema.hasTable('load_attachments');
  if (!hasLoadAttachments) {
    await knex.schema.createTable('load_attachments', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('load_id').notNullable().references('id').inTable('loads').onDelete('CASCADE');
      table.enu('type', ['RATE_CONFIRMATION','BOL','LUMPER','OTHER','CONFIRMATION']).notNullable();
      table.text('file_name').notNullable();
      table.text('storage_key').notNullable();
      table.text('mime_type');
      table.bigint('size_bytes');
      table.text('notes');
      const uploadedByUserId = table.uuid('uploaded_by_user_id');
      if (hasUsers) {
        uploadedByUserId.references('id').inTable('users').onDelete('SET NULL');
      }
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_loads_status ON loads (status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_loads_billing_status ON loads (billing_status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_loads_dispatcher ON loads (dispatcher_user_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_loads_driver ON loads (driver_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_loads_truck ON loads (truck_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_loads_trailer ON loads (trailer_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_loads_broker ON loads (broker_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_loads_completed_date ON loads (completed_date)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_load_stops_load ON load_stops (load_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_load_attachments_load ON load_attachments (load_id)');
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('load_attachments');
  await knex.schema.dropTableIfExists('load_stops');

  const hasLoads = await knex.schema.hasTable('loads');
  if (hasLoads) {
    const dropColumnIfExists = async (column) => {
      const exists = await knex.schema.hasColumn('loads', column);
      if (exists) {
        await knex.schema.alterTable('loads', table => {
          table.dropColumn(column);
        });
      }
    };
    await dropColumnIfExists('load_number');
    await dropColumnIfExists('status');
    await dropColumnIfExists('billing_status');
    await dropColumnIfExists('dispatcher_user_id');
    await dropColumnIfExists('driver_id');
    await dropColumnIfExists('truck_id');
    await dropColumnIfExists('trailer_id');
    await dropColumnIfExists('broker_id');
    await dropColumnIfExists('broker_name');
    await dropColumnIfExists('po_number');
    await dropColumnIfExists('rate');
    await dropColumnIfExists('notes');
    await dropColumnIfExists('completed_date');
  }

  await knex.schema.dropTableIfExists('zip_codes');
  await knex.schema.dropTableIfExists('brokers');
};
