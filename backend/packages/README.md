# Packages

## @goodmen/database

Single source of truth for database schema, migrations, and seeds.

- **Consumers:** `goodmen-logistics/backend` (runs migrations and db scripts via this package).
- **Details:** See [goodmen-database/README.md](./goodmen-database/README.md).

## @goodmen/shared

Shared code for Goodmen Logistics: routes, services, utils, middleware, and storage.

- **Consumers:** `goodmen-logistics/backend` and all microservices under `microservices/`.
- **Setup:** Each app must call `require('@goodmen/shared').setDatabase({ pool, query, getClient, knex })` at startup (before requiring any shared route).
- **Details:** See [goodmen-shared/README.md](./goodmen-shared/README.md).

## Layout

```
packages/
  goodmen-database/   # Schema, migrations, seeds, knexfile
    migrations/
    seeds/
    schema.sql, seed.sql, init.js, knexfile.js, ...
  goodmen-shared/     # Shared package
    routes/
    services/
    utils/
    middleware/
    storage/
    internal/          # DB bridge, user helper (do not require from apps)
    index.js
```
