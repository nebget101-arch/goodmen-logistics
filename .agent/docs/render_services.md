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
| `fleetneuron-telematics-partition-cron` | Daily `vehicle_position_pings` partition maintenance (FN-1662/FN-1660) | `backend/packages/goodmen-database` (`scripts/maintain_telematics_partitions.js`) |
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
| Webhook destination URL (SendGrid side) | `https://fleetneuron-logistics-gateway.onrender.com/api/webhooks/email-inbound?secret=<INBOUND_EMAIL_WEBHOOK_SECRET>` |
| Webhook receiver (code) | `POST /api/webhooks/email-inbound` on `fleetneuron-logistics-gateway` → `fleetneuron-integrations-service` |
| SendGrid options | "Check incoming emails for spam" ✅; "POST raw, full MIME message" ❌ |
| DNS host | Cloudflare (zone `fleetneuron.ai`) |
| Tenant addressing scheme | `loads-<tenant-slug>@inbound.fleetneuron.ai` (resolved in FN-759 `tenants.inbound_email_address`) |

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

### Telematics ingestion — Samsara + Motive (FN-1653)

Provider-agnostic vehicle-position ingestion. Webhook ingress + polling-fallback cron
both run on `fleetneuron-integrations-service` (the backend agent extended the existing
integrations-service rather than standing up a separate `telematics-ingest-service` —
the webhook mirrors the SendGrid inbound-email pattern and reuses its proxy + DB wiring).

| Aspect | Value |
|---|---|
| Providers | Samsara, Motive |
| Webhook receiver (code) | `POST /api/webhooks/telematics/:provider` on `fleetneuron-logistics-gateway` → `fleetneuron-integrations-service` |
| Webhook destination URL (provider side) | `https://fleetneuron-logistics-gateway.onrender.com/api/webhooks/telematics/<provider>?secret=<TELEMATICS_WEBHOOK_SECRET>` (dev: `https://fleetneuron-logistics-gateway-dev.onrender.com/...`) |
| `<provider>` path values | `samsara`, `motive` |
| Verification | Two layers: (1) `?secret=` query param matched timing-safe against the generic `TELEMATICS_WEBHOOK_SECRET`; (2) provider HMAC signature header verified by the adapter's `verifyWebhookSignature` using the per-provider `TELEMATICS_WEBHOOK_SECRET_SAMSARA` / `TELEMATICS_WEBHOOK_SECRET_MOTIVE`. |
| Polling fallback | In-process scheduler on integrations-service (`TELEMATICS_POLL_INTERVAL_MINUTES`, default off → set to `10`) pulls last position via provider REST when a device's `last_seen_at` is stale; authenticates with the provider API token. `POST /api/telematics/poll` is the manual/cron-trigger alternative (not exposed on the public gateway). |
| Persistence | Normalized rows → Postgres `vehicle_position_pings` (FN-1660 schema), daily range-partitioned by `ts` |
| Partition maintenance | Render `cron` service `fleetneuron-telematics-partition-cron` (+ `-dev`), daily `30 7 * * *`, runs `node scripts/maintain_telematics_partitions.js` → `manage_vehicle_position_pings_partitions()` (pre-creates upcoming day-partitions, drops past 30-day retention). pg_cron is unavailable on Render. |

**Env vars required on `fleetneuron-integrations-service`** (secrets declared `sync: false` in
`render.yaml` / `render-dev.yaml` — values set in the Render dashboard, **never** committed):
- `TELEMATICS_SAMSARA_API_TOKEN` — Samsara REST API token (polling fallback).
- `TELEMATICS_MOTIVE_API_TOKEN` — Motive REST API token (polling fallback).
- `TELEMATICS_WEBHOOK_SECRET` — generic shared secret; must match the `?secret=` value in **every** provider webhook destination URL.
- `TELEMATICS_WEBHOOK_SECRET_SAMSARA` — Samsara HMAC signing secret (verifies the `X-Samsara-Signature` header).
- `TELEMATICS_WEBHOOK_SECRET_MOTIVE` — Motive HMAC signing secret (verifies the `X-Motive-Signature` header).
- `TELEMATICS_POLL_INTERVAL_MINUTES` — non-secret (`value: 10` in the Blueprint); enables the in-process polling scheduler. Optional tuning (defaults fine): `TELEMATICS_POLL_STALE_MINUTES`, `TELEMATICS_POLL_MAX_DEVICES`, `TELEMATICS_SIGNATURE_MAX_AGE_S`, `TELEMATICS_POLL_TIMEOUT_MS`, `TELEMATICS_{SAMSARA,MOTIVE}_API_BASE`.

**Rotating the `?secret=` gate (`TELEMATICS_WEBHOOK_SECRET`):**
1. `openssl rand -hex 32` — generate new value.
2. Provider dashboards (Samsara **and** Motive) → Webhooks → update the `?secret=` in each destination URL.
3. Render → `fleetneuron-integrations-service` (and `-dev`) → Environment → update `TELEMATICS_WEBHOOK_SECRET` → Save → redeploy.
4. Delete any screenshots/transcripts that captured the old value.

> The per-provider HMAC secrets (`TELEMATICS_WEBHOOK_SECRET_SAMSARA` / `_MOTIVE`) rotate independently: update the signing secret in the provider dashboard and the matching Render env var.

**Smoke test runbook:**
1. Confirm the `TELEMATICS_*` env vars are set on the target environment (dev first).
2. Confirm `telematics_providers` is seeded (`samsara`, `motive`) and a `telematics_devices` row is paired to a vehicle (FN-1660).
3. POST a recorded provider webhook fixture (FN-1663) to `https://<gateway>/api/webhooks/telematics/samsara?secret=<TELEMATICS_WEBHOOK_SECRET>` with a valid provider signature header.
4. Within ~15s, verify:
   - Gateway logs: proxy hit for `/api/webhooks/telematics/samsara`.
   - `fleetneuron-integrations-service` logs: webhook accepted (secret + signature OK).
   - Postgres `vehicle_position_pings`: new row with the expected `vehicle_id`, `ts`, `lat`, `lng`.
5. Negative check: same POST with a bad `?secret=` or tampered signature → `401`/`403`, no row inserted.

**Related tickets (telematics):** FN-1653 (story) · FN-1660 (schema) · FN-1661 (adapters + webhook + polling) · FN-1662 (this — env vars + gateway route) · FN-1663 (contract tests + fixtures).

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
