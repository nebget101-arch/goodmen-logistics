# DEVOPS-RUNBOOK.md — FleetNeuron Deployment & Operations

_Last updated: 2026-03-16_

This runbook is the operational reference for deploying FleetNeuron, running migrations, rolling back, and bootstrapping local development.

## Deployment (Render.com)

### 1) Render deployment model in this repo

`render.yaml` defines:
- 1 static frontend service: `fleetneuron-logistics-ui`
- 8 Node web services:
  - `fleetneuron-logistics-gateway`
  - `fleetneuron-reporting-service`
  - `fleetneuron-integrations-service`
  - `fleetneuron-auth-users-service`
  - `fleetneuron-drivers-compliance-service`
  - `fleetneuron-vehicles-maintenance-service`
  - `fleetneuron-logistics-service`
  - `fleetneuron-inventory-service`
  - `fleetneuron-ai-service`
- 1 worker service: `fleetneuron-db-migrations`
- 1 managed Postgres DB: `safetyapp-db`

### 2) How a code push triggers deployment

1. Push commit to the branch connected to Render.
2. Render starts new deploys for Blueprint-managed services.
3. Each web/static service runs its own `buildCommand` and `startCommand` from `render.yaml`.
4. Traffic shifts after successful health/start checks.

### 3) Auto-deploy vs manual deploy

- **Auto-deploy (normal):** frontend + web services redeploy on push.
- **Manual/operational deploy:** `fleetneuron-db-migrations` worker is an operations service used to run migration jobs explicitly.
- **Important nuance:** `fleetneuron-logistics-service` also has a `preDeployCommand` that runs migrations before service start. Treat migrations as a controlled step (see migration section below).

### 4) Deployment verification checklist

After each deploy, verify:

#### A) Gateway
- `GET /health` on gateway service URL.
- Expected: JSON status `ok` and configured target services.

#### B) Microservices health endpoints
Each service exposes `GET /health`:
- reporting-service
- integrations-service
- auth-users-service
- drivers-compliance-service
- vehicles-maintenance-service
- logistics-service
- inventory-service
- ai-service

Additional logistics checks:
- `GET /health/db`
- `GET /health/db/diagnostic`

Gateway health proxy checks:
- `GET /api/health`
- `GET /api/health/db`
- `GET /api/health/db/diagnostic`

#### C) Frontend
- Load the UI URL from Render.
- Confirm API calls succeed through gateway.

#### D) Smoke test critical flows
- Login (`/api/auth/login`)
- Core dashboard/report endpoint
- One read + one write operation in a core module (loads/drivers/inventory)

### 5) Environment variable configuration (Render dashboard)

Configure env vars per service in Render (or via blueprint) before promoting to production.

#### Required cross-service routing vars (gateway)
- `REPORTING_SERVICE_URL`
- `INTEGRATIONS_SERVICE_URL`
- `AUTH_USERS_SERVICE_URL`
- `DRIVERS_COMPLIANCE_SERVICE_URL`
- `VEHICLES_MAINTENANCE_SERVICE_URL`
- `LOGISTICS_SERVICE_URL`
- `INVENTORY_SERVICE_URL`
- `AI_SERVICE_URL`
- `CORS_ORIGIN`

#### Database vars (DB-backed services)
- `DATABASE_URL` (preferred)
- or `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`

`knexfile.js` resolves DB connection from `DATABASE_URL` first, else PG/DB vars.

#### Secrets and integrations
- `JWT_SECRET`
- `OPENAI_API_KEY`
- `TWILIO_*`
- `SENDGRID_*`
- `R2_*` / storage credentials

#### Environment baseline
- `NODE_ENV=production`
- service `PORT` values as defined in Render

---

## Database Migrations

> ⚠️ **Warning:** Always run migrations before deploying new code that depends on new tables/columns.

Migration config source:
- `backend/packages/goodmen-database/knexfile.js`

### 1) Run latest migrations

From `backend/packages/goodmen-database`:

- `npx knex migrate:latest --env production --knexfile ./knexfile.js`

For local dev:

- `npx knex migrate:latest --env development --knexfile ./knexfile.js`

### 2) Check migration status

From `backend/packages/goodmen-database`:

- `npx knex migrate:status --env production --knexfile ./knexfile.js`

(Use `--env development` locally.)

### 3) Roll back one migration batch

From `backend/packages/goodmen-database`:

- `npx knex migrate:rollback --env production --knexfile ./knexfile.js`

### 4) Seeding (development)

From `backend/packages/goodmen-database`:

- `npm run db:seed`
- or `npx knex seed:run --env development --knexfile ./knexfile.js`

### 5) Render migration execution paths

There are two migration paths in production:
1. **Dedicated worker**: `fleetneuron-db-migrations` (`migrate:latest` then idle)
2. **Logistics predeploy**: `fleetneuron-logistics-service` `preDeployCommand`

