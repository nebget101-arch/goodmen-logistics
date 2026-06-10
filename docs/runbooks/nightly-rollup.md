# Nightly Rollup Cron — Runbook

**Render service:** `fleetneuron-nightly-rollup-cron`  
**Schedule:** `0 2 * * *` (02:00 UTC daily)  
**Source:** `backend/microservices/reporting-service/cron/rollup.cron.js`  
**Jira:** FN-1211 (story), FN-1279 (cron impl), FN-1280 (schema), FN-1281 (this config)

## What it does

Aggregates the previous day's data into three rollup tables keyed by `(tenant_id, day)`:

| Table | Source | Key aggregates |
|-------|--------|----------------|
| `daily_incident_metrics` | `roadside_calls` | `total_incidents`, `open_count`, `closed_count`, `avg_resolution_hours` |
| `daily_vendor_sla` | `roadside_dispatch_assignments` | `total_dispatches`, `on_time_count`, `avg_response_minutes` |
| `daily_payment_metrics` | `roadside_payments` | `total_payments`, `total_amount`, `avg_amount` |

All upserts use `ON CONFLICT (tenant_id, day) DO UPDATE` — re-running for the same day is safe.

## Env vars

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Postgres connection string (injected from `safetyapp-db`) |
| `PG_*` | Yes | Individual connection params (host, port, user, password, database) |
| `NODE_ENV` | Yes | Set to `production` |
| `ROLLUP_DATE` | No | Override target date (`YYYY-MM-DD`). Defaults to yesterday UTC. Use for backfills. |
| `ROLLUP_SLACK_WEBHOOK_URL` | No | Slack incoming webhook URL for failure notifications. Set in Render dashboard. |

## Alert wiring

Render sends **email** to project members automatically when a cron job exits non-zero. The script exits 1 only when **all tenants** fail; partial failures (one tenant fails but others succeed) are logged and counted but do not abort the run.

For **Slack alerts**, set `ROLLUP_SLACK_WEBHOOK_URL` in the Render dashboard environment variables for `fleetneuron-nightly-rollup-cron`. The script will POST a failure summary to the webhook on non-zero exit.

## Monitoring

1. **Render dashboard** → `fleetneuron-nightly-rollup-cron` → Logs → filter by date.
2. **Job output** includes per-table row counts and elapsed time, e.g.:
   ```
   [rollup] 2026-06-10 day=2026-06-09 tenants=12
   [rollup] daily_incident_metrics: 12 rows upserted (234ms)
   [rollup] daily_vendor_sla: 12 rows upserted (198ms)
   [rollup] daily_payment_metrics: 12 rows upserted (211ms)
   [rollup] completed in 643ms exit=0
   ```
3. **Postgres** — check freshness directly:
   ```sql
   SELECT day, COUNT(*) AS tenants, MAX(computed_at) AS last_computed
   FROM daily_incident_metrics
   GROUP BY day
   ORDER BY day DESC
   LIMIT 7;
   ```

## Manual backfill

To re-run for a specific date (e.g., after a missed night or data correction):

```bash
# In Render: trigger a manual run with env override, or run locally:
ROLLUP_DATE=2026-06-09 node backend/microservices/reporting-service/cron/rollup.cron.js
```

Or use the Render dashboard: `fleetneuron-nightly-rollup-cron` → Trigger Run → set `ROLLUP_DATE` in the environment override.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Exit 1, all tenants failed | DB unreachable or pool exhausted | Check Postgres connection limit; Render DB metrics |
| Some tenants missing from rollup | Tenant rows have `trial_status = 'expired'`; source tables empty for that tenant | Expected; partial failures logged, not fatal |
| `ERROR: relation "daily_incident_metrics" does not exist` | FN-1280 migration not run | Deploy `fleetneuron-db-migrations` first |
| Rollup tables stale by > 1 day | Cron missed (Render outage or exit 1) | Check Render job history; run manual backfill for missing days |
| `ROLLUP_DATE` format error | Wrong format passed | Use `YYYY-MM-DD` exactly |

## Deploy order (first-time setup)

1. Run the `fleetneuron-db-migrations` worker (creates the three rollup tables from FN-1280).
2. Deploy `fleetneuron-reporting-service` (the web service; ensures `cron/rollup.cron.js` is present).
3. The `fleetneuron-nightly-rollup-cron` service will pick up the next scheduled run automatically.
4. Optionally trigger a manual backfill to pre-populate yesterday's data.

## Related services

- `fleetneuron-reporting-service` — the HTTP API that reads these rollup tables for dashboards
- `fleetneuron-db-migrations` — runs Knex migrations including the rollup table creation
- `fleetneuron-telematics-partition-cron` — sibling cron for partition maintenance (unrelated)
