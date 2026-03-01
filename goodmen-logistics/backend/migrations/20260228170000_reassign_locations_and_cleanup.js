/**
 * Reassign references from deprecated locations and delete them.
 */
exports.up = async function(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== 'true') {
    return;
  }
  const oldToNew = {
    '15e2f1d0-5ae9-4bd4-8bf5-ccbe8987a76d': 'a622c159-a9cd-48d7-aef5-3e2e1480c59c',
    '6b52d5d3-d516-4ed0-af10-3edbb021f627': 'b6f2ace7-ac06-46ba-ab77-31b4c77034c7',
    '8983fdd3-1fd8-485b-946c-126ac9c20dc1': 'e7db298b-1c41-4aa2-8303-3f53098f1a10'
  };
  const oldIds = Object.keys(oldToNew);
  const partsLocationId = '9f0f39f6-6c37-4a3f-9735-96457fc9af50';

  const requiredIds = [...new Set([...Object.values(oldToNew), partsLocationId])];
  const existing = await knex('locations').whereIn('id', requiredIds).select('id');
  const existingIds = new Set(existing.map(row => row.id));
  const missing = requiredIds.filter(id => !existingIds.has(id));
  if (missing.length) {
    throw new Error(`Missing target locations: ${missing.join(', ')}`);
  }

  const applyMapping = async (table, column) => {
    for (const [oldId, newId] of Object.entries(oldToNew)) {
      await knex(table).where({ [column]: oldId }).update({ [column]: newId });
    }
  };

  await applyMapping('customers', 'default_location_id');
  await applyMapping('vehicles', 'location_id');
  await applyMapping('work_orders', 'location_id');
  await applyMapping('customer_sales', 'location_id');
  await applyMapping('cycle_counts', 'location_id');
  await applyMapping('inventory_adjustments', 'location_id');
  await applyMapping('inventory_transactions', 'location_id');
  await applyMapping('invoices', 'location_id');
  await applyMapping('receiving_tickets', 'location_id');
  await applyMapping('work_order_part_items', 'location_id');

  // Move parts inventory to the requested location
  await knex('inventory').whereIn('location_id', oldIds).update({ location_id: partsLocationId });
  await knex('inventory_by_location').whereIn('location_id', oldIds).update({ location_id: partsLocationId });

  await knex('locations').whereIn('id', oldIds).del();
};

exports.down = async function(knex) {
  // No-op: reversing this mapping is not deterministic.
};
