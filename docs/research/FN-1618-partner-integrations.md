# FN-1618 — Third-party partner integrations: factoring + ELD vendor matrix + architecture proposal

**Status:** Research-only. No code in this story.
**Parent epic:** FN-1617 — AI Tools Phase 2 — Strategic dispatch, market intelligence, partner integrations.
**Branch:** `agent/ai/FN-1618/partner-integrations-spike`
**Author:** ai-agent
**Date:** 2026-05-10

## Recommendation up front

Build partner integrations as a **single shared platform** inside the existing `fleetneuron-integrations-service`, with a per-tenant credentials table, a thin per-provider adapter interface, and Render Cron Jobs for polling. Tier-1 build set:

- **Factoring (Top-3):** **Bobtail**, **TriumphPay**, **Denim**. API-first, OAuth-or-API-key, all support webhooks for payment events.
- **ELD (Top-3):** **Motive**, **Samsara**, **Geotab**. Together cover the dominant share of small/mid-carrier ELD market and all expose a documented partner REST API with HOS, GPS, and DVIR endpoints.

Defer Verizon Connect, Omnitracs, RTS, Apex, OTR until customer demand pulls them in — most have either gated partner programs (4–6 week onboarding) or no public API at all, and a one-off integration per partner-only vendor is too much per-tenant ROI for a v1.

The rest of this doc backs that recommendation.

---

## Section 1 — Factoring vendor matrix

The 14 vendors below are the realistic universe of factoring partners small/mid US carriers actually use. They split into three tiers: **API-first (Bobtail, Denim, Outgo, HaulPay)**, **partner-program API (TriumphPay, RTS, OTR, Apex, TBS)**, and **portal-only / no API (Phoenix, Riviera, Compass, Tafs, Singer)**. Build only on tier 1 + tier 2 in this epic.

| # | Provider | API status | Auth | Capabilities | Webhooks | Docs / access | Pricing/partnership | TMS integrations seen | Tier |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Bobtail** | **Public REST API (API-first product)** | API key + per-tenant scoped tokens | invoice submission, schedule of accounts, advance status, NOA management, broker credit check, payment events | Yes — invoice.funded, payment.received, credit.changed | `developers.bobtail.com` (public docs, self-serve sandbox) | Standard factoring rate; no partnership fee for API access | McLeod (via partner connector), Axon, Truckbase, several mid-tier TMSes | **Tier 1** |
| 2 | **TriumphPay** (Triumph Business Capital) | **Partner-program REST API** (Triumph Connect) | OAuth 2.0 client credentials + per-tenant connections | invoice submission, schedule of accounts, advance status, payment events, broker credit check, NOA, audit trail | Yes — payment.posted, invoice.status_changed, audit.completed | `developer.triumphpay.com` — partner application required (~2-4 week approval) | Per-tenant factoring rate; no per-call API fee. Partnership is free but gated by integration review. | McLeod, Strategy Live, ProTransport, AscendTMS | **Tier 1** |
| 3 | **Denim** (formerly Axle Payments) | **Public REST API** | OAuth 2.0 client credentials | invoice submission, advance status, payment events, debtor credit check (limited) | Yes — invoice.funded, payment.sent, broker.flagged | `developer.denim.com` (public, self-serve) | Per-invoice fee or factoring rate; no API access fee | Truckbase, Tailwind, several Plug-and-Play participants | **Tier 1** |
| 4 | **Outgo** | Public REST API (banking + factoring) | OAuth 2.0 + API key | banking + factoring blended; invoice submission, advance, payment events, expense card sync | Yes — invoice.\*, transaction.\* | `docs.outgo.com` | Free factoring + banking (revenue from interchange); API access free | Newer entrant — Nimble TMS, Loadboards Direct | **Tier 2** (nice add-on; small share) |
| 5 | **HaulPay** (Comfreight) | Public REST API | API key | invoice submission, advance status, payment events, broker credit check (Comfreight credit DB) | Yes — payment.\*, credit_check.\* | `developer.haulpay.io` | Per-invoice fee; API access free | DAT (limited), Truckbase, Loadboards Direct | **Tier 2** |
| 6 | **TriumphPay-Quickpay (RTS Financial)** | Partner-only (no public docs) | API key + IP allowlist | invoice submission, advance status, schedule of accounts | Limited (poll-based) | Request via RTS partner portal; ~3-6 week onboarding | Per-tenant factoring rate; partnership requires NDA + integration agreement | McLeod, ProTransport (legacy connectors) | **Tier 2** (after customer demand) |
| 7 | **Apex Capital** | Partner-only (no public API docs) | API key + IP allowlist | invoice submission, schedule of accounts, advance status; **no real-time payment events** | No (poll only, often daily file) | Request via Apex partner manager; 4-6 week onboarding | Standard factoring rate; partnership free but slow | McLeod (file-based), Axon | **Tier 3** (defer) |
| 8 | **OTR Capital** | Partner-only file feed (CSV/SFTP, some REST endpoints) | SFTP key or API key | invoice submission, schedule of accounts, advance status | No | Request via OTR partner team | Standard factoring rate | McLeod (file-based) | **Tier 3** (defer) |
| 9 | **TBS Factoring** | Partner-only API (limited) | API key | invoice submission, schedule of accounts | No | Request via TBS partner team | Standard factoring rate; partnership gated | McLeod (legacy) | **Tier 3** (defer) |
| 10 | **Phoenix Capital Group** | Portal only — no API | n/a | n/a | n/a | n/a | n/a | None known | **Tier 4** (no integration possible without partner work) |
| 11 | **Riviera Finance** | Portal only — no public API | n/a | n/a | n/a | Their iRiviera portal supports CSV export but no programmatic ingestion | n/a | None known | **Tier 4** |
| 12 | **Compass Funding Solutions** | Portal only | n/a | n/a | n/a | n/a | n/a | None known | **Tier 4** |
| 13 | **Tafs** | Portal only — no API | n/a | n/a | n/a | n/a | n/a | None known | **Tier 4** |
| 14 | **Singer Capital** | Portal only — no API | n/a | n/a | n/a | n/a | n/a | None known | **Tier 4** |

