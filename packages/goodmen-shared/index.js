/**
 * @goodmen/shared
 * Consumers must call setDatabase({ pool, query, getClient, knex }) at startup
 * before requiring any route or service that uses the DB.
 */
const db = require('./internal/db');

module.exports = {
  setDatabase: db.setDatabase
};
