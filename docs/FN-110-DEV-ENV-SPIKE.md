# FN-110 — Dev Environment Spike: Decisions & Deliverables

**Date:** 2026-03-18  
**Status:** ✅ Decision finalized — unblocks FN-111, FN-112, FN-113, FN-114  
**Author:** Engineering

---

## 1. Current Production Baseline (from `render.yaml`)

| # | Service Name | Type | Plan | R2? | URL |
|---|---|---|---|---|---|
| 1 | `fleetneuron-logistics-ui` | static web | free (static) | — | `https://fleetneuron.ai` (custom domain) |
| 2 | `fleetneuron-logistics-gateway` | node web | starter | — | `.onrender.com` |
| 3 | `fleetneuron-reporting-service` | node web | starter | — | `.onrender.com` |
| 4 | `fleetneuron-integrations-service` | node web | starter | — | `.onrender.com` |
| 5 | `fleetneuron-auth-users-service` | node web | starter | — | `.onrender.com` |
| 6 | `fleetneuron-drivers-compliance-service` | node web | starter | ✅ | `.onrender.com` |
| 7 | `fleetneuron-vehicles-maintenance-service` | node web | starter | ✅ | `.onrender.com` |
| 8 | `fleetneuron-logistics-service` | node web | starter | ✅ | `.onrender.com` |
| 9 | `fleetneuron-inventory-service` | node web | starter | — | `.onrender.com` |
| 10 | `fleetneuron-ai-service` | node web | starter | — | `.onrender.com` |
| 11 | `fleetneuron-db-migrations` | worker | starter | — | — |
| DB | `safetyapp-db` | PostgreSQL | basic-256mb | — | — |

**Production UI URL:** `https://fleetneuron.ai` (custom domain on `fleetneuron-logistics-ui`; Render subdomain disabled)  
**Ports in use:** 10002–10010 (gateway through AI service)  
**Migration strategy:** `fleetneuron-logistics-service` has a `preDeployCommand` that runs `knex migrate:latest`. `fleetneuron-db-migrations` is a long-lived worker that also runs migrations on manual deploy.

---

## 2. Decision: Naming Convention

**Decision: `-dev` suffix on all service names, inside a separate Render project named `FleetNeuron Dev`.**

Rationale:
- Render service names are globally unique slugs — a service called `fleetneuron-logistics-ui` in the dev project would collide with the prod service. The `-dev` suffix avoids this.
- A separate Render **project** (not just separate services in the same project) provides a clean boundary: separate deploy notifications, separate team access controls, no risk of accidentally pointing a dev URL env var at a prod service.
- The `-dev` suffix is visible in every URL, log entry, and Render dashboard panel — zero ambiguity.

**Dev service names:**

| Prod Name | Dev Name |
|---|---|
| `fleetneuron-logistics-ui` | `fleetneuron-logistics-ui-dev` |
| `fleetneuron-logistics-gateway` | `fleetneuron-logistics-gateway-dev` |
| `fleetneuron-reporting-service` | `fleetneuron-reporting-service-dev` |
| `fleetneuron-integrations-service` | `fleetneuron-integrations-service-dev` |
| `fleetneuron-auth-users-service` | `fleetneuron-auth-users-service-dev` |
| `fleetneuron-drivers-compliance-service` | `fleetneuron-drivers-compliance-service-dev` |
| `fleetneuron-vehicles-maintenance-service` | `fleetneuron-vehicles-maintenance-service-dev` |
| `fleetneuron-logistics-service` | `fleetneuron-logistics-service-dev` |
| `fleetneuron-inventory-service` | `fleetneuron-inventory-service-dev` |
| `fleetneuron-ai-service` | `fleetneuron-ai-service-dev` |
| `fleetneuron-db-migrations` | `fleetneuron-db-migrations-dev` |
| `safetyapp-db` | `safetyapp-db-dev` |

**Dev base URL pattern:** `https://<service-name>.onrender.com` for backend services  
Dev UI URL: `https://dev.fleetneuron.ai`

> **Note:** Production UI is served at `https://fleetneuron.ai` and Dev UI is served at `https://dev.fleetneuron.ai`.

---

## 3. Decision: Database Plan

**Decision: `basic-256mb` ($7/month) — same plan as production.**

Options evaluated:

