# Broker import – moving data to production DB

This describes how to load `brokers_import_ready.csv` into your **production** database.

## Prerequisites

1. **Migrations**  
   Ensure the `brokers` table exists in prod (run migrations there first):
   ```bash
   NODE_ENV=production DATABASE_URL="postgresql://..." npx knex migrate:latest
   ```
   (Run from repo root; knex is in `backend/packages/goodmen-database`.)

2. **CSV file**  
   Use `backend/scripts/brokers_import_ready.csv` (or pass another path as the first argument).

## Option A: One-off command with prod URL

From the **repo root**:

```bash
NODE_ENV=production DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE" node backend/scripts/import-brokers.js
```

Replace `USER`, `PASSWORD`, `HOST`, and `DATABASE` with your production Postgres credentials.  
To use a specific CSV file:

```bash
NODE_ENV=production DATABASE_URL="postgresql://..." node backend/scripts/import-brokers.js /path/to/brokers_import_ready.csv
```

## Option B: Use a production env file

1. Create a file at the **repo root** named `.env.production` (do not commit it; add it to `.gitignore` if needed).

2. Set the production database URL:
   ```
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
   ```
   Or use separate vars:
   ```
   PG_HOST=your-prod-host
   PG_PORT=5432
   PG_DATABASE=your_db
   PG_USER=user
   PG_PASSWORD=password
   ```

3. Run the import from the **repo root**:
   ```bash
   NODE_ENV=production node backend/scripts/import-brokers.js
   ```

The script will load `.env.production` when `NODE_ENV=production` and that file exists.

## What the script does

- Reads the CSV, normalizes columns, and deduplicates by `(legal_name, city, state)`.
- Inserts rows into the `brokers` table in batches of 1000.
- Prints: `Imported N brokers, skipped M duplicates.` (duplicates are within the CSV only).

## Important

- **Run once** (or only when you have new data). The script does **not** use `ON CONFLICT`; running it multiple times with the same CSV will insert duplicate rows unless you clear or truncate `brokers` first.
- Keep `.env.production` and any prod URLs **out of version control**.
