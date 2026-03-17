# FleetNeuron Security Posture

_Last updated: 2026-03-17_

This document defines the current security posture of FleetNeuronAPP, including what is implemented now, what is partially implemented, and what remains as security debt.

## Scope and Architecture Context

FleetNeuronAPP is a multi-tenant platform with:
- Angular frontend
- API gateway + Node.js microservices
- Shared middleware for authentication, tenant scoping, RBAC, and plan enforcement
- PostgreSQL as system of record

Security controls are enforced primarily at API boundaries and middleware layers.

## 1) Authentication Model

### Current implementation

- Authentication is JWT-based for authenticated API routes.
- `POST /api/auth/login` issues a signed bearer token (currently `expiresIn: "8h"`).
- Auth middleware validates bearer tokens and resolves `req.user` from token claims.
- In non-production mode only, auth middleware allows a mock user fallback to support local developer workflows.

### Token semantics

- Primary claims in use: `id`, `role`, `username` (plus optional `driver_id`).
- Token verification uses `JWT_SECRET`.
- Invalid/missing token returns `401` in production.

### Session/refresh strategy (current vs target)

- **Current state:** Access-token-only model (no dedicated refresh-token flow in the shared auth route).
- **Target hardening:** Add refresh token rotation, token revocation support, and explicit logout/session invalidation semantics.

### Required production controls

- `JWT_SECRET` must be high-entropy and environment-managed (never committed).
- Short-lived access tokens are preferred for higher-risk roles.
- Standardize clock-skew handling and token issuer/audience validation.

## 2) Authorization Model

FleetNeuron uses layered authorization:

1. **Authentication** (`auth-middleware`) establishes identity.
2. **Tenant & operating entity scoping** (`tenant-context-middleware`) constrains data boundaries.
3. **RBAC permissions** (`rbac-middleware`) enforce action-level access.
4. **Plan entitlement checks** (`plan-access-middleware`) enforce subscription feature access.

### RBAC source of truth

- Authoritative RBAC design and role/permission guidance: [docs/RBAC_SETUP.md](docs/RBAC_SETUP.md).
- Legacy context (archived): [docs/RBAC.md](docs/RBAC.md).

### Notable enforcement behavior

- Super-admin/platform-admin paths can bypass normal tenant-level permission restrictions where intended.
- Location/operating-entity checks prevent cross-entity reads/writes when properly wired on routes.
- Plan denial events are audit-logged (`PLAN_ACCESS_DENIED`) when audit table columns are available.

### Authorization risk notes

- Route-by-route middleware coverage must remain complete; missing middleware on a route can become an authorization bypass.
- Legacy role compatibility paths should be reduced over time in favor of fully normalized RBAC.

## 3) Threat Model (Top 5)

### 1. Broken access control / tenant boundary bypass
**Risk:** Cross-tenant or cross-operating-entity data access.

**Mitigations in place:**
- Tenant context middleware resolves tenant + allowed operating entities.
- RBAC permission checks and optional location checks.
- Plan access middleware blocks unauthorized feature paths.

**Residual risk:** Inconsistent middleware application across legacy routes.

### 2. Credential/token compromise
**Risk:** Stolen JWT grants unauthorized access.

**Mitigations in place:**
- JWT signature verification and expiry.
- Environment-managed secret support.

**Residual risk:** No refresh rotation/revocation model in current shared auth path.

### 3. Abuse/DoS on public endpoints
**Risk:** Brute-force or request flooding of public onboarding/trial flows.

**Mitigations in place:**
- Public onboarding has a basic in-process request throttle.

**Residual risk:** In-memory per-process limiter is not sufficient for distributed production traffic.

### 4. Sensitive data exposure (PII/compliance records)
**Risk:** Driver identity/compliance data leakage via APIs, logs, exports, or mis-scoped queries.

**Mitigations in place:**
- Tenant/entity scoping model.
- Role-based restrictions for protected domains.
- Audit logging for selected security-relevant events.

**Residual risk:** Need stronger log redaction standards and formal data classification enforcement.

### 5. Misconfiguration and secret leakage
**Risk:** Weak defaults, broad CORS, or committed secrets.

