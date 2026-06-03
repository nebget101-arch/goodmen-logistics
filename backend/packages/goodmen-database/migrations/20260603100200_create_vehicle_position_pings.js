'use strict';

/**
 * FN-1660 — Telematics ingestion foundation: vehicle_position_pings (+ 30-day retention).
 *
 * Write-optimized store for normalized GPS pings (every ~30s per vehicle).
 * High volume (≈500 vehicles × 2/min ≈ 1.4M rows/day), so this table is
 * RANGE-partitioned by `ts` into DAILY partitions. Retention = 30 days raw,
 * enforced by DROPPING whole day-partitions older than the horizon (instant,
 * no per-row DELETE bloat).
 *
 * ── Retention strategy decision (ticket: "check prod Postgres, decide
 *    partitioning vs TimescaleDB; document the choice") ──────────────────
 *
 *   Checked prod-class Render Postgres (dev instance, oregon-postgres, PG 18.3):
 *     • timescaledb 2.23.0 — AVAILABLE and installable (CREATE EXTENSION
 *       succeeded in a rolled-back tx), but NOT installed and used nowhere
 *       else in the schema.
 *     • pg_cron — NOT available (so no in-DB scheduler regardless).
 *     • shared_preload_libraries — not readable by our role, so we cannot
 *       confirm TimescaleDB's background job scheduler actually runs; its
 *       auto-retention policies therefore can't be relied upon.
 *
 *   Decision: NATIVE declarative range partitioning (no TimescaleDB).
 *     • Zero extension dependency — works identically on local dev / CI
 *       (plain `postgresql` per knexfile) and on Render. A TimescaleDB
 *       hypertable would make this core table un-migratable off Render.
 *     • 30-day retention via partition DROP — cheaper than row deletes and
 *       than TimescaleDB drop_chunks for our access pattern.
 *     • Partition lifecycle (pre-create future days + drop old days) is
 *       driven by an APP cron calling manage_vehicle_position_pings_partitions()
 *       daily — pg_cron is unavailable, and we'd need an app cron for
 *       TimescaleDB on Render anyway. Handed to backend/devops (FN-1661/FN-1662).
 *
 * Schema (parent partitioned table)
 *   id              UUID         (part of PK; default uuid_generate_v4())
 *   vehicle_id      UUID NOT NULL  — no hard FK: write-optimized ingest path;
 *                                    integrity upheld upstream by
 *                                    telematics_devices.vehicle_id → vehicles.id
 *   ts              TIMESTAMPTZ NOT NULL  — partition key (ping timestamp)
 *   lat             DOUBLE PRECISION  CHECK -90..90
 *   lng             DOUBLE PRECISION  CHECK -180..180
 *   speed_mph       REAL              CHECK >= 0
 *   heading_deg     REAL              CHECK 0..<360
 *   source_event_id TEXT              — provider event id (dedup key)
 *   payload         JSONB             — raw normalized provider payload
 *   created_at      TIMESTAMPTZ DEFAULT now()
 *
 * Constraints / indexes
 *   PRIMARY KEY (id, ts)                              — partition key must be in PK
 *   INDEX  (vehicle_id, ts DESC)                      — latest position per vehicle
 *   UNIQUE (vehicle_id, source_event_id, ts)          — idempotent-ingest race net,
 *                                                       matches FN-1661's app dedup
 *                                                       key (vehicle_id, source_event_id);
 *                                                       ts appended because a unique
 *                                                       index on a partitioned table
 *                                                       must include the partition key.
 *                                                       NULL source_event_id (polling
 *                                                       fallback) allowed many.
 */

