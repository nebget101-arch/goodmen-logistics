# Recent Platform Updates (March 2026)

This document summarizes important product and platform changes completed in March 2026 so docs and onboarding stay aligned with current behavior.

---

## 1) UI / UX updates

### Global assistant launcher
- Floating assistant launcher label changed from **“Ask AI”** to **“Ask Neuron”**.
- Launcher icon updated to AI icon (`psychology_alt`).
- Launcher visual styling refreshed to match AI theme (teal gradient/glow).

### Header action buttons
Top-right CTA buttons were normalized across major pages for:
- consistent size/height,
- consistent AI-themed color treatment,
- section-appropriate icon usage.

Updated sections include:
- Loads (`New Load`)
- Dispatch Drivers (`New Driver`)
- DQF Drivers (`Add Driver`)
- Trucks/Trailers (`Add Truck` / `Add Trailer`)
- Settlements (`New settlement`)

---

## 2) Access and plan behavior updates

### Basic plan access
- **Basic plan now includes `/settlements` access**.
- Frontend includes a compatibility allowance for existing Basic tenants so settlements remain reachable while access payloads refresh.

### Access refresh reliability
- App startup now refreshes access context for logged-in users to reduce stale-permission issues.

---

## 3) Trial flow and admin visibility updates

### Trial signup robustness
- Trial signup URL/token handling was hardened:
  - request-aware public base URL generation,
  - support for token via query and path patterns,
  - improved clipboard copy flow/fallbacks for activation links.

### Trial request admin page visibility
- Trial request admin navigation/route is hidden in normal app navigation.
- Trial request operations remain internal/admin-capable via backend routes and can be surfaced in UI when needed.

---

## 4) Deployment and migration updates

### Render logistics pre-deploy simplification
- `render.yaml` logistics pre-deploy now runs database migrations directly:
  - `npx --prefix ../../packages/goodmen-database knex migrate:latest ...`

### Data normalization migration added
- Added migration:
  - `backend/packages/goodmen-database/migrations/20260316090000_normalize_load_statuses_and_billing_statuses.js`
- Purpose:
  - normalize legacy/free-form `loads.status` values,
  - normalize legacy/free-form `loads.billing_status` values,
  - move one-off predeploy data-fix logic into versioned migration history.

---

## 5) Notes for contributors

When updating docs going forward, ensure these terms are used consistently:
- Use **Ask Neuron** (not Ask AI) for the global assistant launcher label.
- Document settlements as available for **Basic** plan where plan-level route access is described.
- Treat trial request admin UI as **internal/optional UI exposure**, not always-visible navigation.
