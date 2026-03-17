# MONITORING.md — FleetNeuron Monitoring & Observability Guide

_Last updated: 2026-03-16_

This guide defines SLO targets, alert thresholds, and incident response for FleetNeuron backend operations.

## Architecture Scope (Monitored Services)

Based on Render deployment and gateway routing, monitor these 9 runtime services:

1. `fleetneuron-logistics-gateway` (API gateway)
2. `fleetneuron-auth-users-service`
3. `fleetneuron-reporting-service`
4. `fleetneuron-integrations-service`
5. `fleetneuron-drivers-compliance-service`
6. `fleetneuron-vehicles-maintenance-service`
7. `fleetneuron-logistics-service`
8. `fleetneuron-inventory-service`
9. `fleetneuron-ai-service`

### Gateway traffic flow (critical)

Gateway is the single ingress for backend APIs. It proxies route groups to microservices:
- `/api/auth`, `/api/users`, `/api/roles`, `/api/permissions` → auth-users-service
- `/api/dashboard`, `/api/reports`, `/api/audit` → reporting-service
- `/api/scan-bridge` → integrations-service
- `/api/drivers`, `/api/dqf`, `/api/hos`, `/api/drug-alcohol`, `/api/safety`, onboarding/public roadside paths → drivers-compliance-service
- `/api/vehicles`, `/api/maintenance`, `/api/equipment`, `/api/work-orders`, `/api/parts` → vehicles-maintenance-service
- `/api/loads`, `/api/fuel`, `/api/tolls`, `/api/lease-financing`, `/api/ifta`, `/api/invoices`, `/api/settlements`, etc. → logistics-service
- `/api/inventory`, `/api/adjustments`, `/api/cycle-counts`, `/api/receiving`, `/api/barcodes`, `/api/customers` → inventory-service
- `/api/ai` → ai-service

---

## Service Level Objectives (SLOs)

| Service | Uptime Target | Max Response Time | Max Error Rate |
|---|---:|---:|---:|
| API Gateway | 99.9% | 500ms p95 | 0.1% |
| Auth Service | 99.99% | 200ms p95 | 0.01% |
| Reporting Service | 99.9% | 700ms p95 | 0.1% |
| Integrations Service | 99.9% | 700ms p95 | 0.1% |
| Drivers Compliance Service | 99.9% | 800ms p95 | 0.1% |
| Vehicles Maintenance Service | 99.9% | 800ms p95 | 0.1% |
| Logistics Service | 99.9% | 900ms p95 | 0.1% |
| Inventory Service | 99.9% | 800ms p95 | 0.1% |
| AI Service | 99.5% | 2000ms p95 | 1.0% |

Notes:
- AI service has intentionally looser latency/error SLO due to external provider dependency.
- Uptime and latency should be tracked per service health endpoint and key business endpoints.

---

## Alerting Thresholds

Page on-call when any of the below is true:

1. **Error rate > 1% for 5 minutes**
2. **Uptime drops below 99.9%** (service unavailable / failing health checks)
3. **Response time > 2s p99** for 5 minutes

### Recommended monitoring stack

- **Primary:** Render native alerts (service health, deploy failures, runtime failures)
- **Secondary:** UptimeRobot free tier (external synthetic uptime checks)

### Minimum checks to configure

- Gateway: `/health`
- Gateway proxied logistics checks: `/api/health`, `/api/health/db`
- Each microservice: `/health`
- Business synthetic checks:
  - Auth login endpoint health
  - One read endpoint in logistics/inventory

---

## On-Call Runbook (Top 5 Incidents)

### 1) Gateway is down

Symptoms:
- Global API outage
- 502/503 at frontend
- `/health` failing

Actions:
1. Confirm gateway Render service status and latest deploy logs.
2. Validate required gateway env vars (`*_SERVICE_URL`, `CORS_ORIGIN`, `PORT`).
3. Check if downstream service DNS/URL changed.
4. Restart/redeploy gateway service.
5. Verify recovery via `/health` and one proxied endpoint per critical domain (`/api/auth/me`, `/api/health`, `/api/inventory/...`).

Escalate if:
- Gateway boot fails repeatedly due to missing envs or dependency outage.

---

### 2) Database connection pool exhausted

Symptoms:
- Rising latency/timeouts across DB-backed services
- Errors in service logs related to pool/connection acquisition

Actions:
1. Identify affected services (usually logistics/auth/drivers/inventory/reporting).
2. Check recent traffic spike, long-running queries, or deploy-related regression.
3. Verify DB health and active connections on Render Postgres.
4. Temporarily restart worst-affected service(s) to clear stuck pools.
5. Roll forward with query/index fix or roll back recent deploy if regression introduced.

Preventive controls:
- Query performance review for slow endpoints.
- Connection pool tuning by service.

---

### 3) Auth service returning 401s broadly

Symptoms:
- Sudden authentication failures across users
- Token validation/login anomalies

Actions:
1. Check auth-users-service health and logs.
2. Verify `JWT_SECRET` consistency across services that validate tokens.
3. Confirm no accidental secret rotation mismatch.
4. If secret leak is suspected:
   - Rotate `JWT_SECRET` immediately in secret store
   - Redeploy auth + dependent validating services
   - Force session re-authentication
5. Validate `/api/auth/login` and protected endpoint (`/api/auth/me`).

---

### 4) AI service failing

Symptoms:
- `/api/ai` errors/timeouts
- OpenAI-related failures in logs

Actions:
1. Check `fleetneuron-ai-service` health and deploy status.
2. Validate `OPENAI_API_KEY` presence and provider-side status/quota.
3. Restart/redeploy AI service.
4. Activate fallback mode in application behavior:
   - Skip AI-dependent enhancement steps
   - Allow manual data entry or non-AI parser path
5. Communicate degraded AI mode to support/ops until restored.

---

### 5) Migration failed in production

Symptoms:
- Deploy blocked in predeploy step
- Schema mismatch errors at runtime

Actions:
1. Stop further rollout to dependent services.
2. Inspect migration logs from:
   - `fleetneuron-db-migrations` worker
   - `fleetneuron-logistics-service` preDeployCommand output
3. If safe, rollback migration batch (`knex migrate:rollback`) and redeploy previous stable app version.
4. If rollback is risky, hot-fix forward with corrected migration and controlled redeploy.
5. Verify schema + app compatibility before re-enabling normal deploy flow.

---

## Rate Limiting Upgrade Note

Current state:
- Public onboarding currently uses a simple in-memory, per-process limiter.
- This is not sufficient for high-traffic or horizontally scaled production workloads.

Required upgrade:
- Replace in-memory limiter with a **Redis-backed distributed rate limiter**.

Recommended approach:
1. Add Redis (managed) for shared counter state.
2. Implement centralized middleware (gateway and/or service edge) with:
   - key strategy (IP + route + optional tenant/user)
   - sliding window or token bucket algorithm
   - explicit `429` response contract
3. Add observability metrics:
   - requests limited count
   - top limited routes
   - key cardinality and burst patterns
4. Roll out in monitor mode first, then enforce mode.

---

## Operational Checklist

- [ ] Render native alerts configured for all 9 services
- [ ] UptimeRobot checks configured for gateway and critical routes
- [ ] SLO dashboard established (uptime, p95, error rate)
- [ ] On-call rotation and escalation contacts documented
- [ ] Post-incident review template linked in team docs
