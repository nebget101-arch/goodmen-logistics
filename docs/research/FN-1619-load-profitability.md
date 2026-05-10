# FN-1619 — Per-Load Profitability + Market-Rate Overlay + AI Negotiation Assistant (Spike)

**Status:** Research only. No code changes in this PR. Outcome is a recommendation that product can sign off on before any of the implementation tickets (rate-source contract, calculator endpoint, AI handler, FE page) are scoped into the next sprint.

**Parent epic:** FN-1617 — AI Tools Phase 2.
**Reuses:** FN-502 cost model (Direct + Fully Loaded Profit), FN-1431/FN-1437 AI handler pattern (`load-driver-match-handler.js`).

**Glossary:**
- **Lane** — a directional origin/destination pair, typically expressed at 3-digit-zip (KMA / market) granularity (e.g., 606 → 750 = Chicago → Dallas).
- **RPM** — rate per mile, exclusive of fuel surcharge unless stated.
- **Spot rate** — single-load price negotiated on the open market; volatile.
- **Contract rate** — pre-negotiated rate over a route+volume commitment; sticky.
- **Deadhead** — empty miles from prior delivery to next pickup.

---

## Section 1 — Market-rate data sources

### 1.1 Provider matrix

| Provider | API tier | Spot / contract / both | Lane granularity | Refresh cadence | Reported pricing tier (public, unverified) | Caching / redistribution constraints | Notes |
|---|---|---|---|---|---|---|---|
| **DAT iQ Rateview / RateView API** | Documented REST API; OAuth | Spot **and** contract | 3-digit zip / KMA, 7- and 15-day rolling averages | Daily | Mid-five-figures/yr+ for API; cheaper read-only Power add-on | Strict — no public redistribution; per-user license in TOS; must store with timestamp | **Industry default.** Rates are derived from $150B+ in transactions. Docs: developer.dat.com (Rateview API, Lane Rate API). |
| **Truckstop Rate Insights / Ratemaker API** | Documented REST API | Spot + ratebook (forecast) | 3-digit zip; some 5-digit | Daily | Similar tier to DAT; bundled with Truckstop load-board sub | Per-user; redistribution prohibited | Strong on spot; ratebook is forecast (next 15/30 days). Smaller dataset than DAT. |
| **Greenscreens.ai** | REST API; built for TMS embed | Predictive lane price (proprietary model) | Lane-level (zip-to-zip) | Real-time on request | Not public; reseller pricing via TMS partners | Embedding allowed under partner agreement; no separate cache | Predictive — outputs a “buy” and “sell” rate with confidence. Best fit for negotiation use case but the most expensive. |
| **FreightWaves SONAR / SONAR API** | REST API | Lane indices (rates + tender rejection, capacity) | Market / lane | Daily | Mid five-figures/yr | Per-seat; redistribution limited | Strongest on **trend** indicators (tender reject index, outbound tender volume). Pair with DAT/Truckstop for the actual rate number. |
| **DOE diesel prices** | Free public CSV/JSON (EIA) | N/A — fuel cost input | 9 PADD regions, weekly national average | Weekly (Mon publish) | Free | Public-domain | Not a rate source but the canonical fuel-cost input. Already a candidate input for the calculator. |
| **DAT public free indices** | Web/blog only — no API | National monthly trend | National only | Monthly | Free | Public-domain | Useless for per-load decisions; included only for completeness. |
| **Direct broker portals** | Per-broker, varies | Posted spot rate from that broker | Broker-specific | Real-time | Per-broker; usually free for carriers in the network | Per-portal TOS | Heterogeneous; not a feasible primary source. May be a *signal* later. |
| **Convoy / Loadsmart digital brokerages** | Partner-only | Spot | Lane-specific | Real-time | Partner agreement | Restricted | Convoy shut down 2023; remaining digital brokers (Uber Freight, Loadsmart) require partnership. Not a Phase-2 source. |

### 1.2 Recommendation

**Primary: DAT iQ Rateview API.**
- Largest dataset; the rate dispatchers already cite when negotiating ("DAT says…").
- Returns both spot and contract rates at 3-digit-zip granularity with low (15-day) and high band.
- Output is defensible in negotiation — brokers know the source.

