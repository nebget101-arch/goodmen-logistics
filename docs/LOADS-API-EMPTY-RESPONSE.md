# Loads API Returning Empty Data

## Summary

If **GET /api/loads** returns `200` with `data: []` and `meta.total: 0` even though you have seeded loads in the database, the usual cause is that **the API is talking to a different database** than the one you seeded.

## How the API works

- **GET /api/loads** (in `backend/packages/goodmen-shared/routes/loads.js`) does **not** filter by dispatcher, tenant, or user when you send no filters.
- With only `?page=1&pageSize=25&sortBy=pickup_date&sortDir=asc`, the query is effectively:  
  `SELECT ... FROM loads l ...` with **no WHERE clause** (only optional filters for status, billingStatus, driverId, brokerId, q, dateFrom, dateTo).
- So if the `loads` table has rows in the database the API uses, the API will return them.

## Production (Render)

- The loads API is served by **fleetneuron-logistics-service**, which gets its database from Render’s **safetyapp-db** (see `render.yaml`: `fleetneuron-logistics-service` → `DATABASE_URL` from `safetyapp-db`).
- You must run your **seed script against that same database** (the one attached to the logistics service on Render).

## What to do

1. **Confirm which DB you seeded**
   - If you ran the seed against **local Postgres** or a **different Render DB**, production will still have zero rows in `loads`.

2. **Seed the production DB**
   - In Render Dashboard: open the **safetyapp-db** (Postgres) service and copy the **Internal Database URL** (or the URL shown for the logistics service’s `DATABASE_URL`).
   - Run your load seed script with that URL, e.g.:
     ```bash
     DATABASE_URL="postgresql://..." node path/to/your/seed-loads-script.js
     ```
   - Or use Render’s **Shell** for the logistics service (if available) and run the seed there so it uses the same env (same DB).

3. **Verify**
   - Call **GET /api/loads** again (or use the optional `/api/health/db` endpoint if you add it) to confirm the service sees the seeded rows.

## I ran the seed directly on production DB (e.g. pgAdmin)

If you **did** run the seed against the same production DB the API uses (e.g. by pasting/executing it in pgAdmin), and the API still returns empty, the cause is usually one of these:

### 1. List endpoint fails silently (missing or wrong-schema tables)

- **GET /api/loads** runs a query that JOINs `loads` with `drivers`, `brokers`, `load_stops`, and `load_attachments`.
- If **any** of those tables are **missing** or in a **different schema** than the one the app uses, the query throws. The route **catches** that error (Postgres code `42P01` or message containing `relation` / `does not exist`) and returns **200 with `data: []`** instead of 500.
- So you can have rows in `loads` and still get an empty list if e.g. `load_stops` or `drivers` doesn’t exist in that DB/schema.

### 2. Health vs list: different queries

- **GET /api/health/db** (logistics service) does only:  
  `SELECT COUNT(*) FROM loads`  
  and returns `database` (current DB name) and `loadsCount`.
- So:
  - If **/api/health/db** shows `loadsCount: 0` but pgAdmin shows rows in `loads` on the same DB name → the app is likely using a **different schema** (or RLS is hiding rows from the app user).
  - If **/api/health/db** shows `loadsCount > 0` but **GET /api/loads** is still empty → the **list** query is failing (missing/different-schema tables like `load_stops`, `drivers`, `brokers`, `load_attachments`), and the error is being turned into an empty response.

### 3. What to run in pgAdmin (same DB you consider production)

- `SELECT current_database();`
- `SELECT COUNT(*) FROM loads;`
- `SHOW search_path;`
- `SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN ('loads','load_stops','load_attachments','drivers','brokers');`

Compare:

- **Database name** and **loadsCount** from **GET /api/health/db** (on the deployed gateway: e.g. `GET https://fleetneuron-logistics-gateway.onrender.com/api/health/db`) with pgAdmin.
- If the DB name differs, the service is not using the same DB you used in pgAdmin (e.g. Internal vs External URL on Render).
- If the DB name matches but counts differ, or health shows rows and list is empty, check **schema** (search_path, which schema each table is in) and **RLS** on `loads` (and joined tables if needed).

## Health check with load count

The logistics service exposes **GET /health/db**, which returns the current database name and `COUNT(*)` from `loads`. The gateway proxies `/api/health` to logistics, so you can call:

- **GET** `https://fleetneuron-logistics-gateway.onrender.com/api/health/db`

to see exactly what database and load count the API is using.

## Troubleshooting production data (diagnostic)

To troubleshoot why the API returns empty while you have data in prod, use one of these:

### Option A: Call the diagnostic endpoint (after deploy)

- **GET** `https://fleetneuron-logistics-gateway.onrender.com/api/health/db/diagnostic`

Response includes:

- **database** – current DB name (same as `/api/health/db`).
- **search_path** – schema search path the service uses.
- **tables** – for `loads`, `load_stops`, `drivers`, `brokers`, `load_attachments`: whether each exists, which schema(s), and row count (or error if COUNT fails).
- **listQueryDryRun** – result of running the same JOIN query as GET /api/loads:
  - If **success: true** and **total** matches what you expect, the list endpoint should return data (if it still doesn’t, the issue is elsewhere, e.g. auth).
  - If **success: false**, **error** is the exact reason the list returns empty (e.g. missing table, wrong schema).

### Option B: Run the diagnostic script against prod DB

From the repo root, with **the same DATABASE_URL** as the logistics service (e.g. Render **Internal Database URL** for safetyapp-db):

```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname" node backend/scripts/diagnose-loads-db.js
```

Or put `DATABASE_URL` in `.env` or `.env.production` and run:

```bash
node backend/scripts/diagnose-loads-db.js
```

The script prints the same structure as the diagnostic endpoint (database, search_path, tables, listQueryDryRun). Use it when the endpoint isn’t deployed yet or you want to compare the exact URL you use in pgAdmin.

### How to interpret the result

- **listQueryDryRun.success === false** → Fix the reported error (create missing table, fix schema, or fix RLS). That is why GET /api/loads is empty.
- **listQueryDryRun.success === true** but **listQueryDryRun.total === 0** → The DB the API uses has no rows satisfying the list query (e.g. you seeded a different DB or schema).
- **listQueryDryRun.total > 0** but the app still shows empty → The list endpoint is not the problem; check auth, gateway routing, or frontend.
