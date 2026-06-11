# Mobile App Distribution & CI Cost Research

**Subtask:** FN-1292 | **Parent Story:** FN-1214 | **Date:** 2026-06-11
**Author:** backend agent (infra scope)

---

## 1. App Store Account Requirements

### 1.1 Apple Developer Program (iOS)

| Item | Detail |
|------|--------|
| **Account type** | Apple Developer Program (individual or organization) |
| **Annual fee** | $99 USD/year |
| **Enrollment** | developer.apple.com → Enroll; requires Apple ID + D-U-N-S number for organizations |
| **D-U-N-S number** | Free via Dun & Bradstreet; takes 5–14 business days if not already on file. Use `developer.apple.com/support/D-U-N-S/` to check. |
| **Required for** | App Store distribution, TestFlight, in-house/MDM `.ipa` signing |
| **App Store Connect access** | Free; all members of the developer program; manage apps, review submission, TestFlight |
| **Team roles** | Account Holder, Admin, App Manager, Developer, Marketing, Finance, Customer Support |
| **Certificates needed** | Distribution certificate (`.p12`, max 3 active), Provisioning Profile (App Store or Enterprise) |
| **APNs key** | `.p8` key per team (not per app) — upload to CI as secret; used by `@capacitor/push-notifications` |
| **Renewal** | Annual, auto-renewed if billing is active; lapsed account = revoked provisioning profiles immediately |

#### Provisioning profiles explained

| Profile Type | Use Case | Store Review Required? |
|---|---|---|
| App Store | Public App Store distribution | Yes |
| Ad Hoc | Up to 100 registered device UDIDs | No (suitable for internal QA devices) |
| Development | Debugging on registered devices | No |
| Enterprise (Apple Developer Enterprise Program — $299/year) | MDM in-house distribution without App Store | No — but requires separate enrollment and Apple background check |

**Recommendation for Phase 1:** Use the standard $99 program. Distribute via MDM using an Ad Hoc profile (up to 100 fleet tablets) or a TestFlight internal build. Avoid Enterprise until fleet tablet count exceeds 100 devices.

---

### 1.2 Google Play Developer Account (Android)

| Item | Detail |
|------|--------|
| **Account type** | Google Play Developer account |
| **One-time fee** | $25 USD (lifetime, not renewable) |
| **Enrollment** | play.google.com/console → Create account; requires Google account + payment |
| **D-U-N-S / org verification** | Not required for basic account; optional for Play Commerce features |
| **Review timeline** | New accounts: initial app review takes 3–7 days; subsequent releases ~1–3 days (rolling review) |
| **Team roles** | Owner, Admin, Release Manager, Developer, Viewer; per-app or account-wide |
| **Signing** | Upload key (`.jks` or `.keystore`) — Google Play App Signing stores the upload key; if lost, Google can recover the signing key from its store |
| **FCM** | Firebase Cloud Messaging is free; `google-services.json` generated from Firebase console, committed to repo (non-secret); `GOOGLE_SERVICES_JSON_BASE64` injected by CI for Android builds |
| **Sideload option** | Enable "Install unknown apps" on device + push `.apk` via MDM; no Play account interaction required |

#### Distribution tracks (Google Play)

| Track | Audience | Review? |
|---|---|---|
| Internal testing | Up to 100 testers (by email) | No — near-instant |
| Closed testing (Alpha) | Invite-only list | ~1 day |
| Open testing (Beta) | Public opt-in | ~1 day |
| Production | Full Play Store listing | ~1–3 days |

**Recommendation for Phase 1:** Use the **Internal testing track** (100 testers, no review) or sideload via MDM. No public Play Store listing needed until Phase 2 consumer rollout.

---

## 2. Distribution Mechanics

### 2.1 Decision matrix

| Distribution method | iOS | Android | Store review? | MDM required? | Best for |
|---|---|---|---|---|---|
| **Public App Store / Play Store** | App Store | Play Store | Yes | No | Consumer / public fleets |
| **TestFlight** (iOS only) | ✓ | — | Minimal | No | QA team, stakeholders (up to 10,000 external testers) |
| **Ad Hoc + MDM push** | ✓ (≤100 UDIDs) | — | No | Yes | Small fleet (< 100 tablets) |
| **Enterprise / In-House** (iOS) | $299/yr program | — | No | Yes | Large in-house fleet; no store listing |
| **Play Internal track + MDM** | — | ✓ | No | Yes | Enterprise Android tablets |
| **APK sideload via MDM** | — | ✓ | No | Yes | Locked-down Android (simplest) |
| **PWA (web, no install)** | ✓ | ✓ | No | No | MVP; no distribution overhead |

### 2.2 Recommended Phase 1 path

```
iOS:    PWA (immediate) → Ad Hoc + TestFlight when Capacitor shell is ready
Android: PWA (immediate) → APK sideload via MDM when Capacitor shell is ready
```

No public store listing, no App Review delays, no 3-day wait — the fleet's MDM pushes the binary directly. Move to a public listing in Phase 2 when non-MDM driver adoption is required.

---

## 3. MDM Implications for Fleet Tablets

### 3.1 Supported MDM platforms (common in trucking)