| Option | Cost | Expiry | Verdict |
|---|---|---|---|
| Render free PostgreSQL | $0 | ❌ Expires after 90 days | Rejected |
| `basic-256mb` | $7/mo | No expiry | ✅ Selected |
| `standard-1gb` | $20/mo | No expiry | Overkill for dev |

Rationale:
- The free tier expires in 90 days and forces a manual recreate + re-seed cycle. For an ongoing dev environment used across multiple sprints this is unacceptable overhead.
- At $7/month the `basic-256mb` plan matches prod, avoids schema drift risk from plan differences, and has the same connection limits.
- Dev data volume is minimal (seed data only) — `basic-256mb` (256MB RAM, 1GB storage) is more than sufficient.

**Database name:** `goodmen_logistics_dev`  
**User:** `goodmen_user_dev`  
**Render resource name:** `safetyapp-db-dev`

---

## 4. Decision: Cloudflare R2 Storage

**Decision: Separate dev bucket in the same Cloudflare R2 account.**

| Option | Verdict |
|---|---|
| Same bucket, `dev/` prefix | Rejected — dev deletes or corrupts could touch prod paths; bucket policies harder to scope |
| Separate dev bucket (`fleetneuron-dev`) | ✅ Selected |
| Entirely separate Cloudflare account | Overkill |

**Dev bucket name:** `fleetneuron-dev`

Rationale:
- Complete isolation: purging all dev uploads (e.g., test driver documents) never touches the prod bucket.
- R2 free tier covers dev easily: 10 GB storage free, 1M Class A ops free, 10M Class B ops free — dev usage will stay well under these thresholds at no additional cost.
- Same `R2_ACCOUNT_ID` and API credentials can be reused. Only `R2_BUCKET` differs between prod and dev.

Services that use R2 (need `R2_BUCKET=fleetneuron-dev` in dev):
- `fleetneuron-drivers-compliance-service-dev`
- `fleetneuron-vehicles-maintenance-service-dev`
- `fleetneuron-logistics-service-dev`

---

## 5. Decision: Secrets Sharing Policy

Every secret falls into one of three categories: **must be isolated**, **should be isolated**, or **safe to share**.

### 🔴 Must Be Isolated (never share with prod)

| Secret | Dev Value | Reason |
|---|---|---|
| `JWT_SECRET` | New randomly generated 64-char secret | A dev-issued JWT would be accepted by the prod API if the secret is shared. This is a critical security boundary. |
| `DATABASE_URL` / `PG_*` vars | Auto-resolved from `safetyapp-db-dev` | Separate database, never touches prod data. |
| `R2_BUCKET` | `fleetneuron-dev` | Points to dev-only bucket. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe test mode keys only | Never use prod Stripe live keys in dev. Use Stripe's test dashboard keys. |
| `NODE_ENV` | `development` | Different runtime behavior (verbose logging, less caching). |

### 🟡 Should Be Isolated (separate dev credentials preferred)

| Secret | Dev Value | Reason |
|---|---|---|
| `OPENAI_API_KEY` | Separate dev key with a spend cap | Prevents dev test loops from burning prod OpenAI budget. Create a separate key in the OpenAI dashboard with a $20/month hard cap. |
| `OPENAI_MODEL` | `gpt-4.1-mini` (already cheapest) | Same is fine — already using the low-cost model. |

### 🟢 Safe to Share (read-only external APIs)

| Secret | Sharing Decision | Reason |
|---|---|---|
| `FMCSA_API_KEY` | ✅ Reuse prod key | Read-only external API — no write side effects, no billing risk. |
| `R2_ACCOUNT_ID` | ✅ Reuse prod value | Same Cloudflare account, isolated at bucket level. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | ✅ Reuse prod credentials | R2 API token can be scoped to allow access to both `fleetneuron` and `fleetneuron-dev` buckets. No prod data at risk. |
| `R2_REGION` | ✅ Reuse (`auto`) | Same value. |
| `R2_SIGNED_URL_EXPIRES_SECONDS` | ✅ Reuse (`900`) | Same value. |

### Summary Table

| Secret | Dev Action |
|---|---|
| `JWT_SECRET` | 🔴 Generate new secret |
| `DATABASE_URL` / `PG_*` | 🔴 Separate dev DB |
| `R2_BUCKET` | 🔴 `fleetneuron-dev` |
| `STRIPE_*` | 🔴 Test mode keys |
| `OPENAI_API_KEY` | 🟡 Separate key + spend cap |
| `FMCSA_API_KEY` | 🟢 Reuse |
| `R2_ACCOUNT_ID` / credentials | 🟢 Reuse |
| `NODE_ENV` | Set to `development` |