Operational recommendation:
- Run migrations intentionally first (worker/manual control), then deploy app services.
- Avoid schema drift windows where code is live before schema is ready.

---

## Rollback Procedure

### 1) Roll back to previous deploy in Render

1. Open Render dashboard.
2. Select affected service.
3. Go to **Events/Deploys**.
4. Select last known-good deploy.
5. Use **Rollback / Redeploy this version**.
6. Repeat for dependent services if API contract changed.

### 2) Database rollback (if required)

If failure is migration-related and safe to reverse:
- Run `npx knex migrate:rollback --env production --knexfile ./knexfile.js`

Then redeploy the previous compatible app version.

### 3) Roll back vs hot-fix forward

**Roll back** when:
- Production outage or data corruption risk is active.
- Fast safe fix is not immediately available.
- New deploy breaks critical auth, routing, or DB compatibility.

**Hot-fix forward** when:
- Issue is isolated and low-risk.
- Schema is already advanced and rollback is riskier than patching.
- Fix can be validated quickly with smoke + health checks.

### 4) Post-rollback checklist

- All `/health` endpoints green.
- Login and one critical business flow pass.
- No migration mismatch errors in logs.
- Incident note captured in team ops channel/docs.

---

## Local Development Setup

### 1) Quick start with Docker Compose

Prerequisites:
- Docker Desktop running
- `.env` file exists (copy from `.env.example` and fill values)

Start stack:
- `docker compose up`

This uses `docker-compose.yml` and starts:
- frontend (`4200`)
- gateway (`4000`)
- microservices (`5001`–`5007`, AI `4100`)
- db-migrations helper container

Optional guided startup script:
- `./docker-quick-start.sh`

### 2) Local DB + migration bootstrap

From `backend/packages/goodmen-database`:
1. `npx knex migrate:latest --env development --knexfile ./knexfile.js`
2. `npx knex seed:run --env development --knexfile ./knexfile.js` (or `npm run db:seed`)

### 3) Local health verification

- Gateway: `http://localhost:4000/health`
- Proxied logistics health: `http://localhost:4000/api/health`
- Frontend: `http://localhost:4200`

### 4) Common local pitfalls

- Missing required gateway URLs in env → gateway fails fast.
- DB host mismatch in Docker (`host.docker.internal` expected for services in compose).
- Running code that expects new schema before migrations are applied.

---

## Secrets & Environment Variable Management

> Source of truth for baseline variables: `.env.example`.

### Security rules (mandatory)

- **Never commit `.env` files** or plaintext secrets to git.
- **Rotate `JWT_SECRET` immediately if leaked** (and invalidate active sessions as part of incident response).
- **Treat Twilio/SendGrid credentials as billable secrets**; exposure can create direct cost and abuse risk.
- Use Render environment variables / secret management for production values.

### Environment variable inventory (ALL vars from `.env.example`)

