/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasVehicles = await knex.schema.hasTable('vehicles');
  const hasCustomers = await knex.schema.hasTable('customers');
  const hasLocations = await knex.schema.hasTable('locations');
  const hasUsers = await knex.schema.hasTable('users');
  const hasParts = await knex.schema.hasTable('parts');

  const hasWorkOrders = await knex.schema.hasTable('work_orders');
  if (!hasWorkOrders) {
    await knex.schema.createTable('work_orders', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.string('work_order_number').notNullable().unique();
      const vehicleId = table.uuid('vehicle_id').notNullable();
      if (hasVehicles) {
        vehicleId.references('id').inTable('vehicles');
      }
      const customerId = table.uuid('customer_id');
      if (hasCustomers) {
        customerId.references('id').inTable('customers');
      }
      const locationId = table.uuid('location_id').notNullable();
      if (hasLocations) {
        locationId.references('id').inTable('locations');
      }
      table.enu('type', ['REPAIR', 'PM', 'INSPECTION', 'TIRE', 'OTHER']).defaultTo('REPAIR');
      table.enu('priority', ['LOW', 'NORMAL', 'HIGH', 'URGENT']).defaultTo('NORMAL');
      table.enu('status', ['DRAFT', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED', 'CLOSED', 'CANCELED']).defaultTo('DRAFT');
      table.text('description');
      table.integer('odometer_miles');
      const assignedMechanicUserId = table.uuid('assigned_mechanic_user_id');
      if (hasUsers) {
        assignedMechanicUserId.references('id').inTable('users');
      }
      table.enu('discount_type', ['NONE', 'PERCENT', 'AMOUNT']).defaultTo('NONE');
      table.decimal('discount_value', 12, 2).defaultTo(0);
      table.decimal('tax_rate_percent', 6, 3).defaultTo(0);
      table.decimal('tax_amount', 12, 2).defaultTo(0);
      table.decimal('labor_subtotal', 12, 2).defaultTo(0);
      table.decimal('parts_subtotal', 12, 2).defaultTo(0);
      table.decimal('fees_subtotal', 12, 2).defaultTo(0);
      table.decimal('total_amount', 12, 2).defaultTo(0);
      table.timestamp('completed_at');
      table.timestamps(true, true);
    });
  } else {
    const hasNumber = await knex.schema.hasColumn('work_orders', 'work_order_number');
    if (!hasNumber) {
      await knex.schema.table('work_orders', table => {
        table.string('work_order_number');
      });
      await knex.schema.raw('CREATE UNIQUE INDEX IF NOT EXISTS work_orders_number_unique ON work_orders(work_order_number)');
    }

    const hasCustomer = await knex.schema.hasColumn('work_orders', 'customer_id');
    if (!hasCustomer) {
      await knex.schema.table('work_orders', table => {
        const customerId = table.uuid('customer_id');
        if (hasCustomers) {
          customerId.references('id').inTable('customers');
        }
      });
    }

    const hasType = await knex.schema.hasColumn('work_orders', 'type');
    if (!hasType) {
      await knex.schema.table('work_orders', table => {
        table.enu('type', ['REPAIR', 'PM', 'INSPECTION', 'TIRE', 'OTHER']).defaultTo('REPAIR');
      });
    }

    const hasPriority = await knex.schema.hasColumn('work_orders', 'priority');
    if (!hasPriority) {
      await knex.schema.table('work_orders', table => {
        table.enu('priority', ['LOW', 'NORMAL', 'HIGH', 'URGENT']).defaultTo('NORMAL');
      });
    }

    const hasOdometer = await knex.schema.hasColumn('work_orders', 'odometer_miles');
    if (!hasOdometer) {
      await knex.schema.table('work_orders', table => {
        table.integer('odometer_miles');
      });
    }

    const hasAssigned = await knex.schema.hasColumn('work_orders', 'assigned_mechanic_user_id');
    if (!hasAssigned) {
      await knex.schema.table('work_orders', table => {
        const assignedMechanicUserId = table.uuid('assigned_mechanic_user_id');
        if (hasUsers) {
          assignedMechanicUserId.references('id').inTable('users');
        }
      });
    }

    const hasCompletedAt = await knex.schema.hasColumn('work_orders', 'completed_at');
    if (!hasCompletedAt) {
      await knex.schema.table('work_orders', table => {
        table.timestamp('completed_at');
      });
    }

    // Financial columns – add individually if missing
    const financialColumns = [
      { name: 'discount_type',  add: (table) => table.enu('discount_type', ['NONE', 'PERCENT', 'AMOUNT']).defaultTo('NONE') },
      { name: 'discount_value', add: (table) => table.decimal('discount_value', 12, 2).defaultTo(0) },
      { name: 'tax_rate_percent', add: (table) => table.decimal('tax_rate_percent', 6, 3).defaultTo(0) },
      { name: 'tax_amount', add: (table) => table.decimal('tax_amount', 12, 2).defaultTo(0) },
      { name: 'labor_subtotal', add: (table) => table.decimal('labor_subtotal', 12, 2).defaultTo(0) },
      { name: 'parts_subtotal', add: (table) => table.decimal('parts_subtotal', 12, 2).defaultTo(0) },
      { name: 'fees_subtotal', add: (table) => table.decimal('fees_subtotal', 12, 2).defaultTo(0) },
      { name: 'total_amount', add: (table) => table.decimal('total_amount', 12, 2).defaultTo(0) }
    ];

    for (const col of financialColumns) {
      const exists = await knex.schema.hasColumn('work_orders', col.name);
      if (!exists) {
        await knex.schema.table('work_orders', table => {
          col.add(table);
        });
      }
    }

    const statusTypeResult = await knex.raw(`
      SELECT t.typname
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname LIKE 'work_orders%status%'
      GROUP BY t.typname
    `);
    const statusEnumType = statusTypeResult?.rows?.[0]?.typname;
    if (statusEnumType) {
      const addValue = async (value) => {
        await knex.raw(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_type t
              JOIN pg_enum e ON t.oid = e.enumtypid
              WHERE t.typname = '${statusEnumType}' AND e.enumlabel = '${value}'
            ) THEN
              EXECUTE 'ALTER TYPE ${statusEnumType} ADD VALUE ''${value}''';
            END IF;
          END $$;
        `);
      };
      await addValue('DRAFT');
      await addValue('IN_PROGRESS');
      await addValue('WAITING_PARTS');
      await addValue('COMPLETED');
      await addValue('CLOSED');
      await addValue('CANCELED');
    }
  }

  const hasLaborItems = await knex.schema.hasTable('work_order_labor_items');
  if (!hasLaborItems && hasWorkOrders) {
    await knex.schema.createTable('work_order_labor_items', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
      table.text('description').notNullable();
      table.decimal('hours', 10, 2).defaultTo(0);
      table.decimal('labor_rate', 12, 2).defaultTo(0);
      table.boolean('taxable').defaultTo(false);
      table.decimal('line_total', 12, 2).defaultTo(0);
      table.timestamps(true, true);
      table.index('work_order_id');
    });
  }

  const hasPartItems = await knex.schema.hasTable('work_order_part_items');
  if (!hasPartItems && hasWorkOrders) {
    await knex.schema.createTable('work_order_part_items', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
      const partId = table.uuid('part_id').notNullable();
      if (hasParts) {
        partId.references('id').inTable('parts');
      }
      const locationId = table.uuid('location_id').notNullable();
      if (hasLocations) {
        locationId.references('id').inTable('locations');
      }
      table.decimal('qty_requested', 12, 3).defaultTo(0);
      table.decimal('qty_reserved', 12, 3).defaultTo(0);
      table.decimal('qty_issued', 12, 3).defaultTo(0);
      table.decimal('unit_price', 12, 2).defaultTo(0);
      table.boolean('taxable').defaultTo(true);
      table.enu('status', ['RESERVED', 'ISSUED', 'BACKORDERED', 'RETURNED']).defaultTo('RESERVED');
      table.decimal('line_total', 12, 2).defaultTo(0);
      table.timestamps(true, true);
      table.index('work_order_id');
      table.index('part_id');
    });
  }

  const hasFees = await knex.schema.hasTable('work_order_fees');
  if (!hasFees && hasWorkOrders) {
    await knex.schema.createTable('work_order_fees', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
      table.enu('fee_type', ['SHOP_SUPPLIES', 'ENV', 'MISC']).notNullable();
      table.decimal('amount', 12, 2).defaultTo(0);
      table.boolean('taxable').defaultTo(false);
      table.timestamps(true, true);
      table.index('work_order_id');
    });
  }

  const hasDocuments = await knex.schema.hasTable('work_order_documents');
  if (!hasDocuments && hasWorkOrders) {
    await knex.schema.createTable('work_order_documents', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
      table.string('file_name').notNullable();
      table.string('mime_type').notNullable();
      table.bigint('file_size_bytes').notNullable();
      table.string('storage_key').notNullable();
      const uploadedByUserId = table.uuid('uploaded_by_user_id');
      if (hasUsers) {
        uploadedByUserId.references('id').inTable('users');
      }
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index('work_order_id');
    });
  }

  const txTypeResult = await knex.raw(`
    SELECT t.typname
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname LIKE 'inventory_transactions%transaction_type%'
    GROUP BY t.typname
  `);
  const txTypeEnum = txTypeResult?.rows?.[0]?.typname;
  if (txTypeEnum) {
    const addValue = async (value) => {
      await knex.raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            WHERE t.typname = '${txTypeEnum}' AND e.enumlabel = '${value}'
          ) THEN
            EXECUTE 'ALTER TYPE ${txTypeEnum} ADD VALUE ''${value}''';
          END IF;
        END $$;
      `);
    };
    await addValue('RESERVE');
    await addValue('ISSUE');
    await addValue('RETURN');
  }

  const refTypeResult = await knex.raw(`
    SELECT t.typname
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname LIKE 'inventory_transactions%reference_type%'
    GROUP BY t.typname
  `);
  const refTypeEnum = refTypeResult?.rows?.[0]?.typname;
  if (refTypeEnum) {
    await knex.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = '${refTypeEnum}' AND e.enumlabel = 'WORK_ORDER'
        ) THEN
          EXECUTE 'ALTER TYPE ${refTypeEnum} ADD VALUE ''WORK_ORDER''';
        END IF;
      END $$;
    `);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('work_order_documents');
  await knex.schema.dropTableIfExists('work_order_fees');
  await knex.schema.dropTableIfExists('work_order_part_items');
  await knex.schema.dropTableIfExists('work_order_labor_items');

  const hasWorkOrders = await knex.schema.hasTable('work_orders');
  if (hasWorkOrders) {
    const hasNumber = await knex.schema.hasColumn('work_orders', 'work_order_number');
    if (hasNumber) {
      await knex.schema.table('work_orders', table => {
        table.dropColumn('work_order_number');
      });
    }
    const columnsToDrop = [
      'customer_id',
      'type',
      'priority',
      'odometer_miles',
      'assigned_mechanic_user_id',
      'discount_type',
      'discount_value',
      'tax_rate_percent',
      'tax_amount',
      'labor_subtotal',
      'parts_subtotal',
      'fees_subtotal',
      'total_amount',
      'completed_at'
    ];
    for (const col of columnsToDrop) {
      const hasCol = await knex.schema.hasColumn('work_orders', col);
      if (hasCol) {
        await knex.schema.table('work_orders', table => {
          table.dropColumn(col);
        });
      }
    }
  }
};