---

## 6. Decision: Auto-Deploy Strategy

**Decision: Auto-deploy on push to `develop` branch. Feature branches require manual deploy.**

| Branch | Deploy Target | Trigger |
|---|---|---|
| `main` | Production | Auto (existing) |
| `develop` | Dev environment | Auto on push |
| `feature/*` | — | Manual deploy only (trigger from Render dashboard or CLI) |

Rationale:
- The `develop` branch is the integration branch — auto-deploying it gives all team members an always-current preview of the merged integration state.
- Feature branches should not auto-deploy to avoid burning build minutes on in-progress work.
- The migration worker (`fleetneuron-db-migrations-dev`) should **not** auto-deploy — only trigger it manually after merging a migration PR to `develop`. This prevents partial/failed migrations from corrupting the dev database mid-sprint.

**Implementation in `render.dev.yaml`:** set `branch: develop` on all services. The migrations worker will have `autoDeploy: false`.

---

## 7. Monthly Cost Estimate

Render pricing (starter plan = $7/service/month; static = free; basic PostgreSQL = $7/month):

### Option A: Full Parity with Prod (all services on starter plan)

| Resource | Count | $/unit | $/month |
|---|---|---|---|
| Static web (`-ui-dev`) | 1 | $0 | $0 |
| Node starter web services | 9 | $7 | $63 |
| Worker starter (`-db-migrations-dev`) | 1 | $7 | $7 |
| PostgreSQL `basic-256mb` | 1 | $7 | $7 |
| R2 dev bucket | 1 | $0 (free tier) | $0 |
| **Total** | | | **$77/month** |

### Option B: Cost-Optimized (free instances + paid DB)

| Resource | Count | $/unit | $/month |
|---|---|---|---|
| Static web (`-ui-dev`) | 1 | $0 | $0 |
| Node **free** web services | 9 | $0 | $0 |
| Worker **free** (`-db-migrations-dev`) | 1 | $0 | $0 |
| PostgreSQL `basic-256mb` | 1 | $7 | $7 |
| R2 dev bucket | 1 | $0 | $0 |
| **Total** | | | **$7/month** |

> ⚠️ **Free instance caveat:** Render free instances spin down after 15 minutes of inactivity. The first request after idle takes 30–60 seconds to respond. For a microservices gateway architecture, this means the first API call after inactivity could time out while 9 services simultaneously cold-start. This is disruptive to active development sessions.

### ✅ Recommendation: Option B with selective upgrades

Start with Option B (free instances). Upgrade to starter plan only the two services hit most often during daily development:
- `fleetneuron-logistics-gateway-dev` (all traffic routes through here)
- `fleetneuron-auth-users-service-dev` (every request requires auth)

| Resource | Count | $/unit | $/month |
|---|---|---|---|
| Static web | 1 | $0 | $0 |
| Node starter (gateway + auth) | 2 | $7 | $14 |
| Node free (7 remaining services) | 7 | $0 | $0 |
| Worker free (migrations) | 1 | $0 | $0 |
| PostgreSQL `basic-256mb` | 1 | $7 | $7 |
| R2 dev bucket | 1 | $0 | $0 |
| **Total** | | | **$21/month** |

This eliminates the most painful cold-starts (gateway and auth never go idle) while keeping remaining services free. Upgrade any specific service to starter as needed during active sprint work.

---

## 8. Checklist: All Render Services to Create (FN-111 through FN-114)

### Render Project
- [ ] Create new Render project: **"FleetNeuron Dev"**
- [ ] Add team members with appropriate roles

