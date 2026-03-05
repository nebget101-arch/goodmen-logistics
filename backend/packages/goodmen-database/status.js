#!/usr/bin/env node

/**
 * Database Status Check Script
 * Run from package root: npm run db:status
 */

const { Client } = require('pg');
const path = require('path');

// Load env from repo root so DB scripts work from this package
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '..', '.env'),
});

const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'goodmen_logistics',
    };

async function checkStatus() {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('✅ Database connection successful!\n');

    const dbName = typeof dbConfig.database === 'string' ? dbConfig.database : (process.env.DB_NAME || 'goodmen_logistics');
    const sizeResult = await client.query(
      `SELECT pg_size_pretty(pg_database_size($1)) as size`,
      [dbName]
    );

    console.log('📊 Database Information:');
    console.log(`   Name: ${dbName}`);
    if (dbConfig.host) console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`   Size: ${sizeResult.rows[0].size}\n`);

    const counts = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM drivers) as drivers,
        (SELECT COUNT(*) FROM all_vehicles) as vehicles,
        (SELECT COUNT(*) FROM hos_records) as hos_records,
        (SELECT COUNT(*) FROM hos_logs) as hos_logs,
        (SELECT COUNT(*) FROM maintenance_records) as maintenance,
        (SELECT COUNT(*) FROM drug_alcohol_tests) as drug_tests,
        (SELECT COUNT(*) FROM loads) as loads,
        (SELECT COUNT(*) FROM audit_logs) as audit_logs
    `);

    console.log('📈 Table Statistics:');
    console.log(`   Drivers: ${counts.rows[0].drivers}`);
    console.log(`   Vehicles: ${counts.rows[0].vehicles}`);
    console.log(`   HOS Records: ${counts.rows[0].hos_records}`);
    console.log(`   HOS Logs: ${counts.rows[0].hos_logs}`);
    console.log(`   Maintenance Records: ${counts.rows[0].maintenance}`);
    console.log(`   Drug/Alcohol Tests: ${counts.rows[0].drug_tests}`);
    console.log(`   Loads: ${counts.rows[0].loads}`);
    console.log(`   Audit Logs: ${counts.rows[0].audit_logs}\n`);

    const recentDrivers = await client.query(`
      SELECT first_name, last_name, status, created_at
      FROM drivers
      ORDER BY created_at DESC
      LIMIT 3
    `);

    if (recentDrivers.rows.length > 0) {
      console.log('👥 Recent Drivers:');
      recentDrivers.rows.forEach((driver) => {
        console.log(`   ${driver.first_name} ${driver.last_name} (${driver.status}) - ${driver.created_at.toLocaleDateString()}`);
      });
      console.log('');
    }

    const activeLoads = await client.query(`
      SELECT load_number, status, pickup_location, delivery_location
      FROM loads
      WHERE status = 'in-transit'
      ORDER BY pickup_date DESC
      LIMIT 3
    `);

    if (activeLoads.rows.length > 0) {
      console.log('🚚 Active Loads:');
      activeLoads.rows.forEach((load) => {
        console.log(`   ${load.load_number}: ${load.pickup_location} → ${load.delivery_location}`);
      });
      console.log('');
    }

    console.log('✨ Database is healthy and operational!\n');

    await client.end();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Ensure PostgreSQL is running');
    console.error('   2. Check .env file for correct credentials');
    console.error('   3. From backend: npm run db:init (uses @goodmen/database)\n');
    process.exit(1);
  }
}

checkStatus();