**Fallback: Truckstop Rate Insights.**
- Comparable shape; second-most-cited source.
- Use when (a) DAT returns no data for a lane (rare for major US lanes), (b) DAT API outage, or (c) the dispatcher wants a sanity-check.

**Auxiliary: DOE EIA diesel** — required input for the profitability calculator regardless of which rate source we use; free; we should pull and cache it ourselves on a weekly cron.

**Defer: Greenscreens.ai, SONAR.** They are differentiated but neither is a substitute for the rate number. Revisit if dispatchers ask for a *predictive* recommendation rather than a snapshot — that is a Phase-3 conversation.

### 1.3 Why not "scrape DAT free indices" / "use only DOE"
- DAT's free monthly trend articles are national; a Chicago→Dallas dispatcher needs the IL-to-TX market specifically.
- Without a rate source the AI negotiation assistant has nothing to anchor to and degrades to generic advice. A spike that ships without rate data isn't worth the build.

### 1.4 Open contract questions for product / legal
- DAT API trial — request a trial key + sample payload before we commit to a price tier. Is there a per-call vs flat-fee plan we can match to expected volume (Section 5)?
- DAT TOS on caching — most rate APIs cap how long we can cache. Need to confirm 1–6h is allowed before locking in a `lane_rate_cache` schema (Section 5).
- Per-tenant vs platform-wide license — does our license cover all our tenants, or do tenants need their own DAT subscription? Material to GTM pricing.

---

## Section 2 — Profitability calculator spec

### 2.1 Relationship to FN-502

FN-502's `buildDirectLoadProfit` and `buildFullyLoadedProfit` (in `backend/packages/goodmen-shared/routes/reports.js:2851-3090`) are **historical** — they sum actuals from `fuel_transactions`, `toll_transactions`, `settlement_adjustment_items`, `work_orders` for completed loads.

FN-1619 needs the **forward** version of the same model — a calculator that takes a prospective load and *estimates* the same line items before any actuals exist. The output schema and column names should mirror FN-502 so the dispatcher sees the same vocabulary on both screens.

| FN-502 (historical) | FN-1619 (prospective) | Source |
|---|---|---|
| `rate` | `rate` (entered) | Dispatcher form |
| `driver_pay` (sum of `settlement_adjustment_items` for this load) | `driver_pay_est` = `total_miles × driver_pay_per_mile` (or `rate × pct`) | Driver compensation rule (per-mile / % of rate) — already on `drivers` row in FN-502's pay engine |
| `fuel` (sum of `fuel_transactions`) | `fuel_est` = `total_miles / mpg × $/gal` | DOE diesel by PADD region; tenant-configurable MPG (default 6.5 for Class 8) |
| `tolls` (sum of `toll_transactions`) | `tolls_est` = lane-aware estimate (corridor flag) or flat per-mile heuristic | Heuristic in v1; revisit with toll-API in a follow-up |
| `direct_profit` = `rate − driver_pay − fuel − tolls` | `direct_profit_est` = same formula on estimates | Calc |
| `insurance_allocation` (period prorate / load count) | `insurance_per_load` (current period prorate) | Reuse FN-502 prorate; one-line lookup |
| `eld_allocation` | `eld_per_load` | Same |
| `maintenance_allocation` | `maintenance_per_load` | Same |
| `fully_loaded_profit` | `fully_loaded_profit_est` | Calc |
| `margin_pct` | `margin_pct_est` | Calc |
| — | `break_even_rate` (NEW — prospective only) | `total_cost / total_miles` |
| — | `net_profit_per_mile` (NEW — prospective only) | `direct_profit_est / total_miles` |

**Deltas to FN-502:**
1. Inputs are *estimates*, not actuals — UI must label every cost field as "est." with the input source on hover (tooltip cites MPG, fuel region, pay rule).
2. Two new outputs: `break_even_rate` and `net_profit_per_mile` are dispatch-decision metrics that don't exist in FN-502.
3. Period costs (insurance/ELD/maintenance) reuse FN-502's *current period* allocation — same number, no new SQL.

