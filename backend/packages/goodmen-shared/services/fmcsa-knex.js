const knex = require('../config/knex');

// Phase 1: returns the main-DB Knex instance; consumers query the `fmcsa.*` schema.
// Phase 2 (future): swap to a separate connection driven by FMCSA_DATABASE_URL without
// touching consumers — this accessor is the single chokepoint.
function getFmcsaKnex() {
  return knex;
}

module.exports = { getFmcsaKnex };
