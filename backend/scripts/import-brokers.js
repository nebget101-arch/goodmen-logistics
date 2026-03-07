#!/usr/bin/env node
/**
 * Import brokers from brokers_import_ready.csv
 *
 * Usage:
 *   node backend/scripts/import-brokers.js [path/to/brokers_import_ready.csv]
 *
 * Environment (from repo root .env or .env.production):
 *   DATABASE_URL   - Postgres connection string (preferred for prod)
 *   or PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD
 *
 * To run against production DB:
 *   NODE_ENV=production DATABASE_URL="postgresql://user:pass@host:5432/dbname" node backend/scripts/import-brokers.js
 *   Or create .env.production with DATABASE_URL and run:
 *   NODE_ENV=production node backend/scripts/import-brokers.js
 */
const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..');
const repoRoot = path.join(backendDir, '..');
process.chdir(repoRoot);

// Load .env from repo root (prefer .env.production when NODE_ENV=production)
try {
  const dotenvPath = require.resolve('dotenv', { paths: [path.join(backendDir, 'packages', 'goodmen-shared')] });
  const dotenv = require(dotenvPath);
  const envFile = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(repoRoot, '.env.production'))
    ? path.join(repoRoot, '.env.production')
    : path.join(repoRoot, '.env');
  dotenv.config({ path: envFile });
} catch (_) {}

const knex = require('../packages/goodmen-shared/config/knex');
const { importBrokers } = require('../services/brokerImportService');

const defaultCsv = path.join(__dirname, 'brokers_import_ready.csv');
const csvPath = process.argv[2] || defaultCsv;

async function main() {
  try {
    const result = await importBrokers({ knex, csvPath });
    console.log(`Imported ${result.inserted} brokers, skipped ${result.duplicates} duplicates.`);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    await knex.destroy();
  }
}

main();
