const { Pool } = require('pg');
const path = require('path');

// Load env from repo root so all services share a single .env
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '..', '..', '.env'),
});

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || process.env.PG_HOST || 'localhost',
      port: process.env.DB_PORT || process.env.PG_PORT || 5432,
      database: process.env.DB_NAME || process.env.PG_DATABASE || 'goodmen_logistics',
      user: process.env.DB_USER || process.env.PG_USER || 'postgres',
      password: process.env.DB_PASSWORD || process.env.PG_PASSWORD || 'postgres',
    };

const pool = new Pool({
  ...poolConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = {
  pool,
  query,
  getClient,
};
