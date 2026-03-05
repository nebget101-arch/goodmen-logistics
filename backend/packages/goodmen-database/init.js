#!/usr/bin/env node

/**
 * Database Initialization Script
 * This script creates the database, schema, and seeds initial data
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Load env from repo root so DB scripts work from this package
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '..', '.env'),
});

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

const dbName = process.env.DB_NAME || 'goodmen_logistics';

async function createDatabase() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('📡 Connected to PostgreSQL server');

    // Check if database exists
    const checkDbQuery = `
      SELECT 1 FROM pg_database WHERE datname = $1
    `;
    const result = await client.query(checkDbQuery, [dbName]);

    if (result.rows.length === 0) {
      // Create database
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`✅ Database '${dbName}' created successfully`);
    } else {
      console.log(`ℹ️  Database '${dbName}' already exists`);
    }

    await client.end();
  } catch (error) {
    console.error('❌ Error creating database:', error.message);
    await client.end();
    throw error;
  }
}

async function runSchemaScript() {
  const client = new Client({
    ...dbConfig,
    database: dbName,
  });

  try {
    await client.connect();
    console.log(`📡 Connected to database '${dbName}'`);

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    await client.query(schema);
    console.log('✅ Database schema created successfully');

    await client.end();
  } catch (error) {
    console.error('❌ Error creating schema:', error.message);
    await client.end();
    throw error;
  }
}

async function runSeedScript() {
  const client = new Client({
    ...dbConfig,
    database: dbName,
  });

  try {
    await client.connect();
    console.log(`📡 Connected to database '${dbName}' for seeding`);

    const seedPath = path.join(__dirname, 'seed.sql');
    const seed = fs.readFileSync(seedPath, 'utf8');

    await client.query(seed);
    console.log('✅ Sample data inserted successfully');

    // Display counts
    const vehiclesSource = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.views WHERE table_name = 'all_vehicles'
      ) AS has_view
    `);
    const vehiclesTable = vehiclesSource.rows?.[0]?.has_view ? 'all_vehicles' : 'vehicles';

    const counts = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM drivers) as drivers,
        (SELECT COUNT(*) FROM ${vehiclesTable}) as vehicles,
        (SELECT COUNT(*) FROM hos_records) as hos_records,
        (SELECT COUNT(*) FROM maintenance_records) as maintenance,
        (SELECT COUNT(*) FROM drug_alcohol_tests) as drug_tests,
        (SELECT COUNT(*) FROM loads) as loads
    `);

    console.log('\n📊 Database Statistics:');
    console.log(`   Drivers: ${counts.rows[0].drivers}`);
    console.log(`   Vehicles: ${counts.rows[0].vehicles}`);
    console.log(`   HOS Records: ${counts.rows[0].hos_records}`);
    console.log(`   Maintenance Records: ${counts.rows[0].maintenance}`);
    console.log(`   Drug/Alcohol Tests: ${counts.rows[0].drug_tests}`);
    console.log(`   Loads: ${counts.rows[0].loads}`);

    await client.end();
  } catch (error) {
    console.error('❌ Error seeding data:', error.message);
    await client.end();
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting database initialization...\n');

  try {
    await createDatabase();
    await runSchemaScript();
    await runSeedScript();

    console.log('\n✨ Database initialization completed successfully!');
    console.log(`\n🔗 Connection Details:`);
    console.log(`   Host: ${dbConfig.host}`);
    console.log(`   Port: ${dbConfig.port}`);
    console.log(`   Database: ${dbName}`);
    console.log(`   User: ${dbConfig.user}`);
    console.log('\n💡 Run migrations from backend: npm run migrate:dev\n');
  } catch (error) {
    console.error('\n❌ Database initialization failed');
    process.exit(1);
  }
}

// Run the script
main();