### 2.2 Inputs

**Dispatcher-entered (form):**
- `originZip`, `destinationZip` (or city/state — resolve via `zip_codes`)
- `equipmentClass` (DRY_VAN | REEFER | FLATBED | STEPDECK | …)
- `brokerId` (typeahead from `brokers` — optional but unlocks history)
- `rateOffered` ($)
- `pickupDate`, `deliveryDate` (used to bound rate-cache freshness and pay-attribution window)
- Optional: `multiStops[]` (array of zips), `fuelSurchargeIncluded` (bool — see edge cases)

**Derived (no dispatcher input needed):**
- `loadedMiles` — `zip_codes` haversine for v1 (already used by `load-driver-match-handler.js:60`); upgrade to Google Distance Matrix in v1.1 if accuracy complaints arrive
- `deadheadMiles` — distance from last known driver location (or last delivery) to `originZip`. If no candidate driver yet, use `tenant.avg_deadhead_miles` config (default ~10–15% of loaded)
- `totalMiles = loadedMiles + deadheadMiles`
- `fuelRegion` — derived from origin state → PADD region → DOE price
- `fuelGallons = totalMiles / mpg` — `mpg` from tenant config (default 6.5)
- `fuelCost = fuelGallons × doeDieselPrice`
- `driverPay` — apply driver/tenant pay rule (per-mile or % of rate). For prospective load with no driver assigned yet, use the tenant's *median* pay rate
- `tollEstimate` — flat $/mile heuristic in v1 (`tenant.toll_rate_per_mile`, default $0.04/mi)
- `trailerCost` — N/A in v1; placeholder field on response for extensibility
- `dispatchOverhead` — already captured in FN-502 fully-loaded prorate; reuse

### 2.3 Outputs (response schema)

```json
{
  "calc": {
    "loadedMiles": 920,
    "deadheadMiles": 45,
    "totalMiles": 965,
    "fuelRegion": "PADD2",
    "doeDieselPricePerGallon": 3.81,
    "mpg": 6.5,
    "fuelGallons": 148.5,
    "fuelCostEst": 565.79,
    "driverPayEst": 530.75,
    "tollsEst": 38.60,
    "directCostEst": 1135.14,
    "directProfitEst": 1264.86,
    "marginPctEst": 52.7,
    "fullyLoadedAllocations": {
      "insurance": 22.40,
      "eld": 5.10,
      "maintenance": 71.20,
      "other": 12.80
    },
    "fullyLoadedProfitEst": 1153.36,
    "fullyLoadedMarginPctEst": 48.0,
    "breakEvenRate": 1246.94,
    "netProfitPerMile": 1.31
  },
  "rateEntered": 2400,
  "rateMarket": {
    "low": 2.21,
    "mid": 2.45,
    "high": 2.69,
    "unit": "per_mile_loaded",
    "source": "DAT iQ Rateview",
    "lane": { "originKma": "CHI", "destinationKma": "DAL", "granularity": "3-digit-zip" },
    "asOf": "2026-05-08T00:00:00Z",
    "windowDays": 15
  }
}
```

### 2.4 Edge cases

- **Multi-stop loads** — sum pairwise haversine over `[origin, ...stops, destination]`. Driver pay still applies per-mile across the full sequence. Surface a per-leg breakdown in the response so the dispatcher can see which leg is dragging margin.
- **Fuel surcharge separation** — if the rate-con itemizes FSC separately, the dispatcher must enter `lineHaulRate` and `fuelSurcharge` as two fields. Only `lineHaulRate` is compared to market RPM. `fuelSurcharge` offsets `fuelCostEst` rather than adding to revenue. v1 can ship with combined-rate input + a "FSC included?" toggle and add the split fields in a follow-up.
- **Refrigerated / special equipment** — REEFER MPG is materially worse (4.5–5.5) due to reefer unit fuel; we need an `equipmentClass → mpg` table on `tenants` rather than a single MPG. FLATBED has lower MPG per ton hauled but typically averages similar to DRY VAN. Default table: `{ DRY_VAN: 6.5, REEFER: 5.0, FLATBED: 6.0, STEPDECK: 6.0 }`.
- **Zero-loaded-mile lanes** (origin = destination, e.g., a yard move) — guard against divide-by-zero for `breakEvenRate` and `netProfitPerMile`. Return `null` and flag in UI.
- **No broker selected** — calculator still runs; broker-history section of AI prompt is omitted.
- **No DAT data for lane** — return calc only, with `rateMarket: null` and a UI banner ("market rate unavailable for this lane — calculator only"). AI assistant still runs but with degraded confidence.

