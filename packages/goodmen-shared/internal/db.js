/**
 * Database bridge: consumers (backend, microservices) call setDatabase() at startup
 * so that shared routes/services can use the same DB and knex without bundling config.
 */
const state = {
  pool: null,
  query: null,
  getClient: null,
  knex: null
};

function setDatabase(s) {
  if (s.pool !== undefined) state.pool = s.pool;
  if (s.query !== undefined) state.query = s.query;
  if (s.getClient !== undefined) state.getClient = s.getClient;
  if (s.knex !== undefined) state.knex = s.knex;
}

module.exports = {
  setDatabase,
  get pool() { return state.pool; },
  get query() { return state.query; },
  get getClient() { return state.getClient; },
  get knex() { return state.knex; }
};
