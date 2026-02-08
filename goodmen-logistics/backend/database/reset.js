#!/usr/bin/env node

/**
 * Database Reset Script
 * WARNING: This will drop and recreate the entire database
 */

const { Client } = require('pg');
const { execSync } = require('child_process');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

const dbName = process.env.DB_NAME || 'goodmen_logistics';

async function resetDatabase() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('📡 Connected to PostgreSQL server');

    // Terminate all connections to the database
    await client.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid()
    `, [dbName]);

    // Drop database if exists
    await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
    console.log(`🗑️  Database '${dbName}' dropped`);

    await client.end();

    // Run initialization script
    console.log('\n🔄 Recreating database...\n');
    execSync('node database/init.js', { stdio: 'inherit' });

  } catch (error) {
    console.error('❌ Error resetting database:', error.message);
    await client.end();
    process.exit(1);
  }
}

console.log('⚠️  WARNING: This will delete all data in the database!');
console.log('Database:', dbName);
console.log('\nStarting reset in 3 seconds... (Press Ctrl+C to cancel)\n');

setTimeout(() => {
  resetDatabase();
}, 3000);
