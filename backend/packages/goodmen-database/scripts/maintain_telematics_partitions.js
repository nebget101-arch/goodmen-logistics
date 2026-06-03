/*
 Telematics partition maintenance (FN-1662, consumes FN-1660 schema).

 Calls manage_vehicle_position_pings_partitions() so that:
   (a) upcoming daily partitions of `vehicle_position_pings` are pre-created, and
   (b) partitions older than the 30-day retention horizon are dropped.

 Intended to run on a DAILY Render cron job (see render.yaml /
 render-dev.yaml `fleetneuron-telematics-partition-cron`). pg_cron is not
 available on Render, so partition lifecycle must be driven from the app side.
 The SQL function pre-creates a forward buffer, so a missed day is harmless, but
 if this does not run for ≳7 days inserts for new days will fail (no partition).

 Optional overrides via env (all integers): forward / backfill / retention days.
   TELEMATICS_PARTITION_FORWARD_DAYS   (function default: 7)
   TELEMATICS_PARTITION_BACKFILL_DAYS  (function default: 2)
   TELEMATICS_PARTITION_RETENTION_DAYS (function default: 30)
*/

const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/goodmen';

function intArg(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const forward = intArg('TELEMATICS_PARTITION_FORWARD_DAYS');
  const backfill = intArg('TELEMATICS_PARTITION_BACKFILL_DAYS');
  const retention = intArg('TELEMATICS_PARTITION_RETENTION_DAYS');

  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Pass explicit args only when all three are provided; otherwise let the
    // SQL function use its own defaults (7 / 2 / 30).
    let res;
    if (forward !== null && backfill !== null && retention !== null) {
      res = await client.query(
        'SELECT manage_vehicle_position_pings_partitions($1, $2, $3)',
        [forward, backfill, retention]
      );
      console.log(
        `[telematics-partitions] ran manage_vehicle_position_pings_partitions(${forward}, ${backfill}, ${retention})`
      );
    } else {
      res = await client.query('SELECT manage_vehicle_position_pings_partitions()');
      console.log('[telematics-partitions] ran manage_vehicle_position_pings_partitions() (defaults)');
    }
    void res;
    console.log('[telematics-partitions] maintenance complete');
  } catch (err) {
    console.error('[telematics-partitions] maintenance failed', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) main();

module.exports = { main };