| MDM | iOS support | Android support | Notes |
|---|---|---|---|
| **Jamf Pro / Jamf Now** | Full (ABM/ASM) | Full (Android Enterprise) | Market leader for iOS fleets |
| **Microsoft Intune** | Full | Full | Common in enterprises with Microsoft 365 |
| **VMware Workspace ONE (AirWatch)** | Full | Full | Strong trucking/field presence |
| **SOTI MobiControl** | Full | Full | Common in logistics and field service |
| **Apple Business Manager (ABM)** | iOS/macOS only | — | Not an MDM; works alongside Jamf/Intune for zero-touch enrollment |

### 3.2 App distribution via MDM

**iOS (Ad Hoc profile):**
1. CI builds a signed `.ipa` with an Ad Hoc provisioning profile that includes registered device UDIDs.
2. Upload `.ipa` to MDM (Jamf, Intune, etc.) as a managed app.
3. MDM pushes the app to enrolled tablets without user interaction ("silent install").
4. UDIDs must be added to the provisioning profile before each build — a manual step. Max 100 devices per Ad Hoc profile.

**Android (APK sideload via MDM):**
1. CI builds a signed `.apk` (release variant).
2. Upload `.apk` to MDM as an enterprise app.
3. MDM pushes to enrolled Android devices. No UDID list required — unlimited devices.

