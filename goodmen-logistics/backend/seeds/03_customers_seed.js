exports.seed = async function(knex) {
  const existing = await knex('customers').select('id').limit(1);
  if (existing.length > 0) return;

  const [locA] = await knex('locations').select('id').orderBy('name', 'asc').limit(1);

  const customers = await knex('customers').insert([
    {
      company_name: 'Great Lakes Fleet Services',
      customer_type: 'FLEET',
      status: 'ACTIVE',
      tax_id: '12-3456789',
      primary_contact_name: 'Megan Field',
      phone: '312-555-0181',
      email: 'fleet@greatlakes.com',
      billing_address_line1: '1800 Lake Shore Dr',
      billing_city: 'Chicago',
      billing_state: 'IL',
      billing_zip: '60601',
      billing_country: 'USA',
      payment_terms: 'NET_30',
      credit_limit: 25000,
      tax_exempt: false,
      default_location_id: locA?.id || null
    },
    {
      company_name: 'North Ridge Internal Fleet',
      customer_type: 'INTERNAL',
      status: 'ACTIVE',
      primary_contact_name: 'Operations',
      phone: '555-0101',
      email: 'ops@north-ridge.internal',
      payment_terms: 'DUE_ON_RECEIPT',
      credit_limit: 0,
      tax_exempt: true
    },
    {
      company_name: 'Warranty Claims - OEM Partner',
      customer_type: 'WARRANTY',
      status: 'ACTIVE',
      primary_contact_name: 'Warranty Desk',
      phone: '555-0199',
      email: 'warranty@oempartner.com',
      payment_terms: 'NET_15',
      credit_limit: 100000,
      tax_exempt: true
    }
  ]).returning(['id', 'company_name', 'customer_type']);

  const fleetCustomer = customers.find(c => c.company_name === 'Great Lakes Fleet Services');
  const warrantyCustomer = customers.find(c => c.company_name === 'Warranty Claims - OEM Partner');

  if (fleetCustomer) {
    await knex('customer_pricing_rules').insert({
      customer_id: fleetCustomer.id,
      default_labor_rate: 95.00,
      parts_discount_percent: 8.5,
      labor_discount_percent: 5.0,
      shop_supplies_percent: 6.0,
      contract_pricing_enabled: true
    });
  }

  if (warrantyCustomer) {
    await knex('customer_pricing_rules').insert({
      customer_id: warrantyCustomer.id,
      default_labor_rate: 0.00,
      labor_discount_percent: 100.0,
      contract_pricing_enabled: true
    });
  }
};