---

## Section 3 — AI negotiation assistant design

### 3.1 Where it lives

New handler: `backend/microservices/ai-service/src/handlers/load-negotiation-handler.js`.
Route: `POST /api/ai/loads/negotiation-guidance` (registered in `ai-router.js`, RBAC-gated to dispatchers).

Mirrors the structure of `load-driver-match-handler.js` (FN-1437) — same Anthropic SDK init, same `logAiInteraction` instrumentation, same prompt-caching pattern.

### 3.2 System prompt (cached)

The system prompt is static and **must** be cached via `cache_control: { type: 'ephemeral' }` on the `system` array — same shape as `load-driver-match-handler.js:276-282`. This is the single largest cost lever.

Sketch:

```
You advise a freight dispatcher negotiating a single load with a broker.

You receive: the lane (origin/destination), equipment class, the dispatcher's
estimated profitability for the load, the current market rate from DAT, the
broker's history with the carrier (if any), and the rate the broker has
currently offered.

Produce three rate points and a short list of talking points:
- targetRate: the rate the dispatcher should ask for. Aim ~5-10% above market mid
  if margin allows; cap at market high.
- walkAwayRate: the lowest rate that still produces fully-loaded profit > 0.
  Below this, the load loses money once period costs are allocated.
- expectedRate: the rate you think the broker will agree to, given their
  historical posted rates (if known) and the spread between the offer and market.

talkingPoints: 3-5 short bullets the dispatcher can paraphrase. Cite concrete
numbers from the inputs (market mid, miles, profit margin, prior load count).
Do not invent numbers.

Return ONLY this JSON shape, no markdown fences, no prose:
{
  "targetRate": <number>,
  "walkAwayRate": <number>,
  "expectedRate": <number>,
  "rateUnit": "total" | "per_mile_loaded",
  "talkingPoints": ["...", "..."],
  "rationale": "one short paragraph",
  "confidence": <number 0-1>,
  "rateSourceAttribution": "DAT iQ Rateview, 15-day average, as of <date>"
}

Rules:
- All rates in the same unit (the input specifies which). Do not mix $/mi and total.
- walkAwayRate < expectedRate <= targetRate (sanity-check before returning).
- If marketRate is null, return confidence <= 0.4 and say so in rationale.
- Never recommend below walkAwayRate — that's the explicit floor.
```

### 3.3 User-message inputs (per call)

```
## Lane
origin: 60601 (Chicago, IL → KMA CHI)
destination: 75201 (Dallas, TX → KMA DAL)
loadedMiles: 920, deadheadMiles: 45, totalMiles: 965
equipmentClass: DRY_VAN

## Profitability (our calculator)
rateOffered: $2400 ($2.61/mi loaded)
directCostEst: $1135
directProfitEst: $1265 (52.7% margin)
fullyLoadedProfitEst: $1153 (48.0% margin)
breakEvenRate: $1247

## Market rate (DAT iQ Rateview, as of 2026-05-08, 15-day avg)
$/mi loaded: low=$2.21, mid=$2.45, high=$2.69
sampleSize: 142 transactions

## Broker history (last 12 months for broker_id=...)
loadsHauled: 8
avgRpmOffered: $2.38/mi
avgRpmAgreed: $2.52/mi
lastLoadDate: 2026-04-22
acceptedNegotiations: 5 of 8 attempts
```

### 3.4 Output JSON (consumed verbatim by the FE)

