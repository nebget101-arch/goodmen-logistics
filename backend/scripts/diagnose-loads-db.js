#!/usr/bin/env node
/**
 * Diagnose production (or any) DB used by the loads API: database name, search_path,
 * table existence/counts, and a dry-run of the list query.
 *
 * Usage (from repo root):
 *   DATABASE_URL="postgresql://user:pass@host:5432/dbname" node backend/scripts/diagnose-loads-db.js
 *
 * Or with .env / .env.production:
 *   node backend/scripts/diagnose-loads-db.js
 *
 * Use the same DATABASE_URL as the logistics service (e.g. Render Internal Database URL).
 */
const path = require('path');
const fs = require('fs');

const repoRoot = path.join(__dirname, '..', '..');
process.chdir(repoRoot);

// Load .env
const dotenvPath = path.join(repoRoot, 'node_modules', 'dotenv');
try {
  const dotenv = require(path.join(repoRoot, 'node_modules', 'dotenv'));
  const envFile = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(repoRoot, '.env.production'))
    ? path.join(repoRoot, '.env.production')
    : path.join(repoRoot, '.env');
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile });
} catch (_) {}

const backendDir = path.join(__dirname, '..');
const sharedPkg = path.join(backendDir, 'packages', 'goodmen-shared');
const { Pool } = require(require.resolve('pg', { paths: [sharedPkg] }));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set DATABASE_URL (e.g. Render Internal Database URL) or run from repo with .env containing DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  // Render and most cloud Postgres require SSL
  ssl: connectionString.includes('render.com') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function run() {
  const out = { database: null, search_path: null, tables: {}, listQueryDryRun: null };

  try {
    const dbResult = await query('SELECT current_database() AS name');
    out.database = (dbResult.rows && dbResult.rows[0] && dbResult.rows[0].name) || null;

    const pathResult = await query('SHOW search_path');
    out.search_path = (pathResult.rows && pathResult.rows[0] && pathResult.rows[0].search_path) || null;

    const tableNames = ['loads', 'load_stops', 'drivers', 'brokers', 'load_attachments'];
    const tablesResult = await query(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       AND table_name = ANY($1::text[])`,
      [tableNames]
    );
    const existing = (tablesResult.rows || []).reduce((acc, r) => {
      const name = r.table_name;
      if (!acc[name]) acc[name] = [];
      acc[name].push(r.table_schema);
      return acc;
    }, {});

    for (const table of tableNames) {
      const schemas = existing[table];
      out.tables[table] = { exists: Array.isArray(schemas) && schemas.length > 0, schemas: schemas || [] };
      if (out.tables[table].exists) {
        try {
          const countResult = await query(`SELECT COUNT(*) AS count FROM ${table}`);
          out.tables[table].count = (countResult.rows && countResult.rows[0] && countResult.rows[0].count) != null
            ? parseInt(String(countResult.rows[0].count), 10)
            : null;
        } catch (e) {
          out.tables[table].countError = e.message || String(e);
        }
      }
    }

    try {
      const dryRunSql = `
        SELECT COUNT(*) AS total
        FROM loads l
        LEFT JOIN drivers d ON l.driver_id = d.id
        LEFT JOIN brokers b ON l.broker_id = b.id
        LEFT JOIN LATERAL (
          SELECT city, state, zip, stop_date FROM load_stops
          WHERE load_id = l.id AND stop_type = 'PICKUP' ORDER BY sequence ASC LIMIT 1
        ) pickup ON true
        LEFT JOIN LATERAL (
          SELECT city, state, zip, stop_date FROM load_stops
          WHERE load_id = l.id AND stop_type = 'DELIVERY' ORDER BY sequence DESC LIMIT 1
        ) delivery ON true
        LEFT JOIN (
          SELECT load_id, COUNT(*) AS attachment_count, array_agg(DISTINCT type) AS attachment_types
          FROM load_attachments GROUP BY load_id
        ) att ON att.load_id = l.id
      `;
      const dryResult = await query(dryRunSql);
      const total = (dryResult.rows && dryResult.rows[0] && dryResult.rows[0].total) != null
        ? parseInt(String(dryResult.rows[0].total), 10)
        : null;
      out.listQueryDryRun = { success: true, total };
    } catch (e) {
      out.listQueryDryRun = { success: false, error: e.message || String(e), code: e.code || null };
    }

    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
