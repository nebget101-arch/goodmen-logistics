# @goodmen/shared

Shared routes, services, utils, middleware, and storage for Goodmen Logistics (backend + microservices).

## Setup

Each consumer (backend or microservice) must:

1. **Install the package** (from repo root or consumer dir):
   ```bash
   npm install  # with workspace or file: dependency
   ```

2. **Set the database before loading any route or service** (in your server entry, before `require`-ing routes). Use the shared config (same env vars: `DATABASE_URL` or `DB_*` / `PG_*`):
   ```js
   const shared = require('@goodmen/shared');
   const db = require('@goodmen/shared/config/database');
   const knex = require('@goodmen/shared/config/knex');
   shared.setDatabase({
     pool: db.pool,
     query: db.query,
     getClient: db.getClient,
     knex
   });
   ```

3. **Use shared routes**:
   ```js
   const loadsRouter = require('@goodmen/shared/routes/loads');
   app.use('/api/loads', loadsRouter);
   ```

## Optional env

- `INVOICE_LOGO_PATH` – path to logo image for invoice PDFs (default: `packages/goodmen-shared/assets/logo.png`)
- `EMPLOYMENT_APPLICATION_TEMPLATE_PATH` – PDF template for driver onboarding
- `MVR_AUTHORIZATION_TEMPLATE_PATH` – PDF template for MVR authorization

## Layout

- `config/` – shared `database.js` (pool, query, getClient) and `knex.js` (uses `@goodmen/database` knexfile). Use from backend and microservices so they don’t need their own config.
- `routes/` – Express routers
- `services/` – business logic
- `utils/` – logger, case-converter, invoice-pdf, etc.
- `middleware/` – auth middleware
- `storage/` – R2 and local storage helpers
- `internal/db.js` – database bridge (do not require from consumers)
