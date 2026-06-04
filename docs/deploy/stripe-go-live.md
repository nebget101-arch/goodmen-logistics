# Stripe Go-Live Runbook (FN-1686)

This runbook takes FleetNeuron billing from placeholder config to a live, production-ready
Stripe integration. It covers creating the Products/Prices, wiring the resulting IDs into the
deployed environment, and registering the webhook endpoint.

> **No secrets in git.** Every value below is entered in the **Stripe Dashboard** and the
> **Render Dashboard** only. The repo contains placeholders (`.env.example`) and `sync: false`
> declarations (`render.yaml`) — never real keys or price IDs.

---

## 0. Prerequisites

- Access to the FleetNeuron Stripe account (Owner/Admin) with **live mode** enabled.
- Access to the Render dashboard for the `fleetneuron-auth-users-service` web service.
- The public gateway URL for the target environment:
  - **Production:** `https://fleetneuron-logistics-gateway.onrender.com`
  - **Dev:** `https://fleetneuron-logistics-gateway-dev.onrender.com`

> Use **Test mode** keys (`sk_test_…`, `pk_test_…`, `whsec_…` from a test endpoint) when
> provisioning the dev environment, and **Live mode** keys for production. The two sets of
> price IDs are **not** interchangeable — a test-mode price ID will not resolve in live mode.

---

## 1. Capture the API keys

In the Stripe Dashboard → **Developers → API keys**:

| Stripe value | Env var | Where it goes |
|---|---|---|
| Secret key (`sk_live_…` / `sk_test_…`) | `STRIPE_SECRET_KEY` | `auth-users-service` (Render) |
| Publishable key (`pk_live_…` / `pk_test_…`) | `STRIPE_PUBLISHABLE_KEY` | Frontend env config (build-time) |

The publishable key is browser-safe and is baked into the Angular build via
`frontend/src/environments/environment*.ts`. Replace the `pk_*_replace_with_real_key`
placeholder for the matching environment:

- `environment.prod.ts` → live key (`pk_live_…`)
- `environment.dev.ts` → test key (`pk_test_…`)
- `environment.ts` (local dev) → test key (`pk_test_…`)

The **secret key** is server-only and is set on Render (step 4) — never commit it and never
expose it to the browser.

---

## 2. Create Products & Prices (one per plan + the extra-seat add-on)

The plan catalog is defined in `backend/packages/goodmen-shared/config/plans.js`. Create one
**recurring (monthly)** Price for each plan, plus one for the per-seat add-on. Create them as
**live-mode** Products in production.

Stripe Dashboard → **Product catalog → Add product**. For each row below, create a Product with
a recurring monthly Price in USD:

| Plan (`plans.js` id) | Display name | Monthly price | Maps to env var |
|---|---|---|---|
| `basic` | Starter | $149.00 | `STRIPE_PRICE_BASIC` |
| `multi_mc` | Professional | $349.00 | `STRIPE_PRICE_MULTI_MC` |
| `end_to_end` | Advanced | $799.00 | `STRIPE_PRICE_END_TO_END` |
| `enterprise` | Enterprise | custom (set per contract) | `STRIPE_PRICE_ENTERPRISE` |
| _add-on_ | Additional user seat | $25.00 / seat / mo | `STRIPE_PRICE_EXTRA_USER_SEAT` |

Notes:
- **Extra-seat add-on** (`STRIPE_PRICE_EXTRA_USER_SEAT`): a recurring monthly Price billed
  per unit (quantity = number of extra seats). Plans include a base seat count
  (`includedUsers` in `plans.js`); seats beyond that are billed via this price. See
  `backend/packages/goodmen-shared/services/extraSeatSyncService.js`.
- **Enterprise** is "Contact us" pricing — create the Price at whatever amount the contract
  specifies; it still needs a valid Price ID so the plan resolves at runtime.
- After creating each Price, click into it and copy the **Price ID** (`price_…`), **not** the
  Product ID (`prod_…`).

> **Why the mapping matters:** the backend resolves each plan to its price via the
> `PLAN_PRICE_MAP` pattern in `backend/packages/goodmen-shared/jobs/processTrialConversions.js`
> (`STRIPE_PRICE_[PLAN_ID_UPPERCASE]`). A missing or wrong ID means trial conversions and
> checkout for that plan fail. FN-1692's `GET /api/billing/config-status` verifies every plan
> resolves to a non-empty price ID.

---

## 3. Register the webhook endpoint

The backend exposes the webhook at **`/api/stripe/webhook`** on `auth-users-service`
(`backend/microservices/auth-users-service/routes/stripe.js`, mounted at `/api/stripe` in
`server.js`). It is reached through the public gateway.

In Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

1. **Endpoint URL:**
   - Production: `https://fleetneuron-logistics-gateway.onrender.com/api/stripe/webhook`
   - Dev: `https://fleetneuron-logistics-gateway-dev.onrender.com/api/stripe/webhook`
