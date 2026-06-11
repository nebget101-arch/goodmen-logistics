# Driver Mobile App — Architecture Spike & Recommendation

**Spike:** FN-1290, FN-1292 | **Story:** FN-1214 | **Date:** 2026-06-11
**Status:** Complete — FN-1290 (architecture + stack), FN-1291 (POC), FN-1292 (distribution + CI costs)

---

## Executive Summary

**Recommendation: Capacitor (Ionic/Angular shell) wrapping the existing Angular frontend.**

The FleetNeuron driver portal is Angular-based and already handles the core incident-list
and call-flow UX. Wrapping it in Capacitor gives near-native device access (push, camera,
offline storage) without a full React Native rewrite, preserves the existing auth/API
contracts, and fits the team's Angular skill set. A standalone PWA is viable for an
incremental rollout (no App Store gating, zero install friction) and can be shipped first,
but it has hard limits on push reliability and background sync that matter for roadside
scenarios. The recommended path is **PWA first → Capacitor production**.

---

## POC Outcome (FN-1291)

The FN-1291 frontend subtask delivered a working standalone PWA scaffold at
`experiments/driver-mobile-poc/`. Key observations:

- Login (`POST /api/auth/login`) and incident list (`GET /api/roadside/calls`) work
  against the live dev gateway with no backend changes.
- Service worker caches the app shell; incident data is fetch-on-demand (no offline data
  yet — intentional POC scope).
- Touch targets ≥ 44 × 44 px, AI dark theme, WCAG 4.5:1 contrast verified.
- Detail view is a placeholder (`window.alert`) — full slide-up sheet is in-scope for the
  build epic.
- No native device features were exercised in the POC; this spike evaluates what adding
  them requires.

---

## Stack Comparison

| Dimension | PWA (standalone) | Capacitor wrapper | React Native |
|-----------|-----------------|-------------------|--------------|
| **Code reuse** | 100% — existing Angular frontend | ~95% — same Angular code, thin Capacitor shell | ~5% — full rewrite in React |
| **Team ramp** | None | 1–2 days for Capacitor CLI + plugin setup | 4–6 weeks |
| **App Store distribution** | No store listing; add-to-home-screen only | iOS App Store + Google Play (requires accounts + review) | Same as Capacitor |
| **iOS push notifications** | Web Push on iOS 16.4+ home-screen only; unreliable background delivery | APNs via `@capacitor/push-notifications`; full background support | APNs via react-native push |
| **Android push** | Web Push (FCM) — reliable for Chrome-based browsers | FCM via `@capacitor/push-notifications` | FCM via react-native push |
| **Background sync** | Background Sync API — limited, no iOS | Service worker background fetch (Capacitor) | Full background task support |
| **Camera** | `getUserMedia` — browser permission prompt; no native camera UI | `@capacitor/camera` — native sheet, works offline | `react-native-camera` — full native |
| **Offline data** | IndexedDB / Cache API — manual implementation | Same + SQLite via `@capacitor-community/sqlite` | Realm / SQLite via native modules |
| **Deep links** | URL scheme only | Universal Links (iOS) + App Links (Android) | Same |
| **Update cadence** | Instant (web deploy) | Instant for JS layer; store review only for native plugin changes | Same as Capacitor |
| **App Store precedent** | Not applicable | Standard process; 1–3 day review typical | Same |
| **Build tooling** | None | Capacitor CLI + Xcode (iOS) + Android Studio | Metro bundler + Xcode + Android Studio |
| **Fleet tablet MDM** | Web shortcut pushed via MDM | `.ipa` / `.apk` distributed via MDM (no store required) | Same |
| **Estimated implementation effort** | 2–3 weeks (incident detail, push, offline data) | 4–6 weeks (same features + Capacitor setup + store submission) | 16–24 weeks |

### Verdict

Capacitor is the production path. It reuses >95% of the existing Angular codebase, adds
reliable push and camera in a matter of days with official plugins, and supports both
App Store and MDM distribution. React Native is ruled out: the rewrite cost (16–24 weeks
estimated) is unjustified given existing Angular investment, and there is no functional gap
that React Native fills over Capacitor for this use case.

