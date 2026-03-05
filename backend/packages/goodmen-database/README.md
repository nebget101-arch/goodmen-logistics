# @goodmen/database

Single source of truth for Goodmen Logistics database: schema, migrations, and seeds.

## Contents

- **schema.sql** – Full schema (for fresh init).
- **seed.sql** – Sample data for local/dev.
- **migrations/** – Knex migrations (canonical).
- **seeds/** – Knex seed files.
- **knexfile.js** – Knex config (uses `DATABASE_URL` or `DB_*` / `PG_*` env).
- **init.js** – Create DB + run schema + run seed (no migrations).
- **run-schema.js** / **run-seed.js** – Run schema or seed only.
- **reset.js** – Drop DB and re-run init.
- **status.js** – Connection and table stats.

## Usage

### From the backend (recommended)

Backend depends on `@goodmen/database` and delegates all DB scripts and migrations to this package:

```bash
cd goodmen-logistics/backend
npm install   # installs @goodmen/database

# First-time or reset: create DB + schema + seed (no Knex migrations)
npm run db:init
npm run db:reset   # WARNING: drops and recreates DB

# Schema/seed only
npm run db:schema
npm run db:seed
npm run db:status

# Run Knex migrations (use after schema or for production)
npm run migrate:dev
npm run migrate:prod
```

Ensure `.env` (or env) has `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, or `DATABASE_URL`.

### From this package

You can also run scripts from the package root (e.g. in CI):

```bash
cd packages/goodmen-database
npm install
npm run db:init
npm run migrate:latest
```

Env vars must be set in the environment or in a `.env` in the repo root / backend so `dotenv` can load them when scripts run from backend.

## Knex config

Backend uses this package’s Knex config:

- **Backend** – `config/knex.js` requires `@goodmen/database/knexfile`. Migrations and seeds directories are inside this package, so `knex migrate:latest` (run from backend) applies migrations from `packages/goodmen-database/migrations/`.

## Production

- Use **migrations** for production (not full schema.sql), e.g. run `npm run migrate:prod` from backend during deploy.
- Set `DATABASE_URL` or `PG_*` / `DB_*` in the deploy environment.