```json
{
  "targetRate": 2.62,
  "walkAwayRate": 1.30,
  "expectedRate": 2.55,
  "rateUnit": "per_mile_loaded",
  "talkingPoints": [
    "Market mid for CHI→DAL DRY VAN is $2.45/mi (DAT 15-day, n=142). Your offer at $2.61 is slightly above mid — defensible.",
    "We've hauled 8 loads for this broker in the last 12mo at an avg agreed RPM of $2.52 — they pay above their initial offer 5/8 times.",
    "Our break-even on this lane is $1.29/mi after period costs; we have meaningful room before walking.",
    "Reefer/flatbed comps don't apply — keep the conversation on van rates only.",
    "If they push back, anchor on $2.55 — matches their historical agreed RPM and still beats our break-even by ~2x."
  ],
  "rationale": "Offer is at market mid; broker's history shows willingness to negotiate up. Target a small premium, expect to land at their average agreed rate, walk-away well below given headroom.",
  "confidence": 0.78,
  "rateSourceAttribution": "DAT iQ Rateview, 15-day average ending 2026-05-08, 142 transactions"
}
```

### 3.5 Wiring + safety

- **Idempotency** — same calc input + same broker should produce a stable response; temperature `0` (matches FN-1437).
- **Validation** — server-side post-process: reject the response if `walkAwayRate >= expectedRate` or `expectedRate > targetRate`. Log as `AI_VALIDATION_ERROR` and return 502 (same pattern as `load-driver-match-handler.js:295-307`). Do not retry automatically — the dispatcher can re-submit.
- **Fail-open behavior** — if the AI call fails, the response from the calculator endpoint should still return (the FE renders calc + market rate without the AI panel, with a small "AI guidance unavailable — retry" link).
- **Rate-source attribution** — the `rateSourceAttribution` field is round-tripped from the input, not generated by the LLM. We compose it server-side from the DAT response metadata to remove a hallucination vector.
- **PII** — broker history is the only sensitive piece. We send broker IDs and aggregated RPM stats — no contact info, no broker-specific contract terms. Documented in the handler header.

### 3.6 Why a separate handler (vs adding to an existing one)

`load-driver-match-handler.js` is for ranking drivers; the prompt is single-purpose. Adding a second use case would defeat prompt caching (different prompt → different cache key). Separate handler keeps cache hit rates clean.

---

## Section 4 — Frontend wireframe (plain text)

### 4.1 Where it lives

New top-level page **under Loads**, route `/loads/profitability-check`. Sidebar entry "Profitability Check" under the Loads section, between "Loads list" and "Settlements".

**RBAC:** dispatcher, dispatch-manager, admin. Hidden from drivers, mechanics, billing-only roles.

