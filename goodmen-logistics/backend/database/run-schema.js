#!/usr/bin/env node

/**
 * Run Schema Only Script
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'goodmen_logistics'
    };

async function runSchema() {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('📡 Connected to database');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    await client.query(schema);
    console.log('✅ Database schema created successfully');

    await client.end();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error('❌ Error creating schema:', message);
    await client.end();
    process.exit(1);
  }
}

runSchema();