const PARENT = 'vehicle_position_pings';
const MANAGE_FN = 'manage_vehicle_position_pings_partitions';

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable(PARENT);
  if (hasTable) return;

  // 1. Parent partitioned table.
  await knex.raw(`
    CREATE TABLE ${PARENT} (
      id              uuid             NOT NULL DEFAULT uuid_generate_v4(),
      vehicle_id      uuid             NOT NULL,
      ts              timestamptz      NOT NULL,
      lat             double precision,
      lng             double precision,
      speed_mph       real,
      heading_deg     real,
      source_event_id text,
      payload         jsonb,
      created_at      timestamptz      NOT NULL DEFAULT now(),
      CONSTRAINT ${PARENT}_pkey PRIMARY KEY (id, ts),
      CONSTRAINT ${PARENT}_lat_chk     CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90)),
      CONSTRAINT ${PARENT}_lng_chk     CHECK (lng IS NULL OR (lng BETWEEN -180 AND 180)),
      CONSTRAINT ${PARENT}_speed_chk   CHECK (speed_mph IS NULL OR speed_mph >= 0),
      CONSTRAINT ${PARENT}_heading_chk CHECK (heading_deg IS NULL OR (heading_deg >= 0 AND heading_deg < 360))
    ) PARTITION BY RANGE (ts)
  `);

  // 2. Indexes (defined on the parent → propagate to every partition).
  await knex.raw(`
    CREATE INDEX idx_${PARENT}_vehicle_ts
      ON ${PARENT} (vehicle_id, ts DESC)
  `);
  // Idempotent-ingest race net. FN-1661 dedups in app code on
  // (vehicle_id, source_event_id); this unique mirrors that key so a concurrent
  // double-webhook is rejected at the DB. ts is appended because a unique index
  // on a partitioned table must include the partition key. NULL source_event_id
  // (polling fallback) is exempt — NULLs are distinct.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_${PARENT}_vehicle_source_event
      ON ${PARENT} (vehicle_id, source_event_id, ts)
  `);

  // 3. Partition lifecycle function: pre-create a forward window of daily
  //    partitions and drop partitions older than the retention horizon.
  //    Idempotent — safe to call repeatedly (intended: daily app cron).
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${MANAGE_FN}(
      forward_days   integer DEFAULT 7,
      backfill_days  integer DEFAULT 1,
      retention_days integer DEFAULT 30
    ) RETURNS void
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      d           date;
      part_name   text;
      lower_bound text;
      upper_bound text;
      r           record;
    BEGIN
      -- Pre-create [today - backfill_days, today + forward_days] daily partitions.
      FOR d IN
        SELECT generate_series(
                 (CURRENT_DATE - backfill_days),
                 (CURRENT_DATE + forward_days),
                 interval '1 day'
               )::date
      LOOP
        part_name   := format('${PARENT}_%s', to_char(d, 'YYYYMMDD'));
        lower_bound := to_char(d,     'YYYY-MM-DD') || ' 00:00:00+00';
        upper_bound := to_char(d + 1, 'YYYY-MM-DD') || ' 00:00:00+00';
        IF NOT EXISTS (
          SELECT 1 FROM pg_class WHERE relname = part_name AND relkind = 'r'
        ) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF ${PARENT} FOR VALUES FROM (%L) TO (%L)',
            part_name, lower_bound, upper_bound
          );
        END IF;
      END LOOP;

      -- Drop whole-day partitions older than the retention horizon.
      FOR r IN
        SELECT c.relname
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = '${PARENT}'
          AND c.relname ~ '^${PARENT}_[0-9]{8}$'
          AND to_date(right(c.relname, 8), 'YYYYMMDD') < (CURRENT_DATE - retention_days)
      LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I', r.relname);
      END LOOP;
    END;
    $fn$
  `);

  await knex.raw(`COMMENT ON FUNCTION ${MANAGE_FN}(integer, integer, integer) IS
    'FN-1660: pre-create forward daily partitions and drop partitions older than retention_days (default 30). Call daily from an app cron — pg_cron is unavailable on Render.'`);

  // 4. Create the initial partition window so ingestion works immediately.
  await knex.raw(`SELECT ${MANAGE_FN}()`);

  // 5. Self-documenting comments.
  await knex.raw(`COMMENT ON TABLE ${PARENT} IS
    'FN-1660: normalized telematics GPS pings. RANGE-partitioned by ts (daily). 30-day raw retention via ${MANAGE_FN}() — native partitioning, no TimescaleDB.'`);
  await knex.raw(`COMMENT ON COLUMN ${PARENT}.vehicle_id IS
    'vehicles.id — intentionally no FK (write-optimized ingest); integrity via telematics_devices.vehicle_id'`);
  await knex.raw(`COMMENT ON COLUMN ${PARENT}.source_event_id IS
    'provider event id; (vehicle_id, source_event_id, ts) is unique for idempotent ingest'`);
};

exports.down = async function down(knex) {
  // Dropping the parent cascades to all child partitions.
  await knex.raw(`DROP TABLE IF EXISTS ${PARENT} CASCADE`);
  await knex.raw(`DROP FUNCTION IF EXISTS ${MANAGE_FN}(integer, integer, integer)`);
};