**Mitigations in place:**
- Environment variable driven configuration.
- Gateway-level CORS policy with configurable origin.

**Residual risk:** Requires strict production hardening policy and automated config validation.

## 4) API Security Controls

### Implemented

- JWT auth on protected routes.
- RBAC + tenant/operating-entity middleware stack available in shared layer.
- Plan-gate middleware with denial auditing.
- CORS configured in API gateway with configurable allowed origin and credential support.
- Parameterized database access patterns are used in key codepaths.

### Partial / needs strengthening

- Rate limiting is not yet standardized platform-wide.
  - Public onboarding currently uses a simple per-process `Map` throttle.
  - Production target should use Redis-backed distributed limiting.
- Input validation is not uniformly centralized across all route handlers.
- Security headers and TLS enforcement policy should be explicitly standardized at gateway/edge.

### HTTPS and transport

- Production deployments must terminate TLS at ingress/load balancer and enforce HTTPS-only client traffic.
- Internal service-to-service trust boundaries should be documented and hardened per environment.

## 5) Sensitive Data Handling

### Sensitive data categories observed in platform domain

- Driver personal data (name, email, phone, date of birth)
- CDL/license identifiers and expiry data
- Compliance/medical/drug-alcohol related records and documents
- Employment onboarding packet data and signatures
- Financial and settlement data

### Data locations

- PostgreSQL tables (tenant-scoped business records)
- Document storage flows (driver onboarding and compliance docs)
- API responses and generated exports/reports

### Protection expectations

- Enforce least-privilege by role + tenant + operating entity.
- Avoid logging raw PII/secrets in application logs.
- Ensure encrypted transport for all client/API communications.
- Use managed secret stores for production credentials/API keys.
- Retention/deletion policy should be formalized and audited.

## 6) Known Security TODOs (Open)

1. Replace in-memory public endpoint throttle with Redis-backed distributed rate limiter.
2. Implement refresh-token flow with rotation and revocation.
3. Add MFA support for privileged/admin personas.
4. Standardize request validation/sanitization framework across all APIs.
5. Establish and enforce sensitive-log redaction policy.
6. Add automated security checks in CI (dependency audit + secret scanning + basic SAST).
7. Define formal key/secret rotation runbook and cadence.
8. Complete route-level authorization coverage review and gap remediation.
9. Publish tenant-isolation test suite and recurring security regression checks.
10. Add incident-response tabletop exercises and post-incident review template.

## 7) Incident Response Runbook (Operational)

### Severity levels

- **SEV-1:** Active breach/data exfiltration or system-wide auth failure.
- **SEV-2:** Confirmed vulnerability with active exploitation risk.
- **SEV-3:** Security defect without confirmed exploitation.

### Immediate response steps

1. **Detect & triage**
   - Confirm signal source (alerts, logs, support reports).
   - Classify severity and impacted tenants/surfaces.
2. **Contain**
   - Revoke/rotate affected credentials or API keys.
   - Disable compromised accounts/tokens.
   - Restrict vulnerable endpoints/features if needed.
3. **Eradicate**
   - Patch code/configuration.
   - Remove malicious artifacts and validate integrity.
4. **Recover**
   - Restore services safely.
   - Monitor for recurrence and abuse patterns.
5. **Communicate**
   - Notify internal stakeholders.
   - Prepare tenant/customer communication when required.
6. **Post-incident review**
   - Document root cause, blast radius, timeline, and corrective actions.
   - Convert findings into tracked engineering tasks with owners/dates.

### Evidence handling

- Preserve relevant logs, request traces, and database audit records.
- Capture exact timeline, indicators of compromise, and remediation actions.
- Maintain access controls on incident artifacts.

## 8) Security Governance and Ownership

- Security is a cross-functional responsibility across backend, frontend, and DevOps.
- Any new endpoint/feature must include:
  - explicit authn/authz design,
  - tenant/entity scoping requirements,
  - data classification impact,
  - logging/redaction requirements,
  - abuse-rate controls.

## 9) Document Status and Change Control

This security document is authoritative for current-state posture reporting. It must be updated when:
- auth/authz middleware behavior changes,
- sensitive data flows change,
- new public endpoints are added,
- incident-response policy is revised.
