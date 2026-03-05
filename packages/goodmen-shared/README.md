# @goodmen/shared

Shared routes, services, utils, middleware, and storage for Goodmen Logistics (backend + microservices).

## Setup

Each consumer (backend or microservice) must:

1. **Install the package** (from repo root or consumer dir):
   ```bash
   npm install  # with workspace or file: dependency
   ```

2. **Set the database before loading any route or service** (in your server entry, before `require`-ing routes):
   ```js
   const shared = require('@goodmen/shared');
   const db = require('./config/database');   // your local config
   const knex = require('./config/knex');     // your local knex (if used)
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

- `routes/` – Express routers
- `services/` – business logic
- `utils/` – logger, case-converter, invoice-pdf, etc.
- `middleware/` – auth middleware
- `storage/` – R2 and local storage helpers
- `internal/db.js` – database bridge (do not require from consumers)
