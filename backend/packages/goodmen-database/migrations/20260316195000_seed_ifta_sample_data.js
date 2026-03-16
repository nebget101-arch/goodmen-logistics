'use strict';

exports.up = async function up(knex) {
  const requiredTables = ['ifta_quarters', 'ifta_miles_entries', 'ifta_fuel_entries'];
  for (const table of requiredTables) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await knex.schema.hasTable(table))) return;
  }

  const tenant = await knex('tenants').select('id').first();
  if (!tenant || !tenant.id) return;

  const existingQuarter = await knex('ifta_quarters').where({ tenant_id: tenant.id, tax_year: 2026, quarter: 1 }).first();
  if (existingQuarter) return;

  const opEntity = await knex('operating_entities').where({ tenant_id: tenant.id }).first();
  const trucks = await knex('vehicles')
    .where({ tenant_id: tenant.id })
    .andWhere('vehicle_type', 'truck')
    .select('id', 'unit_number')
    .limit(2);

  if (!trucks.length) return;

  const [quarter] = await knex('ifta_quarters').insert({
    tenant_id: tenant.id,
    operating_entity_id: opEntity ? opEntity.id : null,
    company_id: tenant.id,
    quarter: 1,
    tax_year: 2026,
    filing_entity_name: (opEntity && opEntity.name) || 'Sample Fleet Entity',
    status: 'draft',
    selected_truck_ids: JSON.stringify(trucks.map((t) => t.id)),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  }).returning('*');

  const rowsMiles = [];
  for (const truck of trucks) {
    rowsMiles.push({
      quarter_id: quarter.id,
      tenant_id: tenant.id,
      operating_entity_id: opEntity ? opEntity.id : null,
      truck_id: truck.id,
      unit: truck.unit_number || `UNIT-${truck.id.slice(0, 6)}`,
      jurisdiction: 'TX',
      taxable_miles: 3200,
      non_taxable_miles: 100,
      total_miles: 3300,
      source: 'seed',
      notes: 'Sample seed mileage entry',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
    rowsMiles.push({
      quarter_id: quarter.id,
      tenant_id: tenant.id,
      operating_entity_id: opEntity ? opEntity.id : null,
      truck_id: truck.id,
      unit: truck.unit_number || `UNIT-${truck.id.slice(0, 6)}`,
      jurisdiction: 'OK',
      taxable_miles: 900,
      non_taxable_miles: 50,
      total_miles: 950,
      source: 'seed',
      notes: 'Sample seed mileage entry',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }

  const rowsFuel = [];
  for (const truck of trucks) {
    rowsFuel.push({
      quarter_id: quarter.id,
      tenant_id: tenant.id,
      operating_entity_id: opEntity ? opEntity.id : null,
      truck_id: truck.id,
      purchase_date: '2026-02-14',
      unit: truck.unit_number || `UNIT-${truck.id.slice(0, 6)}`,
      jurisdiction: 'TX',
      vendor: 'Pilot',
      receipt_invoice_number: `SEED-${(truck.unit_number || truck.id).toString().slice(0, 6)}-001`,
      gallons: 420,
      amount: 1320,
      fuel_type: 'diesel',
      tax_paid: true,
      source: 'seed',
      notes: 'Sample seed fuel purchase',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
    rowsFuel.push({
      quarter_id: quarter.id,
      tenant_id: tenant.id,
      operating_entity_id: opEntity ? opEntity.id : null,
      truck_id: truck.id,
      purchase_date: '2026-02-20',
      unit: truck.unit_number || `UNIT-${truck.id.slice(0, 6)}`,
      jurisdiction: 'OK',
      vendor: 'Love\'s',
      receipt_invoice_number: `SEED-${(truck.unit_number || truck.id).toString().slice(0, 6)}-002`,
      gallons: 150,
      amount: 470,
      fuel_type: 'diesel',
      tax_paid: true,
      source: 'seed',
      notes: 'Sample seed fuel purchase',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }

  await knex('ifta_miles_entries').insert(rowsMiles);
  await knex('ifta_fuel_entries').insert(rowsFuel);
};

exports.down = async function down(knex) {
  const quarter = await knex('ifta_quarters').where({ tax_year: 2026, quarter: 1 }).orderBy('created_at', 'asc').first();
  if (!quarter) return;

  await knex('ifta_fuel_entries').where({ quarter_id: quarter.id, source: 'seed' }).del();
  await knex('ifta_miles_entries').where({ quarter_id: quarter.id, source: 'seed' }).del();
  await knex('ifta_quarters').where({ id: quarter.id }).del();
};
