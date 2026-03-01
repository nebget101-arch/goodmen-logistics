/**
 * Ensure standard shop locations exist.
 */
exports.up = async function(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== 'true') {
    return;
  }
  const locations = [
    { name: 'Garland Main Warehouse', address: '1234 Industrial Blvd, Garland, TX' },
    { name: 'Rockwall Shop', address: '9101 I-30 Frontage Rd, Rockwall, TX' },
    { name: 'Garland Shop', address: '5678 Service Rd, Garland, TX' },
    { name: 'Hutchins Shop', address: '2222 Logistics Way, Hutchins, TX' }
  ];

  for (const loc of locations) {
    const existing = await knex('locations')
      .whereRaw('LOWER(name) = ?', [loc.name.toLowerCase()])
      .first();

    if (existing) {
      await knex('locations')
        .where({ id: existing.id })
        .update({
          address: loc.address,
          updated_at: knex.fn.now()
        });
    } else {
      await knex('locations').insert({
        name: loc.name,
        address: loc.address,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }
};

exports.down = async function(knex) {
  await knex('locations')
    .whereIn('name', [
      'Garland Main Warehouse',
      'Rockwall Shop',
      'Garland Shop',
      'Hutchins Shop'
    ])
    .del();
};
