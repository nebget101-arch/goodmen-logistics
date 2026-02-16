// Update with your config settings.

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {

  development: {
    client: 'postgresql',
    connection: {
      database: process.env.PG_DATABASE || 'goodmen_logistics',
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '',
      host: process.env.PG_HOST || 'localhost',
      port: process.env.PG_PORT ? parseInt(process.env.PG_PORT) : 5432
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  },

  staging: {
    client: 'postgresql',
    connection: {
      database: process.env.PG_DATABASE,
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      host: process.env.PG_HOST,
      port: process.env.PG_PORT ? parseInt(process.env.PG_PORT) : 5432
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  },

  production: {
    client: 'postgresql',
    connection: {
      database: process.env.PG_DATABASE,
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      host: process.env.PG_HOST,
      port: process.env.PG_PORT ? parseInt(process.env.PG_PORT) : 5432
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  }

};