### 4.2 Layout

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Profitability Check                                                          │
│  Estimate cost, see market rate, get negotiation guidance for any prospective │
│  load before you accept it.                                                   │
├──────────────────────────────────────┬────────────────────────────────────────┤
│  Inputs                              │  Results                               │
│  ──────                              │  ──────                                │
│                                      │  (empty until "Calculate" clicked)     │
│  Origin ZIP/City    [______]         │                                        │
│  Destination ZIP    [______]         │                                        │
│  Equipment          [▾ DRY_VAN  ]    │                                        │
│  Broker (opt.)      [typeahead ]     │                                        │
│  Rate Offered ($)   [______]         │                                        │
│                                      │                                        │
│  Pickup date        [date  ]         │                                        │
│  Delivery date      [date  ]         │                                        │
│                                      │                                        │
│  ▾ Advanced (collapsed)              │                                        │
│   Multi-stops [+]                    │                                        │
│   FSC included? ☐                    │                                        │
│   Override MPG  [____]               │                                        │
│   Override deadhead [____] mi        │                                        │
│                                      │                                        │
│  [ Calculate ]   [ Clear ]           │                                        │
└──────────────────────────────────────┴────────────────────────────────────────┘
```

After Calculate — right column populates with three stacked panels:

```
┌─ Profitability ──────────────────────────────────────────────────────────────┐
│  Direct Profit (est)         $1,264.86       Margin    52.7%   ▲ healthy    │
│  Fully Loaded Profit (est)   $1,153.36       Margin    48.0%   ▲            │
│  Break-even rate             $1,246.94       Net $/mi  $1.31                │
│                                                                              │
│  Cost breakdown                                                              │
│  ├─ Fuel       $565.79  (148.5 gal × $3.81 PADD2 DOE)        [tooltip]      │
│  ├─ Driver pay $530.75  (965 mi × $0.55/mi tenant default)   [tooltip]      │
│  ├─ Tolls      $38.60   (965 mi × $0.04/mi heuristic)        [tooltip]      │
│  └─ Period     $111.50  (insurance + ELD + maint + other prorate)           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ Market Rate ────────────────────────────────────────────────────────────────┐
│  DAT iQ Rateview    CHI→DAL  DRY_VAN  15-day avg  as of 2026-05-08           │
│                                                                              │
│            $2.21       $2.45       $2.69                                     │
│   ────────────●━━━━━━━━━━●━━━━━━━━━━●─────────                              │
│   Low                   Mid                    High                          │
│                                                                              │
│   Your offer:  $2.61/mi  (▲ above mid, below high)                           │
│   Sample: 142 transactions                                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ AI Negotiation Guidance ────────────────────────────────────────────────────┐
│  Target ask:  $2.62/mi    Expected agree:  $2.55/mi    Walk away:  $1.30/mi  │
│                                                                              │
│  Talking points                                                              │
│   • Market mid for CHI→DAL DRY VAN is $2.45/mi (DAT, n=142)…                 │
│   • Hauled 8 loads for this broker last 12mo, avg agreed $2.52/mi…           │
│   • Break-even is $1.29/mi after period costs…                               │
│   • Anchor on $2.55 if pushed back…                                          │
│                                                                              │
│  Rationale: Offer is at market mid; broker's history shows willingness…      │
│  Confidence: 78%        Source: DAT iQ Rateview (link)                       │
│                                                                              │
│  [ Update offer to $2.62 → recalculate ]      [ 👍 helpful ]  [ 👎 not ]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 "Update offer" loop

The "Update offer to $X.XX" button writes the AI's `targetRate` back into the rate-offered field and re-runs the calculator (only — no fresh AI call needed unless the dispatcher *also* clicks "re-ask AI"). This keeps cost low while letting the dispatcher iterate.

### 4.4 Confidence band

Render the market-rate panel with a horizontal bar chart anchored at low/mid/high. The dispatcher's offer is plotted as a vertical marker. If `rateMarket.sampleSize < 20`, render the bar in gray with "low confidence — small sample" badge.

### 4.5 Empty / error states

- No DAT data for lane: panel shows "Market rate unavailable" with explanation. Calculator + AI still render (AI confidence falls per Section 3.2).
- AI down: panels 1+2 render; panel 3 shows "AI guidance unavailable — [retry]".
- Calculator failure: full-page error with "report this" link (rare — only on bad input).

---

## Section 5 — Cost / capacity

### 5.1 Per-load cost estimate

Assumptions: a dispatcher checks 8–15 prospective loads/day; carrier has ~5 active dispatchers; ~50 calculator runs/day/tenant at peak; ~70% include AI guidance (some are quick checks).

| Cost component | Per call | Per 50 calls/day | Per month (30d) | Notes |
|---|---|---|---|---|
| **DAT iQ Rateview API** | ~$0.05–0.30 (estimated; varies by plan; could be flat-rate) | $2.50–$15 | $75–$450 | Confirm with DAT trial; flat-rate plans likely cheaper at this volume |
| **Anthropic Claude (Sonnet 4)** — system prompt cached | input ~3.5K tokens (mostly cached read = $0.30/MTok cached vs $3/MTok uncached), output ~600 tokens | First call ~$0.012, cached calls ~$0.005 | $7.50 (assume 35 of 50 use AI) | Cache write ~$3.75/MTok; cache hit dramatically cheaper |
| **DOE diesel** | $0 | $0 | $0 | Cached weekly; cron job |
| **Distance (haversine)** | $0 | $0 | $0 | In-process |
| **Distance Matrix (if upgraded)** | ~$0.005/call | $0.25 | $7.50 | Defer to v1.1 |
| **Total / tenant / month** | — | — | **~$80–$465** | DAT licensing is the dominant variable |

