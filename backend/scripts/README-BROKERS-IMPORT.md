# Loading Brokers in Production

## Option 1: From your laptop (easiest)

Run from the **project root**. Get your production Postgres URL from the Render Dashboard (Dashboard → **safetyapp-db** → **Connection string**), then:

```bash
cd /Users/nebyougetaneh/Desktop/FleetNeuronAPP

export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
export NODE_ENV=production

node backend/scripts/import-brokers.js
```

If you use `.env.production` with `DATABASE_URL` set:

```bash
NODE_ENV=production node backend/scripts/import-brokers.js
```

Optional CSV path: `node backend/scripts/import-brokers.js /path/to/brokers_import_ready.csv`

---

## Option 2: Render one-off job (runs on Render using production DB)

Your **fleetneuron-logistics-service** already has `DATABASE_URL` and the repo (including `backend/scripts/brokers_import_ready.csv`). You can run the import once as a **one-off job** so it uses the same build and env.

### Steps

1. **Create an API key** (if you don’t have one): [Account Settings → API Keys](https://dashboard.render.com/u/settings#api-keys).

2. **Get the logistics service ID**  
   In the Render Dashboard, open **fleetneuron-logistics-service** and copy the service ID from the URL (starts with `srv-`).

3. **Create the job** (run from your machine):

```bash
curl -X POST "https://api.render.com/v1/services/YOUR_SERVICE_ID/jobs" \
  -H "Authorization: Bearer YOUR_RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"startCommand": "npm run import-brokers"}'
```

4. **Check the result**  
   In the Dashboard: **fleetneuron-logistics-service** → **Jobs**. Open the new job and view logs. You should see something like: `Imported 63850 brokers, skipped 0 duplicates.`

The job uses the service’s build and `DATABASE_URL`; no extra config. Run it once for your one-time load.

---

## Output

You’ll see something like:

```text
Imported 63850 brokers, skipped 0 duplicates.
```

---

## Important

- **First load:** Table is empty → run once; script inserts in batches of 1000.
- **Re-run:** The script does **plain INSERT** (no upsert). Running it again will insert duplicate rows. To reload, truncate first: `TRUNCATE TABLE brokers RESTART IDENTITY;` then run the import again.

---

## Manual DB load (not recommended)

The CSV has ~63k rows and quoted fields; the script handles parsing and dedup. Use the script unless you have a strong reason to load manually.