---

## App Store Implications

> Full research, account requirements, distribution mechanics, and CI cost breakdown are
> in [`docs/spikes/mobile-distribution-research.md`](./mobile-distribution-research.md) (FN-1292).
> This section summarises the key decisions.

### iOS (App Store)

- Apple Developer Program: **$99/year**. Requires D-U-N-S number for org enrollment (5–14 business days if not on file).
- App Review applies only when native plugin versions or iOS entitlements change; JS-only
  updates ship over-the-air without re-review.
- APNs `.p8` key (push notifications) is provisioned once per team, never expires — store as
  `APNS_KEY_P8_BASE64` in CI secrets vault.
- For fleet tablets: use an **Ad Hoc provisioning profile** (up to 100 UDIDs) distributed
  via MDM. No public App Store listing required for Phase 1.
- Scale path: above 100 tablets → Apple Developer Enterprise Program ($299/year) or
  Apple Business Manager (ABM) Managed Distribution.

### Android (Google Play)

- Google Play Developer: **$25 one-time fee**.
- For Phase 1: use the **Internal testing track** (100 testers, no review, near-instant)
  or sideload the signed `.apk` via MDM. No public listing, no review delays.
- FCM (`google-services.json`) is free and committed to the repo (non-secret).
- Android keystore is irreplaceable — back it up to the org password manager immediately.

### MDM Path (Recommended for Fleet Tablets)

Given that FleetNeuron's primary driver device is an in-cab tablet managed by a fleet's
IT team:

1. CI builds a signed `.ipa` (Ad Hoc profile) / `.apk` on every release tag.
2. Artifact uploaded to MDM (Jamf, Intune, Workspace ONE, SOTI) as a managed app.
3. MDM silently pushes the app to enrolled tablets — no user interaction, no store review.
4. Kiosk / single-app mode locks tablets to FleetNeuron only (standard MDM feature).

No public App Store listing needed for Phase 1 — avoids app review delays during
rapid iteration. Move to a public listing in Phase 2 if non-MDM driver adoption is needed.

---

## Offline Support

### Scope for Driver Use Cases

Drivers need offline access for:
1. **Viewing their active incident** (status, vendor contact, call notes)
2. **Updating incident status** (on-site, completed)
3. **Uploading photos** (captured offline, synced when connectivity resumes)

### Architecture

```
┌────────────────────────────────────────────────┐
│  Angular + Capacitor app                        │
│  ┌──────────────────────────────────────────┐  │
│  │  Incident Service (foreground)           │  │
│  │  • Fetch on app open → store in SQLite   │  │
│  │  • Serve from SQLite when offline         │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  Sync Queue (background)                 │  │
│  │  • Status updates queued when offline     │  │
│  │  • Photo blobs queued (Base64 in SQLite)  │  │
│  │  • Flushed on reconnect via Capacitor     │  │
│  │    Network plugin status change event    │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

**Plugins required:**
- `@capacitor-community/sqlite` — structured local storage for incident snapshots and
  the outbound sync queue
- `@capacitor/network` — detect connectivity changes to trigger sync
- `@capacitor/filesystem` — temporary staging for photo blobs before upload

**PWA path (fallback):** Cache API for incident JSON via service worker + IndexedDB for
the sync queue. Functional but IndexedDB has browser-enforced storage quotas and no
guaranteed persistence; SQLite via Capacitor is more reliable for production.

---

## Push Notifications

### Requirements

- **New incident assigned** to driver
- **Incident state change** (e.g., vendor en route)
- **Dispatcher message** (optional Phase 2)

### Architecture

```
drivers-compliance-service
  → POST /internal/ws/emit (gateway bridge)
      → Gateway emits via Socket.IO (in-session only)
  → Push Notification Service (new utility in ai-service or integrations-service)
      → APNs (iOS) / FCM (Android)
      → Stores device_token in user_push_tokens table