2. **Events to send** — select the events the handler processes:
   - `setup_intent.succeeded`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
3. Click **Add endpoint**.

> The handler verifies every request's `stripe-signature` header against
> `STRIPE_WEBHOOK_SECRET` using `stripe.webhooks.constructEvent`. Without the correct secret,
> all webhook calls are rejected with `400`.

---

## 4. Capture the webhook signing secret

After creating the endpoint, open it in the Stripe Dashboard and click **Reveal** under
**Signing secret**. Copy the `whsec_…` value into `STRIPE_WEBHOOK_SECRET`.

Each endpoint (test vs. live, dev vs. prod) has its **own** signing secret — make sure the
secret matches the endpoint for the environment you are configuring.

---

## 5. Set the environment variables on Render

`render.yaml` declares all of these for `fleetneuron-auth-users-service` as `sync: false`,
which means Render expects you to supply the value in the dashboard (it is not synced from the
blueprint and is never stored in git).

Render Dashboard → `fleetneuron-auth-users-service` → **Environment** → set each:

| Env var | Value source |
|---|---|
| `STRIPE_SECRET_KEY` | Step 1 (secret key) |
| `STRIPE_WEBHOOK_SECRET` | Step 4 (signing secret) |
| `STRIPE_PRICE_BASIC` | Step 2 (Starter price ID) |
| `STRIPE_PRICE_MULTI_MC` | Step 2 (Professional price ID) |
| `STRIPE_PRICE_END_TO_END` | Step 2 (Advanced price ID) |
| `STRIPE_PRICE_ENTERPRISE` | Step 2 (Enterprise price ID) |
| `STRIPE_PRICE_EXTRA_USER_SEAT` | Step 2 (extra-seat price ID) |

Save and let the service redeploy.

The frontend `STRIPE_PUBLISHABLE_KEY` is **not** a Render env var — it is compiled into the
static bundle from `environment*.ts`, so update it in the repo (step 1) and trigger a frontend
build/deploy.

---

## 6. Verify (go-live checklist)

1. **Service starts cleanly** — check the `auth-users-service` deploy logs. With
   `STRIPE_SECRET_KEY` set, the `[stripe] … disabled` warning from
   `backend/packages/goodmen-shared/config/stripe.js` should be **absent**. FN-1692 adds a
   startup validation that logs any missing keys.
2. **Config status endpoint** (FN-1692) — as an admin, call
   `GET /api/billing/config-status`. Every key should report present; no secret values are
   returned.
3. **Price IDs are valid** — each `STRIPE_PRICE_*` should resolve to an existing Price in the
   matching Stripe mode (test/live). A `No such price` error means a wrong-mode or mistyped ID.
4. **Webhook signature verifies** — in the Stripe Dashboard webhook view, click **Send test
   event** (e.g. `invoice.payment_succeeded`) and confirm a `2xx` response. A `400` means the
   `STRIPE_WEBHOOK_SECRET` does not match the endpoint.

> Detailed test-account verification and evidence capture is tracked in **FN-1693 (QA)**.

---

## Reference: file & env-var map

| Concern | File |
|---|---|
| Render env declarations (`sync: false`) | `render.yaml` → `fleetneuron-auth-users-service` |
| Local/dev placeholders | `.env.example` |
| Frontend publishable key | `frontend/src/environments/environment*.ts` |
| Plan catalog | `backend/packages/goodmen-shared/config/plans.js` |
| Plan→price resolution pattern | `backend/packages/goodmen-shared/jobs/processTrialConversions.js` (`PLAN_PRICE_MAP`) |
| Extra-seat billing | `backend/packages/goodmen-shared/services/extraSeatSyncService.js` |
| Stripe SDK init / disabled fallback | `backend/packages/goodmen-shared/config/stripe.js` |
| Webhook handler | `backend/microservices/auth-users-service/routes/stripe.js` |
| Config-status endpoint (FN-1692) | `backend/microservices/auth-users-service/routes/billing.js` |

| Env var | Scope | Secret? |
|---|---|---|
| `STRIPE_SECRET_KEY` | auth-users-service | yes |
| `STRIPE_WEBHOOK_SECRET` | auth-users-service | yes |
| `STRIPE_PRICE_BASIC` | auth-users-service | no (but env-specific) |
| `STRIPE_PRICE_MULTI_MC` | auth-users-service | no |
| `STRIPE_PRICE_END_TO_END` | auth-users-service | no |
| `STRIPE_PRICE_ENTERPRISE` | auth-users-service | no |
| `STRIPE_PRICE_EXTRA_USER_SEAT` | auth-users-service | no |
| `STRIPE_PUBLISHABLE_KEY` | frontend (build-time) | no (browser-safe) |