### Services — created via `render.dev.yaml` (FN-111)
- [ ] `fleetneuron-logistics-ui-dev` — static, branch: `develop`
- [ ] `fleetneuron-logistics-gateway-dev` — node starter, branch: `develop`, auto-deploy: on
- [ ] `fleetneuron-reporting-service-dev` — node free, branch: `develop`, auto-deploy: on
- [ ] `fleetneuron-integrations-service-dev` — node free, branch: `develop`, auto-deploy: on
- [ ] `fleetneuron-auth-users-service-dev` — node starter, branch: `develop`, auto-deploy: on
- [ ] `fleetneuron-drivers-compliance-service-dev` — node free, branch: `develop`, auto-deploy: on
- [ ] `fleetneuron-vehicles-maintenance-service-dev` — node free, branch: `develop`, auto-deploy: on
- [ ] `fleetneuron-logistics-service-dev` — node free, branch: `develop`, auto-deploy: on
- [ ] `fleetneuron-inventory-service-dev` — node free, branch: `develop`, auto-deploy: on
- [ ] `fleetneuron-ai-service-dev` — node free, branch: `develop`, auto-deploy: on
- [ ] `fleetneuron-db-migrations-dev` — worker free, branch: `develop`, **auto-deploy: off**

### Database (FN-112)
- [ ] Create `safetyapp-db-dev` — `basic-256mb`, db name: `goodmen_logistics_dev`
- [ ] Run initial seed after first migration deploy

### R2 Storage (FN-112)
- [ ] Create `fleetneuron-dev` bucket in Cloudflare R2
- [ ] Verify existing R2 API token has write access to new bucket (or generate a scoped token)

### Secrets (FN-113)
- [ ] Generate new `JWT_SECRET` for dev (never reuse prod value)
- [ ] Create separate `OPENAI_API_KEY` in OpenAI dashboard with $20/month spend cap
- [ ] Obtain Stripe test mode keys (`sk_test_...`, webhook secret)
- [ ] Set `NODE_ENV=development` on all dev services
- [ ] Set `CORS_ORIGIN` to `https://dev.fleetneuron.ai` (dev — prod is `https://fleetneuron.ai`)
- [ ] Update all internal `*_SERVICE_URL` env vars on gateway to point to `-dev` service URLs

### Gateway URL Wiring (update in `render.dev.yaml`)
All URLs that prod gateway uses must point to dev counterparts:
- [ ] `REPORTING_SERVICE_URL` → `https://fleetneuron-reporting-service-dev.onrender.com`
- [ ] `INTEGRATIONS_SERVICE_URL` → `https://fleetneuron-integrations-service-dev.onrender.com`
- [ ] `AUTH_USERS_SERVICE_URL` → `https://fleetneuron-auth-users-service-dev.onrender.com`
- [ ] `DRIVERS_COMPLIANCE_SERVICE_URL` → `https://fleetneuron-drivers-compliance-service-dev.onrender.com`
- [ ] `VEHICLES_MAINTENANCE_SERVICE_URL` → `https://fleetneuron-vehicles-maintenance-service-dev.onrender.com`
- [ ] `LOGISTICS_SERVICE_URL` → `https://fleetneuron-logistics-service-dev.onrender.com`
- [ ] `INVENTORY_SERVICE_URL` → `https://fleetneuron-inventory-service-dev.onrender.com`
- [ ] `AI_SERVICE_URL` → `https://fleetneuron-ai-service-dev.onrender.com`

### Angular (FN-114)
- [ ] Add `environment.development.ts` pointing to `https://fleetneuron-logistics-gateway-dev.onrender.com`
- [ ] Confirm `ng build` uses `--configuration development` for dev deploys

---

## 9. Blocked Tickets — Now Unblocked

| Ticket | Work | Depends On |
|---|---|---|
| FN-111 | Create `render.dev.yaml` | §2 naming, §6 auto-deploy |
| FN-112 | Provision dev DB + R2 bucket | §3 DB plan, §4 R2 decision |
| FN-113 | Configure all dev secrets in Render dashboard | §5 secrets policy |
| FN-114 | Angular `environment.development.ts` + dev API URL | §2 naming, FN-111 |

---

## 10. Open Questions (not blocking)

1. **Port isolation:** Dev services can reuse the same port numbers (10002–10010) since each is its own isolated Render service. No change needed.
2. **Seed data:** Decide whether to ship a `seed.js` script with realistic anonymized data for the dev DB, or start empty. Recommend a minimal seed (1 tenant, 2 operating entities, 3 drivers, 5 loads) to enable MC-switcher testing from day one.
3. **Branch protection:** Consider requiring the `develop` branch to pass CI (lint + build) before Render auto-deploys. Prevents broken builds from polluting the shared dev environment.
4. **Log retention:** Render free instances have 7-day log retention. Acceptable for dev.