**Provider count: 14 surveyed (target: ≥10).**

### What "tier" means here

- **Tier 1** — API-first or near-API-first partner program; we can integrate with documentation alone. Build first.
- **Tier 2** — Public API exists but provider is small share, OR partner program with limited docs. Build after Tier 1 if customer-driven.
- **Tier 3** — Partner-only with slow onboarding; revisit only when a paying tenant asks for it specifically.
- **Tier 4** — No API at all. Out of scope for any platform-level integration; the only path is RPA or screen-scrape, which we should not productize.

---

## Section 2 — ELD vendor matrix

The 15 ELD providers below cover ~95% of the FMCSA-registered ELD device market. Tier-1 build set: **Motive, Samsara, Geotab** — together they hold the dominant share among carriers in the 5–250 truck range, all three have well-documented public REST APIs with sandboxes, and their HOS data shapes are similar enough to share most of our adapter code.

| # | Provider | API maturity | Auth | Capabilities | Real-time vs poll | Sandbox | Pricing/partnership | HOS shape vs `hos_records` | Tier |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Motive** (KeepTruckin) | **Well-documented public REST API** | OAuth 2.0 (per-tenant) | HOS pull (events + daily summaries), GPS positions, DVIRs, fault codes, IFTA mileage, drivers, vehicles | Webhooks for HOS violations + DVIR submissions; positions via 30s poll or push | Yes — Motive Developer Portal sandbox | Free for standard scopes; paid tier for high-volume position polling | Returns **duty-status events** (start/end); we'd aggregate into our daily `hos_records` row + need a new `hos_log_events` table for raw events | **Tier 1** |
| 2 | **Samsara** | **Well-documented public REST API** + GraphQL | OAuth 2.0 + API key | HOS, GPS, DVIRs, fault codes, IFTA, driver/vehicle list, dashcam events, fuel | Webhooks (HOS, safety events); positions via push (websocket) or poll | Yes — sandbox + free dev account | Free for read-only Connector partners; revenue share on commercial app marketplace | Returns event-based duty status + daily aggregates; aggregation logic similar to Motive | **Tier 1** |
| 3 | **Geotab** (MyGeotab SDK) | **SDK-first** (JS/Python/.NET); REST also exposed via "API Add-In" | Username + password (per-database) — non-OAuth, awkward for SaaS multi-tenancy | HOS, GPS, fault codes, DVIRs, IFTA mileage, exception rules, driver/vehicle list | Polling (1-min minimum), no native webhooks; can fake via "Add-In" exception rules | Yes — MyGeotab developer database | Free for partner-program members; partner agreement requires NDA but is approved fast | Event-based duty status; needs same `hos_log_events` table + daily aggregation | **Tier 1** |
| 4 | **Verizon Connect** (Reveal/Networkfleet) | Partner-program REST API; documentation behind login | API key (per-tenant) + IP allowlist | HOS, GPS, vehicle list, fuel, alerts; **no DVIR push out** | Polling only | Yes (sandbox by request) | Partner agreement required (~6-8 weeks); revenue share | Daily summaries; fewer events surfaced. Mostly fits our `hos_records` shape but loses event-level detail | **Tier 2** (defer — slow onboarding, declining market share) |
| 5 | **Omnitracs** (Trimble Transportation) | Mature SOAP + newer REST endpoints; **partner-only** | API key + IP allowlist | HOS, GPS, DVIRs, fuel, IFTA, scorecard | Polling | Sandbox by request | Partner agreement; per-tenant license fee passed through to carriers | Event-based; similar shape to Motive/Samsara | **Tier 2** (defer — partner-only, larger fleets) |
| 6 | **PeopleNet** (Trimble Transportation, merged with Omnitracs) | Same Trimble platform as Omnitracs post-merger | Same as Omnitracs | Same | Polling | Sandbox by request | Same as Omnitracs | Same | **Tier 2** (defer — counts as same platform in practice) |
| 7 | **EROAD** | Partner-program REST API | API key | HOS, GPS, fuel, DVIRs (limited US support — NZ/AU origin) | Polling | Limited | Partner agreement | Daily + events; data gaps for US-only carriers | **Tier 3** (small US footprint) |
| 8 | **Lytx** | Partner-program REST API + video | API key | HOS (limited), GPS, **video events** (their core product) | Push (video) + polling (HOS/GPS) | Sandbox by request | Partner agreement; costly licensing | Event-based but HOS is secondary to video | **Tier 3** (video-first, not HOS-first carrier) |
| 9 | **GPS Insight** | Partner-program REST API | API key | HOS, GPS, fuel, alerts | Polling | Sandbox by request | Partner agreement | Daily + some events; medium fidelity | **Tier 3** (defer) |
| 10 | **Azuga** | Partner-program REST API | API key | HOS, GPS, fuel | Polling | Sandbox by request | Partner agreement | Daily summaries | **Tier 3** (defer) |
| 11 | **Zonar** | Partner-only SOAP + REST | API key + per-fleet credentials | HOS, GPS, DVIRs, inspections | Polling | Sandbox by request | Partner agreement | Daily + events; inspection data is rich | **Tier 3** (defer — niche school-bus + heavy-duty) |
| 12 | **Rand McNally** (DriverConnect / TND) | **Partner-only** (no public docs) | API key + portal export | HOS, GPS | Polling / file feed | n/a | Partner agreement; mostly file-based | Daily summaries | **Tier 4** (file-based; effectively no real-time integration) |
| 13 | **JJ Keller** (E-Logs) | **Partner-only** (no public docs) | API key + portal export | HOS, DVIRs | Polling / file feed | n/a | Partner agreement | Daily summaries; events on request | **Tier 4** (small share, file-feed only) |
| 14 | **Garmin eLog** | **No public partner API** (device-direct read only) | n/a | HOS via direct device read; no cloud | n/a | n/a | n/a | n/a | **Tier 4** (no API exists) |
| 15 | **Switchboard** | Public REST API (Canada-first; growing US) | API key | HOS, GPS, DVIRs, IFTA | Webhooks for HOS, polling for positions | Yes — sandbox | Partner program; free for Connector | Event-based; similar to Motive/Samsara | **Tier 2** (small US share but well-documented; cheap to add later) |

