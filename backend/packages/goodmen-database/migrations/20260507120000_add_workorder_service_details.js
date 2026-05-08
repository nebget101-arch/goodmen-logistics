// FN-1528 — adds Service Details columns to work_orders.
// Backs the Work Order > Service Details tab fields that previously had no
// persistence (FN-1518). All columns nullable except road_call (boolean,
// defaults false). No indexes — fields are not query targets.

exports.up = async function up(knex) {
  const hasWorkOrders = await knex.schema.hasTable('work_orders');
  if (!hasWorkOrders) return;

  const addColumnIfMissing = async (column, callback) => {
    const exists = await knex.schema.hasColumn('work_orders', column);
    if (!exists) {
      await knex.schema.alterTable('work_orders', callback);
    }
  };

  await addColumnIfMissing('service_category', (table) =>
    table.string('service_category', 64).nullable()
  );
  await addColumnIfMissing('service_description', (table) =>
    table.text('service_description').nullable()
  );
  await addColumnIfMissing('problem_reported', (table) =>
    table.text('problem_reported').nullable()
  );
  await addColumnIfMissing('safety_issue', (table) =>
    table.string('safety_issue', 32).nullable()
  );
  await addColumnIfMissing('downtime_reason', (table) =>
    table.string('downtime_reason', 64).nullable()
  );
  await addColumnIfMissing('road_call', (table) =>
    table.boolean('road_call').notNullable().defaultTo(false)
  );
  await addColumnIfMissing('breakdown_location', (table) =>
    table.string('breakdown_location', 255).nullable()
  );
  await addColumnIfMissing('estimated_duration_hours', (table) =>
    table.decimal('estimated_duration_hours', 6, 2).nullable()
  );
};

exports.down = async function down(knex) {
  const hasWorkOrders = await knex.schema.hasTable('work_orders');
  if (!hasWorkOrders) return;

  const dropColumnIfExists = async (column) => {
    const exists = await knex.schema.hasColumn('work_orders', column);
    if (exists) {
      await knex.schema.alterTable('work_orders', (table) => {
        table.dropColumn(column);
      });
    }
  };

  await dropColumnIfExists('estimated_duration_hours');
  await dropColumnIfExists('breakdown_location');
  await dropColumnIfExists('road_call');
  await dropColumnIfExists('downtime_reason');
  await dropColumnIfExists('safety_issue');
  await dropColumnIfExists('problem_reported');
  await dropColumnIfExists('service_description');
  await dropColumnIfExists('service_category');
};