**Key MDM considerations:**
- App version pinning: MDM can hold specific versions, preventing auto-update during active dispatch shifts.
- Kiosk / single-app mode: MDM can lock tablets to the FleetNeuron driver app only (common in in-cab tablets).
- VPN split-tunneling: some fleets route all MDM-enrolled traffic through a corporate VPN — the driver app must work behind typical fleet VPN configs (port 443, no special UDP).
- Certificate provisioning: APNs `.p8` key for push must be rotated when the Apple Developer account certificate expires (never for `.p8` keys; they don't expire unless explicitly revoked).

### 3.3 iOS UDID limit mitigation

Once fleet size exceeds 100 tablets:
- **Option A**: Upgrade to Apple Developer Enterprise Program ($299/year) — unlimited in-house distribution, no UDID list.
- **Option B**: Publish to App Store and use **Apple Business Manager (ABM) Managed Distribution** — fleet IT purchases app licenses in ABM and assigns to devices via MDM; no UDID tracking.
- **Option C** (interim): Register only active tablets (rotate UDIDs as hardware changes).

Phase 1 recommendation: start with Ad Hoc (< 100 tablets assumed for pilot). Include a ticket to revisit when tablet count approaches 80.

---

## 4. CI Pipeline Options — Build Cost Comparison

Capacitor builds require macOS (for iOS `.ipa`) and optionally Linux/Windows for Android `.apk`. macOS runners are the cost driver.

### 4.1 GitHub Actions (self-hosted or hosted)

| Runner type | iOS support | Cost | Notes |
|---|---|---|---|
| GitHub-hosted macOS (M1 large, 12 vCPU) | ✓ | $0.16/min | Usage-billed; ~15 min iOS build ≈ $2.40/build |
| GitHub-hosted macOS (standard, 3 vCPU) | ✓ | $0.08/min | Slower; ~25 min ≈ $2.00/build |
| Self-hosted macOS (Mac mini M2, ~$700 HW) | ✓ | ~$0/min (HW amortized) | Requires maintenance; good for > 50 builds/month |
| GitHub-hosted Linux | Android only | $0.008/min | Very cheap; ~8 min Android build ≈ $0.064/build |

**Monthly cost estimate (GitHub Actions, hosted):**

| Scenario | Builds/month | iOS cost | Android cost | Total/month |
|---|---|---|---|---|
| Low volume (1 build/day) | ~30 | 30 × $2.40 = $72 | 30 × $0.07 = $2.10 | ~$74 |
| Medium volume (3 builds/day) | ~90 | 90 × $2.40 = $216 | 90 × $0.07 = $6.30 | ~$222 |
| CI PR builds (per-PR) | ~150 | 150 × $2.40 = $360 | 150 × $0.07 = $10.50 | ~$370 |

**Verdict:** GitHub Actions is the lowest-friction option if Render + GitHub is already the CI/CD stack (which it is for FleetNeuron). No new account, no new vendor. For < 50 iOS builds/month, hosted runners are cost-effective. Above 50 builds/month, a self-hosted Mac mini pays off in under 3 months.

---

### 4.2 Bitrise

| Tier | macOS (M1) minutes/month | Price/month | Overage |
|---|---|---|---|
| Hobby (free) | 200 | $0 | N/A (hard cap) |
| Developer | 500 macOS | $36 | $0.055/min |
| Org (Standard) | 2,000 macOS | $115 | $0.055/min |
| Org (Pro) | Unlimited | $275+ | — |

**Monthly cost at medium volume (90 iOS builds × 15 min = 1,350 macOS min/month):**
- Developer tier: 200 included + 1,150 × $0.055 = $36 + $63.25 = **~$99/month**
- Org Standard: 2,000 included → **$115/month** (covers headroom)

**Pros:** Excellent Capacitor/Ionic first-class support; one-click code signing (handles certificates/profiles); built-in TestFlight deploy step; good UX.
**Cons:** New vendor, new account, additional monthly cost on top of Render.

---

### 4.3 Codemagic

| Tier | macOS M1 min price | Notes |
|---|---|---|
| Pay-as-you-go | $0.095/min | No subscription; 500 free min/month for open-source |
| Teams | $95/month flat | 3 concurrent macOS builds, 3 users |
| Business | $299/month | 8 concurrent, advanced features |

**Monthly cost at medium volume (1,350 macOS min/month):**
- Pay-as-you-go: 1,350 × $0.095 = **~$128/month** (after 500 free min: 850 × $0.095 = $80.75)
- Teams plan: **$95/month flat** (covers volume with room)

**Pros:** Flutter/Capacitor native; excellent code signing UI; built-in App Store Connect + Play Store deploy; YAML-based config.
**Cons:** New vendor; slightly pricier than GitHub Actions at low volume.

---

### 4.4 Recommendation

| Priority | Option | Why |
|---|---|---|
| **1st choice** | **GitHub Actions (hosted macOS)** | No new vendor; integrates with existing Render/GitHub pipeline; pay-per-use; ~$74/month at 30 builds/month |
| **2nd choice** | **Bitrise (Org Standard)** | Best Capacitor UX; code signing wizard; TestFlight one-click; $115/month flat predictable cost |
| **3rd choice** | **Self-hosted Mac mini** | Best unit economics above 50 iOS builds/month; requires hardware procurement and maintenance |

**Do not use Codemagic as primary** — pricing is comparable to Bitrise but the UX advantage is smaller. It's a valid fallback if Bitrise has availability issues.

---

## 5. Code Signing — CI Secrets Inventory

These secrets must be stored in the CI provider's secret vault (never committed to repo):

### iOS

| Secret | Description | How to obtain |
|---|---|---|
| `APPLE_CERTIFICATE_P12_BASE64` | Distribution certificate, base64-encoded | Keychain Access → Export as `.p12` → `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password set when exporting `.p12` | — |
| `APPLE_PROVISIONING_PROFILE_BASE64` | Ad Hoc or App Store provisioning profile, base64-encoded | developer.apple.com → Profiles → Download → `base64 -i profile.mobileprovision` |
| `APPLE_API_KEY_ID` | App Store Connect API key ID (for automated uploads) | App Store Connect → Users and Access → Keys |
| `APPLE_API_ISSUER_ID` | App Store Connect API issuer ID | Same location |
| `APPLE_API_KEY_P8_BASE64` | `.p8` private key content, base64-encoded | Downloaded once at creation; cannot be re-downloaded |
| `APNS_KEY_P8_BASE64` | APNs key for push notifications | developer.apple.com → Certificates → Keys |
| `APNS_KEY_ID` | APNs key ID | — |
| `APPLE_TEAM_ID` | 10-char developer team ID | developer.apple.com → Membership |

### Android

| Secret | Description | How to obtain |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | Release keystore (`.jks`), base64-encoded | `keytool -genkey -v -keystore release.keystore ...` → `base64 -i release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password | Set during `keytool` generation |
| `ANDROID_KEY_ALIAS` | Key alias within the keystore | Set during `keytool` generation |
| `ANDROID_KEY_PASSWORD` | Key password | Set during `keytool` generation |
| `GOOGLE_SERVICES_JSON_BASE64` | `google-services.json` from Firebase console, base64-encoded | Firebase console → Project settings → Your apps → Android |

**Keystore backup:** The Android keystore is irreplaceable — if lost, the app cannot be updated on devices that have the current version installed (Google Play App Signing mitigates this for Play-distributed builds, but not for sideloaded APKs). Store a backup in a password manager and in the organization's secure secrets vault (e.g., 1Password, Vault, AWS Secrets Manager).

---

## 6. Summary & Recommended Next Steps

| Decision | Recommendation |
|---|---|
| **CI provider** | GitHub Actions (hosted macOS) — no new vendor, ~$74/month at moderate volume |
| **iOS distribution (Phase 1)** | PWA immediately; Ad Hoc + TestFlight when Capacitor shell is built |
| **Android distribution (Phase 1)** | PWA immediately; APK sideload via MDM when Capacitor shell is built |
| **Public store listing** | Phase 2 — after pilot fleet validation |
| **UDID scaling** | Re-evaluate at 80 fleet tablets; Enterprise Program or ABM Managed Distribution |
| **Secrets management** | GitHub Actions secrets vault; keystore + `.p8` backed up to org password manager |

### Tickets to create before Capacitor build epic

1. `[devops]` Provision Apple Developer Program account + generate Distribution cert + Ad Hoc profile
2. `[devops]` Configure GitHub Actions macOS workflow for Capacitor iOS build (secrets, sign, artifact upload)
3. `[devops]` Configure GitHub Actions Linux workflow for Capacitor Android build (sign, APK artifact)
4. `[devops]` Set up TestFlight internal group (FleetNeuron team + pilot fleet contacts)
5. `[devops]` MDM enrollment for pilot fleet tablets (coordinate with fleet IT)