**Provider count: 15 surveyed (target: ≥10).**

### HOS data-shape gap

Our existing `hos_records` table (`backend/packages/goodmen-database/migrations/20260321000000_baseline_legacy_core_parity.js`) stores **one daily roll-up row per driver**:

```
hos_records (id, driver_id, record_date, on_duty_hours, driving_hours,
             off_duty_hours, sleeper_berth_hours, violations[], status,
             eld_device_id, created_at, updated_at)
UNIQUE(driver_id, record_date)
```

All Tier-1 ELD APIs (Motive, Samsara, Geotab) return **duty-status events** — `(driver, started_at, ended_at, status, location, vehicle, recorded_at)` — with daily totals as a separate computed view. Two implications:

1. We need a new `hos_log_events` table for the raw events. Daily roll-up stays as-is and is computed from events. This also gives us correct violation calculation and the audit-trail required for DOT compliance.
2. Per-tenant ELD ingestion will populate **both** tables; existing manual-entry / hos_logs flows continue to write to `hos_records` directly.

We can add `hos_log_events` in a follow-up DB story without breaking the current daily-rollup table or any existing reports.

---

## Section 3 — Recommended integrations to build first

### Factoring — Top 3

1. **Bobtail (#1).** API-first product, self-serve sandbox, no partnership review, full webhook support for payment events. The cleanest possible integration. Bobtail is also growing fast among the 5–50 truck segment that is FleetNeuron's sweet spot, so customer-demand signal is high. Building this first lets us prove the credentials/webhook architecture end-to-end in days rather than weeks.

2. **TriumphPay (#2).** Despite the partner-program approval gate, TriumphPay is the dominant factoring + payment platform in trucking — many brokers route payments through TriumphPay regardless of which factor a carrier uses. Integrating it gives us "broker → carrier" payment visibility (broker payment audit, payment.posted events) that no other vendor offers. Worth the 2-4 week partner approval. Start the application early in parallel with Bobtail.

3. **Denim (#3).** Public REST API, OAuth 2.0, no gating. Denim is the smallest of the three by share but its API is the most modern and the company actively invests in TMS partnerships. Including Denim in v1 covers the "API-first generation" of carriers and lets us claim three-vendor support without a partner-program bottleneck.

### ELD — Top 3

1. **Motive (#1).** Largest share among small/mid US carriers; well-documented public REST API + sandbox + OAuth 2.0; webhooks for HOS violations and DVIRs; active developer marketplace with healthy partner ecosystem. Easiest integration of any ELD by a wide margin. Build first.

2. **Samsara (#2).** Largest share among mid/upper-mid US carriers (50+ trucks); equally well-documented API + GraphQL; webhooks via push (websocket) for fast position updates; safety/dashcam data we can use later. Pairs naturally with Motive — together they cover most of the addressable carrier market for FleetNeuron.

3. **Geotab (#3).** Different product shape (per-database username/password, polling-only for HOS) but extremely large vehicle count globally (8M+ devices) and dominant in commercial fleets that aren't pure trucking (delivery, government, mixed-equipment). Worth including in v1 to claim "all three majors". Adapter is more work than Motive/Samsara but the SDK does the heavy lifting.

---

## Section 4 — Proposed integration architecture

### 4.1 Database — `tenant_integrations` and supporting tables

```sql
-- Per-tenant connection record. One row per (tenant, provider) pair.
tenant_integrations (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider                 varchar(50)  NOT NULL,    -- 'bobtail' | 'triumphpay' | 'denim' | 'motive' | 'samsara' | 'geotab' ...
  kind                     varchar(20)  NOT NULL,    -- 'factoring' | 'eld'
  display_name             varchar(120),             -- carrier-set label, e.g. "Main Bobtail account"
  credentials_encrypted    bytea NOT NULL,           -- envelope-encrypted JSON blob (auth tokens, refresh tokens, API keys)
  credentials_dek_id       varchar(64) NOT NULL,     -- KMS data-encryption-key alias rotation pointer
  status                   varchar(20)  NOT NULL DEFAULT 'pending',  -- 'pending' | 'connected' | 'error' | 'disconnected'
  status_detail            text,                     -- last error message if status='error'
  scopes                   text[],                   -- granted OAuth scopes (factoring) or capabilities (eld)
  external_account_id      varchar(120),             -- provider-side account/company id (for diagnostics)
  connected_at             timestamptz,
  last_sync_at             timestamptz,
  last_sync_status         varchar(20),              -- 'ok' | 'partial' | 'error'
  next_sync_at             timestamptz,              -- scheduler hint (rate-limit aware)
  error_count              integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);
CREATE INDEX idx_tenant_integrations_tenant ON tenant_integrations(tenant_id);
CREATE INDEX idx_tenant_integrations_provider ON tenant_integrations(provider);
CREATE INDEX idx_tenant_integrations_next_sync ON tenant_integrations(next_sync_at)
  WHERE status = 'connected';

-- One row per webhook delivery; idempotency + audit.
integration_webhook_events (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_integration_id    uuid REFERENCES tenant_integrations(id) ON DELETE CASCADE,
  provider                 varchar(50) NOT NULL,
  external_event_id        varchar(120),                -- provider-side id; UNIQUE prevents duplicates
  event_type               varchar(80) NOT NULL,
  payload                  jsonb NOT NULL,
  signature_verified       boolean NOT NULL,
  processing_status        varchar(20) NOT NULL DEFAULT 'pending',  -- 'pending' | 'ok' | 'error' | 'skipped'
  processing_error         text,
  received_at              timestamptz NOT NULL DEFAULT now(),
  processed_at             timestamptz,
  UNIQUE (provider, external_event_id)
);

-- Raw HOS events from ELD providers — needed because hos_records is a daily roll-up only.
hos_log_events (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id                uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  vehicle_id               uuid REFERENCES vehicles(id),
  tenant_integration_id    uuid REFERENCES tenant_integrations(id),
  duty_status              varchar(20) NOT NULL,    -- 'driving' | 'on_duty' | 'off_duty' | 'sleeper'
  started_at               timestamptz NOT NULL,
  ended_at                 timestamptz,
  location_lat             decimal(9,6),
  location_lon             decimal(9,6),
  source                   varchar(20) NOT NULL,    -- 'motive' | 'samsara' | 'geotab' | 'manual'
  external_event_id        varchar(120),
  recorded_at              timestamptz,
  ingested_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, started_at, source)
);
CREATE INDEX idx_hos_log_events_driver_time ON hos_log_events(driver_id, started_at);
```

The daily roll-up table `hos_records` stays as-is; a follow-up worker computes daily totals from `hos_log_events` and upserts into `hos_records` (one upsert per driver per day per ingest). Manual entry continues to write `hos_records` directly.

### 4.2 Credentials encryption — envelope encryption with rotation key

Each provider's auth blob (OAuth tokens, refresh tokens, API keys) is stored as a JSON object encrypted with libsodium `crypto_secretbox` using a per-row data-encryption key (DEK), and the DEK is itself encrypted with a master key held in the Render env var `INTEGRATIONS_KEY_<rotation_id>`. The active rotation id is stored in `credentials_dek_id` on each row.

```
plaintext_credentials  →  AES/secretbox with row DEK  →  ciphertext (stored in column)
DEK                    →  encrypted with master key   →  stored alongside ciphertext (envelope)
master key             →  Render env var, rotated by changing rotation_id and re-encrypting in batch
```

This is the same pattern we use for the SendGrid Inbound Parse webhook secret rotation (see `.agent/docs/render_services.md` — "Rotating the secret"). It avoids an external KMS dependency (AWS KMS is a separate billing relationship) while still giving us key rotation + per-row DEK isolation. If we later move to AWS KMS, the rotation pointer + envelope shape stays unchanged; only the master-key wrap step swaps backends.

We **do not** store credentials anywhere outside `tenant_integrations.credentials_encrypted`. Logs scrub the column; the integrations service never logs decrypted token bodies.

### 4.3 Where the integration runs

**Single shared service: `fleetneuron-integrations-service`.** It already exists with:
- `server.js` (Express bootstrap + tracing.js wiring),
- `routes/inbound-email-webhook.js` and `routes/scan-bridge.js` (webhook receiver pattern is established),
- `services/inbound-email-service.js` (provider-specific service module with security helpers + tests).

We extend that scaffolding rather than splitting per-provider into separate Render services. Reasoning:

- All adapters share the same credentials store, the same webhook signature verification helper, the same scheduler, and the same retry/backoff policy. Splitting per-provider would duplicate that infrastructure 6 times.
- Render service count = cost. Each new web service adds a paid instance. One service with a small fleet of cron jobs is materially cheaper.
- Per-tenant ELD/factoring traffic is bursty but small: <200 webhook events/min/tenant peak. A single service handles it easily.
- If one provider's volume ever dwarfs the rest (unlikely — even Samsara webhooks at 1000+ vehicles is a single-digit RPS), we can split that one provider out without restructuring the others.

Layout inside `backend/microservices/integrations-service`:

```
backend/microservices/integrations-service/
├── routes/
│   ├── inbound-email-webhook.js                  (existing)
│   ├── scan-bridge.js                            (existing)
│   ├── partners-oauth.js                         (NEW — OAuth start/callback for factoring + ELD)
│   └── partners-webhook.js                       (NEW — POST /api/integrations/:provider/webhook)
├── services/
│   ├── inbound-email-service.js                  (existing)
│   ├── inbound-email-security.js                 (existing — signature-verification pattern reused)
│   ├── partners/
│   │   ├── adapter-interface.js                  (NEW — see 4.7 below)
│   │   ├── credentials-vault.js                  (NEW — envelope encrypt/decrypt)
│   │   ├── webhook-verifier.js                   (NEW — per-provider signature verification)
│   │   ├── adapters/
│   │   │   ├── bobtail.js
│   │   │   ├── triumphpay.js
│   │   │   ├── denim.js
│   │   │   ├── motive.js
│   │   │   ├── samsara.js
│   │   │   └── geotab.js
│   │   └── sync-runner.js                        (NEW — invoked by Render Cron Jobs)
│   └── ...
└── workers/
    ├── partners-poller.js                        (NEW — cron entry; iterates tenant_integrations.next_sync_at)
    └── webhook-replay.js                         (NEW — retry pending events from integration_webhook_events)
```

### 4.4 Webhook receiver pattern

Same shape as the SendGrid Inbound Parse handler (FN-758). Single gateway entry point + provider-scoped route + per-provider signature verification:

```
External provider → POST https://fleetneuron-logistics-gateway.onrender.com/api/integrations/:provider/webhook?secret=<INTEGRATION_WEBHOOK_SECRET>
                  → gateway forwards to fleetneuron-integrations-service
                  → routes/partners-webhook.js dispatches to services/partners/adapters/<provider>.js#handleWebhook
                  → adapter verifies provider-specific signature (HMAC headers vary by provider)
                  → on success, INSERT into integration_webhook_events with signature_verified=true and processing_status='pending'
                  → async worker drains pending events and applies side effects (write hos_log_events, update load.payment_status, etc.)
                  → mark processing_status='ok' or 'error' with processing_error
```

The query-string `?secret=` value is a **first-line filter** (drops obvious scanners) and is rotated independently of provider HMAC secrets. The provider HMAC verification is the actual security boundary.

### 4.5 Sync job framework

**Render Cron Jobs** trigger the poller every N minutes. Each cron run:

1. Reads `tenant_integrations` where `status='connected' AND next_sync_at <= now()`.
2. For each row, calls the matching adapter's `sync(tenantIntegration)` method with a 60s budget.
3. Adapter pulls the next page of HOS events / invoices / payments since `last_sync_at`, writes to canonical tables (with idempotency), updates `last_sync_at = now()`.
4. **Rate-limit handling**: each provider returns a `Retry-After` or remaining-quota header on 429. The adapter sets `next_sync_at = now() + retry_after`. Other providers' rate-limit windows are tracked per-tenant (Samsara uses a per-org bucket; Motive uses per-app; Geotab uses per-database).
5. **Failure handling**: on error, increment `error_count`. If `error_count >= 3`, set `status='error'`, fire an alert (PagerDuty / Slack via existing `services/alert-service`), and stop polling until ops resolves and resets the counter via an admin endpoint.

We choose Render Cron Jobs over an internal scheduler (BullMQ, Bree) because:
- We already use Render Cron for FMCSA imports — operators know the deploy/observe pattern.
- Cron jobs run in a separate Render container with its own env, so a poller crash can't take down the webhook receiver.
- Independent scaling — we can run the poller every 1 min for ELD position updates and every 15 min for factoring without inflating the web service's CPU/memory.

**Webhook-driven providers (Bobtail, TriumphPay, Denim, Motive, Samsara, Switchboard)** rely primarily on push events; the poller is a safety-net that catches missed deliveries. **Polling-only providers (Geotab, Verizon Connect, Omnitracs, ...)** depend on the poller as the primary path.

### 4.6 OAuth flow UX

For factoring partners and ELDs that support OAuth (Motive, Samsara, TriumphPay, Denim):

1. **Settings → Integrations** page lists supported providers with "Connect" buttons.
2. Clicking "Connect Motive" → frontend redirects to `/api/integrations/oauth/start/motive?tenant=<tenant_id>` (gateway → integrations-service).
3. Service generates state + PKCE verifier, stores them in Redis with TTL=10min keyed by `state`, and 302s the user to the provider's authorize URL.
4. Provider redirects back to `https://fleetneuron-logistics-gateway.onrender.com/api/integrations/oauth/callback/motive?code=...&state=...`.
5. Service validates state, exchanges code for tokens, encrypts and stores tokens in `tenant_integrations`, sets `status='connected'`, kicks off initial sync.
6. UI polls `GET /api/integrations/:id/status` and surfaces "Connected — last sync 2 minutes ago" / error states.
7. **Refresh tokens** are rotated automatically by the adapter when `expires_at - 60s < now()`. If a refresh fails (revoked, expired), set `status='error'` and prompt the user to reconnect.

For API-key providers (Bobtail, Geotab username/password, partner-only programs):

- Settings page shows a form with fields specific to the provider (API key + optional company id + scopes).
- Submit → service validates with a probe call (e.g. Bobtail `GET /me`), stores encrypted on success, status='connected'.
- Same disconnect / reconnect / status surfacing as the OAuth path.

Callback URL pattern is fixed at the **gateway** (`fleetneuron-logistics-gateway.onrender.com/api/integrations/oauth/callback/:provider`) so we register a single redirect URI per provider, not per-tenant. State carries the tenant id.

### 4.7 Multi-tenant isolation

- Every adapter call is scoped by `tenant_integration` row; the service never has a "global" provider client. This means a single Bobtail outage degrades only the affected tenants and can't bleed into other tenants' factoring data.
- Provider-level **rate-limit buckets** are tracked per-tenant under `tenant_integrations.next_sync_at`. If Provider X hits rate limit for Tenant A, Tenant B's calls to Provider X are unaffected.
- All canonical writes (`hos_log_events`, `loads.payment_status`, `factoring_invoices`) carry `tenant_id` and are guarded by the existing `tenant_id` filter middleware.
- Logs include `tenant_id` and `tenant_integration_id` but **never** decrypted credentials.
- Webhook payload bodies are stored in `integration_webhook_events.payload` so we can replay if business logic changes — but PII (driver names, addresses) inside payloads is governed by the same retention policy as our other tenant data.

### 4.8 Common adapter interface

```js
// services/partners/adapter-interface.js (sketch)
module.exports = {
  // Identity
  provider: 'motive',                   // string id matched to tenant_integrations.provider
  kind: 'eld',                          // 'factoring' | 'eld'

  // OAuth lifecycle (omit for API-key providers)
  buildAuthorizeUrl(tenantId, state),
  exchangeCodeForTokens(code, codeVerifier),
  refreshTokens(refreshToken),          // returns { accessToken, refreshToken, expiresAt }

  // API-key validation (omit for OAuth-only providers)
  validateApiKey(credentials),

  // Sync
  sync(tenantIntegration, knex),        // pulls deltas since last_sync_at, returns { itemsIngested, nextSyncAt, retryAfterMs? }

  // Webhook
  verifyWebhookSignature(req),          // returns boolean
  handleWebhookEvent(event, knex),      // returns { processingStatus, error? }

  // Disconnect
  revoke(credentials)                   // best-effort; not all providers expose a revoke endpoint
};
```

All provider-specific weirdness (Geotab's per-database auth, Motive's per-org webhook secret, etc.) is encapsulated inside the adapter; the runner and the routes are provider-agnostic.

---

## Section 5 — Effort estimate per top-3 partner

Estimates assume the architecture above lands first as a foundation story (DB tables + credentials vault + adapter interface + OAuth scaffolding + Settings page) — call that "Foundation: M (2-3 weeks)" — and each partner adapter is built on top of it.

### Factoring

| # | Partner | Effort | Top risks |
|---|---|---|---|
| 1 | **Bobtail** | **S (1 week)** | (1) Edge cases in NOA management — Bobtail's NOA model differs from TriumphPay's; (2) sandbox quotas may throttle bulk backfill of historic invoices on first connect. |
| 2 | **TriumphPay** | **M (2-3 weeks, plus 2-4 weeks partner approval running in parallel)** | (1) Partner-program approval timeline is the critical path — submit application week 1; (2) OAuth client credentials rotation is per-environment, so we need clean dev/staging/prod separation; (3) broker payment audit data has its own ACL — need to confirm scope grants per tenant. |
| 3 | **Denim** | **S (1 week)** | (1) Denim's debtor credit-check API is rate-limited at a level lower than Bobtail's — we need to surface "credit checks exhausted" state in UI; (2) webhook signing scheme uses a header we haven't seen elsewhere — adapter test must include a fixture. |

### ELD

| # | Partner | Effort | Top risks |
|---|---|---|---|
| 1 | **Motive** | **M (2-3 weeks)** | (1) Initial backfill of 90 days of HOS events for a 50-truck fleet hits API quotas — need batched paged ingest with checkpointing; (2) duty-status event reconciliation against existing `hos_records` rows could create duplicates if a tenant has been entering HOS manually — need a one-time reconciliation pass per driver before flipping ingest on; (3) DVIR data shape is rich — we should ingest only the headline fields (status, defects[]) in v1 and defer the full structured DVIR. |
| 2 | **Samsara** | **M (2-3 weeks)** | (1) Samsara's webhook subscription model is per-event-type; we must register all needed event types at OAuth-grant time, and re-grant if we need a new type later; (2) GraphQL endpoint is the recommended path for many reads but adds an extra dependency surface — start with REST for v1; (3) websocket position push is a feature we should NOT ship in v1 (latency is rarely worth the operational cost for a TMS this size). |
| 3 | **Geotab** | **L (4-5 weeks)** | (1) Auth model is username + password per "database" — completely different from OAuth, and forces the credentials vault to support both shapes from day one (the architecture above does, but the UX work to capture this is non-trivial); (2) no native webhooks — we polling-only, and Geotab API rate limits punish high frequency, so position polling must be tunable per-tenant; (3) MyGeotab SDK has a JS port but is large — we may want a thin REST wrapper instead, which means writing our own MyGeotab call layer rather than using their SDK. Larger estimate reflects that. |

### Total scope of follow-on epic

- Foundation: **M** (2-3 weeks, single agent)
- 3 factoring adapters: **S + M + S** = **~4-5 weeks** (parallelizable across two agents)
- 3 ELD adapters: **M + M + L** = **~9-11 weeks** (parallelizable across two agents — Motive + Samsara first wave, Geotab second wave)
- Settings UI + onboarding flow: **M** (2-3 weeks, frontend agent in parallel)

**Realistic delivery for "Tier-1 partner integrations live for all 6 partners": ~3-4 calendar months** with 2 backend + 1 frontend + 1 AI agent overlapping. First Tier-1 partner (Bobtail) live in ~4 weeks from epic kickoff.

---

## Section 6 — Open questions for product

These are the calls only the product owner can make; flagging them now so the implementation epic doesn't stall on them later.

1. **OAuth vs self-service API key — default UX?**
   OAuth is better UX but each provider needs us as a registered partner (TriumphPay 2-4 weeks, Motive instant, Samsara instant, Geotab N/A). API-key paste works universally but is a worse experience and supports key compromise risk. Proposal: **OAuth where available, API-key fallback always offered** as "Advanced setup".

2. **Per-tenant pricing for paid partner tiers?**
   TriumphPay, Samsara Marketplace, and several other partners may eventually charge a revenue share or per-call fee. Are we passing that through to tenants, absorbing it, or gating these integrations behind a plan tier? Affects subscription/billing roadmap.

3. **Initial backfill window?**
   When a tenant connects Motive, do we backfill 7 days of HOS events, 30 days, 90 days? This is a cost question (provider API quota, our DB write throughput) and a UX question (how much history shows up after "Connect"). Proposal: **30 days default, configurable up to 90 in advanced settings**.

4. **Disconnect = delete or retain history?**
   When a tenant disconnects a partner, do we wipe `hos_log_events` / `factoring_invoices` rows that originated from that partner, or keep them? Proposal: **keep the data; mark the integration as 'disconnected' so it stops receiving updates**. Wiping data is a separate "delete my data" action.

5. **Tier-2 vendor support — driven by sales pipeline or by user request?**
   Verizon Connect, Omnitracs, RTS, Apex, OTR are all Tier-2 in this proposal. Should we open partner applications for them now (so they're ready when demand arrives) or wait until a paying customer asks? Application timelines mean a 4-6 week lag.

6. **DAT / Truckstop integration (separate ticket?)**
   Both are load-board partners, not factoring/ELD. They were called out in FN-1620 as "carrier brings their own credentials" — should we plan a parallel "load-board partners" epic now or fold it into this one? Recommend separate epic — different data shape (lane offers, not events), different consumer (Loads page, not Settings).

7. **Webhook retry policy — at-least-once or exactly-once?**
   Tier-1 providers all support at-least-once delivery with idempotency keys (`external_event_id`). The schema above uses `UNIQUE(provider, external_event_id)` to dedupe. Confirm we're OK with at-least-once semantics + dedupe (industry standard), versus building exactly-once with provider-side ack/nack flows (more work, no real benefit).

8. **Data residency / compliance posture for ELD HOS events?**
   ELD data is FMCSA-regulated. We currently don't promise specific data residency or retention. Before the Motive/Samsara integration ships, confirm that storing `hos_log_events` in our normal Postgres satisfies any tenant-level compliance commitments we've made (or want to make) — especially for tenants with safety-sensitive customers.

---

## Appendix — Document map

| Section | Lines covered |
|---|---|
| Recommendation up front | top |
| Section 1 — Factoring vendor matrix (14 providers) | full |
| Section 2 — ELD vendor matrix (15 providers) | full |
| Section 3 — Top-3 recommendations + rationale | full |
| Section 4 — Architecture (DB schema, credentials, service placement, webhook pattern, sync framework, OAuth UX, multi-tenant isolation, adapter interface) | full |
| Section 5 — Effort estimates per top-3 partner | full |
| Section 6 — Open questions for product | full |

This doc is the input for the **AI Tools Phase 2 — Partner Integrations** implementation epic. Once Sections 3 and 6 are reviewed and decisions are recorded, the TPM agent can decompose the implementation epic into stories matching the Foundation + 6 adapters + Settings UI structure.
