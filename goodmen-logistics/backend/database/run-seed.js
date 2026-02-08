#!/usr/bin/env node

/**
 * Run Seed Data Only Script
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

async function runSeed() {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('📡 Connected to database');

    const seedPath = path.join(__dirname, 'seed.sql');
    const seed = fs.readFileSync(seedPath, 'utf8');

    await client.query(seed);
    console.log('✅ Sample data inserted successfully');

    await client.end();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error('❌ Error seeding data:', message);
    await client.end();
    process.exit(1);
  }
}

runSeed();
