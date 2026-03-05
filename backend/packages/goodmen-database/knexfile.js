const path = require('path');

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
function getConnection() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  return {
    database: process.env.PG_DATABASE || process.env.DB_NAME || 'goodmen_logistics',
    user: process.env.PG_USER || process.env.DB_USER || 'postgres',
    password: process.env.PG_PASSWORD || process.env.DB_PASSWORD || '',
    host: process.env.PG_HOST || process.env.DB_HOST || 'localhost',
    port: process.env.PG_PORT ? parseInt(process.env.PG_PORT) : (process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432)
  };
}

module.exports = {
  development: {
    client: 'postgresql',
    connection: getConnection(),
    pool: { min: 2, max: 10 },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    }
  },
  staging: {
    client: 'postgresql',
    connection: getConnection(),
    pool: { min: 2, max: 10 },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    }
  },
  production: {
    client: 'postgresql',
    connection: getConnection(),
    pool: { min: 2, max: 10 },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    }
  }
};