**Implication:** Anthropic cost is in the noise. DAT licensing is the gating constraint — *and* the deal-breaker for free-tier tenants. Section 5.4 deals with this.

### 5.2 Caching strategy

**Lane-day cache** for market rates: key = `(originKma, destinationKma, equipmentClass, asOfDate)`; TTL = 6 hours during business hours, 24 hours overnight. Subject to DAT's contract terms (Section 1.4).

```sql
-- New table sketch (FN-XXXX implementation ticket)
CREATE TABLE lane_rate_cache (
  origin_kma TEXT NOT NULL,            -- 3-digit zip group
  destination_kma TEXT NOT NULL,
  equipment_class TEXT NOT NULL,
  source TEXT NOT NULL,                 -- 'DAT' | 'TRUCKSTOP'
  rpm_low NUMERIC(6,2),
  rpm_mid NUMERIC(6,2),
  rpm_high NUMERIC(6,2),
  sample_size INTEGER,
  window_days INTEGER,
  source_as_of TIMESTAMPTZ,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (origin_kma, destination_kma, equipment_class, source)
);

CREATE INDEX idx_lane_rate_cache_expires ON lane_rate_cache (expires_at);
```

Cache *fill* is on-read with a mutex (so two simultaneous requests don't both call DAT). Stale rows are evicted by a cron job; reads of expired rows trigger refresh.

**DOE diesel cache:**
```sql
CREATE TABLE doe_diesel_prices (
  padd_region TEXT PRIMARY KEY,         -- 'PADD1A', 'PADD2', etc.
  price_per_gallon NUMERIC(5,3) NOT NULL,
  as_of DATE NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
```
Refreshed weekly by a cron in `fleetneuron-integrations-service` (DOE publishes Monday). No row-level TTL — full-table replace each week.

**Tenant config:**
```sql
ALTER TABLE tenants
  ADD COLUMN avg_mpg_by_equipment JSONB DEFAULT '{"DRY_VAN":6.5,"REEFER":5.0,"FLATBED":6.0,"STEPDECK":6.0}',
  ADD COLUMN avg_deadhead_pct NUMERIC(5,2) DEFAULT 12.0,
  ADD COLUMN toll_rate_per_mile NUMERIC(5,3) DEFAULT 0.04,
  ADD COLUMN profitability_check_enabled BOOLEAN DEFAULT FALSE;
```
The `profitability_check_enabled` flag is the feature gate (Section 5.4).

### 5.3 Database additions summary

| Table / column | Owner | Why |
|---|---|---|
| `lane_rate_cache` (new) | DB agent | Reduce DAT API spend; meet contract caching terms |
| `doe_diesel_prices` (new) | DB agent | Free fuel-cost source, weekly refresh |
| `tenants.avg_mpg_by_equipment` | DB agent | Per-equipment MPG; configurable per tenant |
| `tenants.avg_deadhead_pct` | DB agent | Default deadhead assumption when no driver assigned |
| `tenants.toll_rate_per_mile` | DB agent | v1 toll heuristic |
| `tenants.profitability_check_enabled` | DB agent | Feature flag (per-tenant) |

### 5.4 Feature flag / paid plan

**Recommendation:** ship behind `tenants.profitability_check_enabled`. Default off. Paid plan tier ("Pro Dispatch" or similar) flips it on. Justification:
- DAT API license is meaningful $$ — we can't absorb it on the free tier.
- AI cost is small but it stacks at scale.
- Dispatchers are the buyer persona for this feature; tying it to the dispatch-heavy plan tier aligns price-to-value.

UI behavior when flag off: page is hidden from sidebar; direct-URL nav redirects to upgrade page.

---

## Section 6 — Open questions for product

> These are the items product needs to decide before implementation tickets get scoped. I will mirror this list as a comment on the FN-1619 Jira so each can be replied to inline.

1. **DAT vs Truckstop primary** — confirm DAT iQ Rateview as primary. We need a trial key + price quote before we can scope budget.
2. **Caching window** — DAT TOS often caps how long we can store rate snapshots. Is 6h business / 24h overnight acceptable? If TOS is stricter we need to revise the cache strategy.
3. **Pricing tier** — confirm the feature ships behind a paid plan flag. Which plan tier? Add-on?
4. **Per-tenant DAT license vs platform license** — does our license cover all tenants under one account, or do tenants self-onboard their DAT account? Materially changes onboarding UX.
5. **Confidence-band UX** — should the market-rate panel display a chart bar, a sparkline (15-day trend), or both? I leaned toward bar for v1; sparkline is a follow-up.
6. **Multi-stop loads in v1** — yes/no? I scoped it to v1 (Section 2.4). If v1 must be single-stop only, FE form simplifies but there's a "load type unsupported" path to handle.
7. **FSC split input (lineHaul + FSC) in v1** — I recommend ship combined-rate + toggle in v1, dedicated split fields in v1.1. OK?
8. **Broker history threshold** — minimum loads with broker (e.g., ≥3) to include in AI prompt? Below threshold the broker section is omitted to avoid spurious "trends" from a single load.
9. **Walk-away math** — AI walk-away currently = "fully loaded profit ≥ 0". Some carriers want "≥ target $/mi profit" instead. Configurable per tenant?
10. **Logging dispatcher feedback** — the wireframe has 👍/👎 buttons. Should we log these into `ai_feedback` (or similar) for prompt tuning? I'd add this; product needs to confirm.
11. **Where does the "Update offer" loop write?** — the recalc happens client-side. Does product also want the page to *post* the updated offer to the broker (email integration), or stop at the calculator step? I scoped only the calculator side — broker-comm is a separate ticket.
12. **Equipment-class taxonomy** — FleetNeuron uses `DRY_VAN | REEFER | FLATBED | STEPDECK`. DAT uses different identifiers (`V`, `R`, `F`, etc.). We need a mapping table; trivial but must be authoritative.

---

## Implementation ticket sketch (for handoff after this spike)

For visibility — these are the tickets I'd file under FN-1617 *after* product signs off on this doc. **Not in scope for FN-1619**:

| Ticket | Agent | Scope |
|---|---|---|
| Lane-rate cache + DAT integration | backend + database | `lane_rate_cache` table, `doe_diesel_prices` table, weekly DOE cron, DAT API client w/ mutex, `GET /api/loads/lane-rate` endpoint |
| Profitability calculator service | backend | `POST /api/loads/profitability-check` consuming the rate endpoint + tenant config, returning Section 2.3 schema |
| AI negotiation handler | ai | `load-negotiation-handler.js` per Section 3, route + RBAC, tests |
| Profitability Check page | frontend | New route, form, three result panels per Section 4, "Update offer" loop, feature-flag check |
| QA — Cypress + smoke | qa | Happy path, no-DAT-data path, AI-down path |
| Tenant settings UI | frontend | Edit MPG-by-equipment, deadhead %, toll rate, plan-flag toggle |
| Telemetry + feedback log | backend + database | 👍/👎 storage, AI cost dashboard |

## References

- FN-1617 (parent epic) — AI Tools Phase 2.
- FN-502 — Direct + Fully Loaded Profit. Cost-model anchor: `backend/packages/goodmen-shared/routes/reports.js:2851-3090`.
- FN-1431 / FN-1437 — AI load-to-driver match. Prompt-cache pattern reference: `backend/microservices/ai-service/src/handlers/load-driver-match-handler.js:271-284`.
- DAT Developer Portal — https://developer.dat.com (Rateview / Lane Rate APIs)
- Truckstop Ratemaker — https://www.truckstop.com/products/rate-insights/
- Greenscreens.ai — https://greenscreens.ai
- FreightWaves SONAR — https://sonar.freightwaves.com
- DOE EIA diesel prices — https://www.eia.gov/petroleum/gasdiesel/
