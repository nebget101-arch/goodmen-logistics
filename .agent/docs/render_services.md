# Render services — operational reference

Authoritative list of Render services and third-party provider wiring that
coding agents should consult when writing "Deployment Handoff" sections.

## Backend services (Render)

| Service name | Role | Source path |
|---|---|---|
| `fleetneuron-logistics-gateway` | Public edge gateway / reverse proxy | `backend/gateway` |
| `fleetneuron-integrations-service` | Webhooks, FMCSA, scan bridge, email inbound | `backend/microservices/integrations-service` |
| `fleetneuron-reporting-service` | Reports, analytics | `backend/microservices/reporting-service` |
| `fleetneuron-auth-users-service` | Auth, users, tenants | `backend/microservices/auth-users-service` |
| `fleetneuron-drivers-compliance-service` | Drivers, HOS, compliance | `backend/microservices/drivers-compliance-service` |
| `fleetneuron-vehicles-maintenance-service` | Vehicles, maintenance | `backend/microservices/vehicles-maintenance-service` |
| `fleetneuron-logistics-service` | Loads, dispatch, settlements | `backend/microservices/logistics-service` |
| `fleetneuron-inventory-service` | Parts, inventory | `backend/microservices/inventory-service` |
| `fleetneuron-ai-service` | Claude integrations, AI extraction | `backend/microservices/ai-service` |
| `fleetneuron-db-migrations` | Knex migration runner | `backend/packages/goodmen-database` |
| `fleetneuron-logistics-ui` | Angular frontend | `frontend` |

## Third-party providers

### Inbound email — SendGrid Inbound Parse (FN-758 / FN-729)

| Aspect | Value |
|---|---|
| Provider | SendGrid Inbound Parse |
| Receiving domain | `inbound.fleetneuron.ai` |
| MX record | `inbound.fleetneuron.ai` → `mx.sendgrid.net` priority `10` |
| DKIM records (3 CNAMEs, all DNS-only on Cloudflare) | `em<auto>.inbound.fleetneuron.ai` → SendGrid wl-host; `s1._domainkey.inbound.fleetneuron.ai` → `s1.domainkey.<sendgrid-user>.wl<N>.sendgrid.net`; `s2._domainkey.inbound.fleetneuron.ai` → `s2.domainkey.<sendgrid-user>.wl<N>.sendgrid.net` |
| SPF record | `fleetneuron.ai` TXT `v=spf1 include:sendgrid.net ~all` |
| Webhook destination URL (SendGrid side, dev) | `https://fleetneuron-logistics-gateway-dev.onrender.com/api/webhooks/email-inbound?secret=<INBOUND_EMAIL_WEBHOOK_SECRET>` |
| Webhook destination URL (SendGrid side, prod) | `https://fleetneuron-logistics-gateway.onrender.com/api/webhooks/email-inbound?secret=<INBOUND_EMAIL_WEBHOOK_SECRET>` |
| Webhook receiver (code) | `POST /api/webhooks/email-inbound` on `fleetneuron-logistics-gateway[-dev]` → `fleetneuron-integrations-service[-dev]` |
| Webhook secret delivery (either works) | `?secret=<value>` query param **or** `x-webhook-secret: <value>` header — see `verifyWebhookSecret()` in `inbound-email-helpers.js` |
| SendGrid options | "Check incoming emails for spam" ✅; "POST raw, full MIME message" ❌ |
| DNS host | Cloudflare (zone `fleetneuron.ai`) |
| Tenant addressing scheme | `loads-<tenant-slug>@inbound.fleetneuron.ai` (resolved in FN-759 `tenants.inbound_email_address`) |

**Last verified (FN-781, 2026-04-19 — dev):**

- `dig MX inbound.fleetneuron.ai +short` → `10 mx.sendgrid.net.` ✅
- `POST https://fleetneuron-logistics-gateway-dev.onrender.com/api/webhooks/email-inbound` with no secret → `401 {"error":"Unauthorized"}` ✅ (secret enforced, gateway→service route reachable)
- `POST https://fleetneuron-integrations-service-dev.onrender.com/api/webhooks/email-inbound` direct, no secret → `401 {"error":"Unauthorized"}` ✅ (service publicly reachable)
- `POST ...?secret=bogus` → `401` ✅ (wrong secret rejected)
- `GET https://fleetneuron-logistics-gateway-dev.onrender.com/health` → `200 {"status":"ok", integrations: fleetneuron-integrations-service-dev.onrender.com}` ✅
- Not verifiable from CLI (dashboard-gated): SendGrid Inbound Parse host/destination URL value, SendGrid `?secret=` value vs. Render env var `INBOUND_EMAIL_WEBHOOK_SECRET` on `fleetneuron-integrations-service-dev`, SendGrid Activity log, Render live logs during a test send.

**Env vars required on `fleetneuron-integrations-service`:**
- `INBOUND_EMAIL_WEBHOOK_SECRET` — shared secret; must match the `?secret=` value in the SendGrid destination URL. When unset, the webhook accepts unsigned requests (dev fallback only). Store value in Render env vars — **never** in this file or in the repo.
- `INBOUND_EMAIL_MAX_MB` — optional; per-attachment upload cap in MB. Defaults to `25`.

**Rotating the secret:**
1. `openssl rand -hex 32` — generate new value.
2. SendGrid → Settings → Inbound Parse → Edit Host & URL → update `?secret=` in the Destination URL.
3. Render → `fleetneuron-integrations-service` → Environment → update `INBOUND_EMAIL_WEBHOOK_SECRET` → Save → redeploy.
4. Delete any screenshots/transcripts that captured the old value.

**Smoke test runbook:**
1. Ensure at least one tenant row has `inbound_email_address = 'loads-<slug>@inbound.fleetneuron.ai'` (FN-759 migration applied).
2. From any mailbox, send an email with a rate-con PDF attachment to that address.
3. Within ~15s, verify:
   - SendGrid → Inbound Parse → Activity: 200 OK for the POST.
   - Render logs for `fleetneuron-integrations-service`: `processInboundEmail` entry.
   - Postgres `inbound_emails`: new row with `processing_status='ok'`.
   - Postgres `loads`: new DRAFT row with `source='email'` (once `loads.source` column exists).

## Related tickets

| Jira | Scope |
|---|---|
| FN-729 | Parent story — email-to-load feature |
| FN-758 | This subtask — SendGrid provider + DNS provisioning |
| FN-759 | Schema (`tenants.inbound_email_address`, `inbound_emails` log table) |
| FN-760 | Webhook handler + AI pipeline |
| FN-761 | Sender allowlist + rate limit + virus scan |
| FN-762 | Settings UI + loads list email badge |
| FN-763 | E2E QA |