| Variable | Type | Purpose | Services that use it |
|---|---|---|---|
| `TWILIO_ACCOUNT_SID` | Secret | Twilio account credential for voice/SMS calls | Primarily backend services using shared Twilio modules (roadside + notifications; typically drivers-compliance/logistics paths) |
| `TWILIO_AUTH_TOKEN` | Secret | Twilio auth token | Same as above |
| `TWILIO_PHONE_NUMBER` | Config | Twilio sender/caller number | Same as above |
| `TWILIO_TWIML_URL` | Config | Public webhook/TwiML callback base URL | Public roadside webhook handlers and Twilio call flow logic |
| `SENDGRID_API_KEY` | Secret | SendGrid API credential | Backend email senders (roadside/trial-request/notification modules) |
| `SENDGRID_FROM_EMAIL` | Config | Default sender identity for outbound email | Backend email senders |
| `PUBLIC_APP_BASE_URL` | Config | Public app base URL for links in notifications/onboarding | Trial request links, roadside link generation |
| `APP_BASE_URL` | Config | App base URL fallback for local/non-public links | Trial/roadside email link generation |
| `ROADSIDE_DISPATCHER_EMAILS` | Config | Comma-separated escalation/notification recipients | Roadside alerting workflows |
| `DB_HOST` | Config | DB host fallback when `DATABASE_URL` is not set | DB-backed services via `knexfile.js` fallback resolution |
| `DB_PORT` | Config | DB port fallback | DB-backed services via `knexfile.js` fallback resolution |
| `DB_USER` | Secret | DB username fallback | DB-backed services via `knexfile.js` fallback resolution |
| `DB_PASSWORD` | Secret | DB password fallback | DB-backed services via `knexfile.js` fallback resolution |
| `DB_NAME` | Config | DB name fallback | DB-backed services via `knexfile.js` fallback resolution |
| `AWS_ACCESS_KEY_ID` | Secret | Legacy/general S3-compatible key (if used) | Storage-related codepaths when configured |
| `AWS_SECRET_ACCESS_KEY` | Secret | Legacy/general S3-compatible secret | Storage-related codepaths when configured |
| `AWS_REGION` | Config | AWS region for compatible SDK defaults | Storage/integration codepaths when configured |
| `R2_ENDPOINT` | Config | Cloudflare R2 endpoint | R2 storage access modules |
| `R2_BUCKET` | Config | R2 bucket name | Drivers-compliance / vehicles-maintenance / logistics doc-storage flows |
| `R2_ACCESS_KEY_ID` | Secret | R2 access key | R2 storage modules |
| `R2_SECRET_ACCESS_KEY` | Secret | R2 secret key | R2 storage modules |
| `NODE_ENV` | Config | Runtime environment (`development`/`production`) | All Node services |
| `LOG_LEVEL` | Config | Logging verbosity | Backend services with logger configuration |
| `PORT` | Config | Service listen port | Gateway and each backend service container |
| `JWT_SECRET` | Secret | JWT signing/verification secret | Auth/login + auth middleware consumers |
| `JWT_EXPIRATION` | Config | Intended token expiration policy value | Reserved/config standard (verify codepath before relying on it) |
| `REDIS_URL` | Secret/Config | Redis connection URI (optional) | Optional caching/session/rate-limit infrastructure |
| `REDIS_PASSWORD` | Secret | Redis auth password (optional) | Optional Redis-enabled deployments |
| `ENABLE_TWILIO_CALLS` | Config (Feature Flag) | Enable/disable Twilio call features | Roadside/notification feature gating |
| `ENABLE_SENDGRID_EMAILS` | Config (Feature Flag) | Enable/disable email sending features | Email-notification feature gating |
| `ENABLE_CALL_RECORDING` | Config (Feature Flag) | Enable/disable call recording behavior | Roadside voice/call handling workflows |
| `ENABLE_REVERSE_GEOCODING` | Config (Feature Flag) | Enable/disable reverse geocoding enrichment | Roadside/location enrichment workflows |
| `OPENAI_API_KEY` | Secret | OpenAI API credential | `fleetneuron-ai-service` and AI extraction paths |
| `ROADSIDE_AI_MODEL` | Config | AI model selection for roadside workflows | Roadside AI assistant codepaths |
| `ROADSIDE_AI_PROMPT_VERSION` | Config | Prompt-template/version selector | Roadside AI prompt orchestration |

### Feature flags and effect

| Feature Flag | Effect when `true` | Effect when `false` |
|---|---|---|
| `ENABLE_TWILIO_CALLS` | Voice/SMS call initiation paths are allowed | Twilio call features should be disabled/fallback |
| `ENABLE_SENDGRID_EMAILS` | Email sending paths are allowed | Email sending should be skipped/fallback |
| `ENABLE_CALL_RECORDING` | Call recording handling enabled | Recording capture/processing disabled |
| `ENABLE_REVERSE_GEOCODING` | Geocoding enrichment enabled | Raw coordinates/location without reverse-geocode enrichment |

> Keep feature flags environment-specific. Validate desired value in both local and Render before release.

### Adding a new environment variable (standard process)

1. **Define the variable contract**
  - Name, type (`secret` vs `config`), default behavior, and owning team.

2. **Add locally for development**
  - Add key to `.env.example` with safe placeholder.
  - Add real value to local `.env` (never commit).
  - Update code to read via `process.env.<KEY>` with safe fallback where appropriate.

3. **Add in Render**
  - Open each affected service in Render dashboard.
  - Add variable under **Environment**.
  - For secrets, mark/handle as sensitive and do not paste into docs/PR comments.

4. **Propagate to all required services**
  - If multiple services use the variable, add it to each service explicitly.
  - If managed by `render.yaml`, add the env var there (or use `sync: false` for manual secret entry in dashboard).

5. **Deploy and verify**
  - Redeploy impacted services.
  - Check health endpoints and one functional smoke test for the changed feature.

6. **Document**
  - Update this runbook variable table and any feature-specific docs.

### Rotation and incident handling

- On suspected leak of any secret (`JWT_SECRET`, Twilio, SendGrid, OpenAI, DB, R2):
  1. Rotate in provider dashboard.
  2. Update Render env vars.
  3. Redeploy affected services.
  4. Invalidate/expire sessions where applicable (`JWT_SECRET` incidents).
  5. Record incident and timeline in ops notes.

---

## Operational Golden Rules

1. Migrate first, deploy second.
2. Verify health endpoints after every deploy.
3. Keep secrets only in Render env vars (never in git).
4. Roll back quickly on critical regressions; investigate after stabilization.
5. Record every production migration/rollback in release notes.