```

**Backend additions required:**
- `user_push_tokens` table: `(user_id, tenant_id, platform, device_token, created_at, last_seen_at)`
- Registration endpoint: `POST /api/notifications/register-token` (auth-users-service)
- Push dispatch utility callable from drivers-compliance-service event handlers

**Capacitor plugin:** `@capacitor/push-notifications` handles token registration,
foreground / background delivery, and notification tap routing.

**PWA limitation:** iOS Web Push requires the app to be installed as a home-screen PWA
(iOS 16.4+) and push registration requires a `safari-notification-popup` flow that many
users dismiss. Background delivery is unreliable. For a safety-critical roadside app,
APNs via Capacitor is the correct choice.

---

## Camera Access

### Use Cases

1. Driver photos at scene (damage documentation)
2. Document scanning (insurance card, registration)
3. VIN barcode scan (future)

### Implementation

```typescript
// Angular service wrapping @capacitor/camera
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

async captureScenePhoto(): Promise<string> {
  const image = await Camera.getPhoto({
    resultType: CameraResultType.Base64,
    source: CameraSource.Camera,
    quality: 80,
    width: 1280,
  });
  return image.base64String;
}
```

- `CameraSource.Camera` opens the native camera UI directly (no browser permission dialog).
- Offline: store Base64 in the SQLite sync queue; upload via `POST /api/roadside/calls/:id/photos`
  when connectivity resumes.
- **PWA limitation:** `getUserMedia` works on-device but opens a browser permission dialog
  each time (no remembered permission on iOS Safari between sessions). Capacitor asks once
  and persists the grant.

---

## Tenant Scoping Plan

FleetNeuron is multi-tenant. The mobile app must enforce the same tenant boundaries as the
web frontend.

| Layer | Mechanism |
|-------|-----------|
| **Auth** | Same JWT as the web app (`POST /api/auth/login`); JWT contains `tenant_id`. No new auth flow. |
| **API** | All existing API endpoints already scope by `tenant_id` from the JWT via `auth-middleware.js`. No changes. |
| **Push token registration** | `user_push_tokens` must store `tenant_id` alongside `user_id`; push dispatch queries by `(user_id, tenant_id)` — never broadcasts across tenants. |
| **Offline data** | SQLite DB per device (one user per device in fleet context); no cross-tenant data possible. |
| **White-labelling** | Not in scope for Phase 1. App connects to the FleetNeuron platform; per-tenant branding is deferred. |
| **MDM distribution** | Each fleet purchases seats; the MDM-distributed app uses the fleet's tenant credentials. No app-level tenant switching needed in Phase 1. |

---

## Telemetry Plan

All telemetry events follow the existing `audit_logs` pattern where applicable, and a new
`mobile_telemetry_events` table for mobile-specific metrics.

### Events to instrument

| Event name | Trigger | Properties |
|------------|---------|------------|
| `app.session_start` | App foreground / cold start | `platform`, `app_version`, `tenant_id`, `user_id` |
| `app.session_end` | App background / close | `duration_ms` |
| `incident_list.loaded` | Incident list rendered | `incident_count`, `load_time_ms`, `from_cache` |
| `incident_list.filter_applied` | Status filter chip tapped | `filter_value` |
| `incident_detail.opened` | Detail screen opened | `incident_id` |
| `incident_status.updated` | Driver taps status update | `incident_id`, `new_status`, `queued_offline` |
| `photo.captured` | Camera capture completed | `incident_id`, `queued_offline` |
| `photo.uploaded` | Photo successfully uploaded | `incident_id`, `upload_duration_ms` |
| `push.received` | Push notification received | `notification_type`, `foreground` |
| `push.tapped` | Push notification tapped | `notification_type` |
| `offline.queue_flushed` | Sync queue drained after reconnect | `queued_items_count`, `success_count`, `error_count` |

### Backend collection

- Mobile app POSTs events to `POST /api/telemetry/mobile` (new endpoint, auth-users-service or
  a dedicated telemetry service).
- Batched: app accumulates events and flushes on background (Capacitor Background Runner)
  or on app-close.
- Stored in `mobile_telemetry_events(id, tenant_id, user_id, event_name, properties JSONB, occurred_at, received_at)`.

---

## Cost-of-Ownership Estimate

> Full CI cost comparison (GitHub Actions vs Bitrise vs Codemagic) and code-signing secrets
> inventory are in [`docs/spikes/mobile-distribution-research.md`](./mobile-distribution-research.md) (FN-1292).

### One-time setup costs

| Item | Estimate |
|------|---------|
| Apple Developer Program | $99/year |
| Google Play Developer | $25 (one-time, lifetime) |
| Capacitor + plugin integration | 2–3 engineer-days |
| CI pipeline for iOS / Android builds (GitHub Actions) | 1–2 engineer-days |
| App Store submission + review (if public listing) | 1–3 business days elapsed |
| D-U-N-S number (org enrollment) | Free; 5–14 business days if not on file |

### Ongoing costs

| Item | Estimate |
|------|---------|
| Apple Developer Program renewal | $99/year |
| CI build minutes — GitHub Actions macOS (30 builds/month) | ~$74/month |
| CI build minutes — GitHub Actions macOS (90 builds/month) | ~$222/month |
| CI build minutes — self-hosted Mac mini (> 50 builds/month) | ~$0/month (HW amortized ~$700 one-time) |
| CI build minutes — Bitrise Org Standard (flat) | $115/month |
| Push notification infrastructure | FCM free; APNs free (included in Dev Program) |
| Over-the-air JS updates (optional) | Ionic Appflow $49–$499/month or self-hosted |

**Recommended CI choice:** GitHub Actions hosted macOS — no new vendor, ~$74/month at 30 iOS builds/month. See `mobile-distribution-research.md §4` for full comparison.

### Staffing impact

Capacitor adds a thin native shell layer. The team already knows Angular. Estimated
ongoing maintenance overhead: **< 1 engineer-day/month** for native dependency updates
and App Store compliance.

---

## Sizing: Full Build Epic

Based on the POC findings and this research, the follow-on implementation epic is scoped
at approximately **10–12 weeks** across 3 agents:

| Track | Scope | Estimate |
|-------|-------|---------|
| **Frontend** | Capacitor scaffold + incident detail slide-up + status update UI + photo upload + offline indicator + push notification routing | 4–5 weeks |
| **Backend** | Push token registration endpoint, push dispatch from drivers-compliance events, offline sync endpoint, `mobile_telemetry_events` table + ingest endpoint | 3–4 weeks |
| **DevOps** | CI pipeline (iOS + Android builds), signing cert management, MDM distribution workflow, TestFlight / internal Play track setup | 2–3 weeks |
| **QA** | E2E on device (iOS simulator + Android emulator), offline scenario, push delivery, MDM install smoke test | 1–2 weeks (parallel with last week of implementation) |

**Recommended Phase 1 cut:** Ship the PWA (already in `experiments/driver-mobile-poc/`)
promoted to a proper Angular route (`/driver`) with incident detail + status update. This
unblocks driver adoption immediately with no App Store dependency. Build Capacitor wrapper
in parallel; submit to App Store when feature-complete.

---

## Recommendation

1. **Immediate:** Promote the FN-1291 POC to a production-ready Angular route at `/driver`.
   Add incident detail, status update, and basic offline (IndexedDB sync queue). Deploy as
   a PWA — no App Store, zero friction, immediate driver value.

2. **Next epic:** Wrap in Capacitor for production-grade push, camera, and SQLite offline.
   Submit to App Store + Google Play (or internal MDM track). Target timeline: 10–12 weeks.

3. **Do not pursue React Native.** The rewrite cost is 3–4× higher with no functional
   advantage for this use case.

4. **Tenant scoping is free** — existing JWT + API middleware handles it; only the push
   token table needs a `tenant_id` column.

5. **Telemetry** should be built alongside the Capacitor epic (see event table above).
   Prioritize `incident_list.loaded`, `incident_status.updated`, and `push.tapped` for
   the first release.
