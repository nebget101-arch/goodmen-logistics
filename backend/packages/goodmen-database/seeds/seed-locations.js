/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // Deletes ALL existing entries
  await knex('locations').del();
  await knex('locations').insert([
    {
      id: knex.raw('uuid_generate_v4()'),
      name: 'Garland',
      address: '123 Garland Ave, Garland, TX 75040',
      settings: {},
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: knex.raw('uuid_generate_v4()'),
      name: 'Rockwall',
      address: '456 Rockwall Rd, Rockwall, TX 75087',
      settings: {},
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: knex.raw('uuid_generate_v4()'),
      name: 'Hutchins',
      address: '789 Hutchins Blvd, Hutchins, TX 75141',
      settings: {},
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ]);
};
