# FN-1621 — Daily Public-Market Briefing + Hot-Area Dispatching (Spike)

**Status:** Research only. No code changes in this PR. Outcome is a recommendation that product can sign off on before any of the implementation tickets (snapshot ingestor, scoring service, AI handler, FE card, schema) are scoped into the next sprint.

**Parent epic:** FN-1617 — AI Tools Phase 2.
**Extends (does not replace):** FN-1124 — Daily AI Briefing on Control Center (today's-operations card aggregating internal-tenant data: throughput, exceptions, driver/vehicle risk, recommended action).
**Honors:** FN-1610 — `localDate` query param contract on `/api/ai/briefing` (cache key includes resolved date; cross-tz callers don't share entries; `?refresh=true` bypasses cache).
**Related spike (sibling):** FN-1619 — per-load profitability + market-rate overlay. FN-1619 owns the **per-load** rate question (DAT iQ etc.); FN-1621 owns the **per-day, per-market** macro question (where to position, what to watch).

**Hard constraint:** must work entirely on **free** public data sources. Paid sources can be listed as "future enhancements" but the recommended architecture must ship without them.

**Glossary:**
- **Origin market** — a 3-digit-zip / KMA aggregation of where loads originate (e.g., `606` = Chicago, `750` = Dallas). Used as the geographic key for hot-lane scoring.
- **Equipment class** — Van / Reefer / Flatbed (the three classes that cover ~95% of US OTR volume; specialized is out-of-scope for this briefing).
- **Hot lane** — an `(origin_market, equipment_class)` pair scoring above a configurable threshold on the composite scoring formula (Section 2).
- **Snapshot** — a daily-frozen capture of all public-source data at briefing-build time. The unit of caching for the AI synthesis prompt.
- **Disruption event** — a discrete signal (hurricane, refinery outage, port strike) extracted from news/weather sources that materially affects 24-72h dispatch decisions.

---

## Section 1 — Public data source matrix

### 1.1 Source inventory

The brief must be buildable from free public data. Each row below is a source we can call without a paid contract today. "Access method" describes the most stable interface; "redistribution" is the practical constraint that limits what we can show users.

| # | Source | Signal type | Access method | Refresh cadence | Geographic granularity | Free-tier limit | Redistribution / ToS | Sample shape |
|---|--------|-------------|---------------|-----------------|------------------------|-----------------|----------------------|--------------|
| 1 | **EIA — Diesel weekly retail prices** (DOE) | Fuel cost | Public REST API (`api.eia.gov/v2`); also CSV download | Weekly, published Mon ~17:00 ET | 9 PADD regions + national | Free; API key required, no published cap (practically thousands/day) | Public domain (US gov data) | `{ period: "2026-05-04", duoarea: "PADD2", value: 3.812 }` USD/gal |
| 2 | **BLS — Producer Price Index, freight transportation (PCU484*)** | Macro freight pricing trend | Public REST API (`api.bls.gov/publicAPI/v2`); JSON | Monthly, mid-month | National (sub-series for general freight, LTL, courier) | 25 queries/day unregistered, 500/day registered | Public domain | `{ seriesID: "PCU484121484121", year: 2026, period: "M03", value: 153.2 }` |
| 3 | **BTS — Freight Analysis Framework + monthly transportation indicators** (Bureau of Transportation Stats) | Macro tonnage / mode share | CSV download from `bts.gov`; some Socrata API endpoints | Monthly (some quarterly) | National + state-level for FAF | Free | Public domain | CSV; columns vary by table (mode, origin_state, dest_state, value, year) |
| 4 | **NOAA — National Weather Service API** | Severe weather forecast | Public REST API (`api.weather.gov`); GeoJSON | Updated continuously; alerts every few minutes | Lat/lon → forecast office; alerts by FIPS county | Free; no key; rate limit ~unspecified, ~100 req/min reasonable | Public domain | Alerts: `{ event: "Hurricane Warning", area: "FLZ072", effective, expires, severity: "Extreme", certainty: "Observed" }` |
| 5 | **FreightWaves — public articles + RSS** | Disruption news / market commentary | RSS feed `freightwaves.com/feed`; HTML scrape for article body | Multiple posts/day | National + regional commentary | Free; reasonable scrape cadence | Articles copyrighted; **link out and quote ≤2 sentences only**. Internal AI summarization for our users is a fair-use grey area — keep snippets short, attribute, link the source. | RSS item: `{ title, link, pubDate, description (HTML excerpt) }` |
| 6 | **DAT public free trendlines (blog)** | National rate trend | HTML scrape of weekly blog post; sometimes embedded chart data | Weekly | National (no lane granularity) | Free | Article text copyrighted; chart numbers are factual and citable | Blog post text + embedded image URLs |
| 7 | **CME — diesel + freight futures quotes** (`cmegroup.com/markets`) | Forward fuel/freight sentiment | HTML scrape of public quote page (delayed quotes are free; real-time requires subscription) | 10-min delayed; updated continuously during market hours | Contract-level (e.g., HO front-month) | Free for delayed | Delayed quote redistribution restricted; **derived signal (e.g., "futures up 3.2% w/w") is fine** | `{ contract: "HOK6", last: 2.4582, change: +0.072, volume: 8420 }` |
| 8 | **Port authority dashboards** — Port of Los Angeles, Long Beach, NY/NJ, Savannah, Houston | Drayage / import volume | Mostly HTML scrape; LA Port has a JSON Signal API; Savannah has CSV | Daily to monthly depending on port | Per-port; LA/LB are most timely | Free | Public ops data; redistribution typically OK with attribution | Varies. LA Signal: `{ vessel, eta, teu, terminal }`; aggregated weekly TEU stats |
| 9 | **NOAA — weather discussion + 6-10 day outlook** | Forward weather | Public API (CPC outlooks via NWS) | Daily | CONUS regions | Free | Public domain | `{ forecast_period: "6-10day", region: "Northeast", temp_anomaly: "Above", precip_anomaly: "Above" }` |
| 10 | **NewsAPI.org** (or **GDELT 2.0**) | Disruption-event detection (strikes, accidents, hurricanes, refinery outages) | REST API; NewsAPI free tier 100 req/day, dev only — **for production switch to GDELT** (free, no auth, GDELT 2.0 GKG with article-level metadata) | NewsAPI: real-time; GDELT: 15-min batches | Article-level with geocoded mentions | NewsAPI free tier is dev-only; GDELT is unlimited | Article excerpts: same fair-use posture as FreightWaves | GDELT row: `{ DATE, SourceCommonName, DocumentIdentifier, V2Locations, V2Themes, V2Tone }` |
| 11 | **USDA — grain shipments / movements** (`ams.usda.gov` Grain Transportation Report) | Sector-specific freight signal (reefer + dry van for grain) | PDF + CSV download from AMS GTR weekly publication | Weekly (Thu) | Origin region (PNW, Gulf, MS River) | Free | Public domain | CSV: rail carloads, barge tons, ocean exports by week |
| 12 | **EIA — petroleum movements / pipeline flows** | Petroleum / hazmat freight signal | EIA REST API (different series than diesel retail) | Weekly + monthly | PADD-level | Free, same key as #1 | Public domain | `{ series: "WTTSTUS1", period, value }` |
| 13 | **State DOT 511 / road-condition feeds** | Road closures, work zones | Per-state APIs; many publish JSON or RSS (`511wi.gov`, `511ny.org`, etc.) | Real-time to hourly | State-level | Free | Public domain | Heterogeneous; `{ event_type: "closure", route: "I-94", county, start, end }` |
| 14 | **Twitter/X freight community** | Soft sentiment, disruption early-warning | API access is now paid (~$100/mo basic tier). **Defer.** Mastodon/Bluesky equivalents are nascent. | Real-time | National | Effectively unavailable on free tier in 2026 | ToS-fragile; not part of recommended architecture | — |
| 15 | **DAT iQ / Truckstop / SONAR APIs** (paid) | Spot + contract rates per lane | REST API | Daily | 3-digit zip | **Paid** — listed only as future enhancement (FN-1619 evaluates these for the **per-load** use case) | Strict redistribution restrictions | — |

**Sources actually used in the recommended architecture: 12** (#1–#13, excluding #14 paid social and #15 paid rate APIs). Acceptance criterion (≥8) met with margin.

### 1.2 Source classification (by reliability & decision weight)

| Tier | Sources | Role in scoring | Failure tolerance |
|------|---------|-----------------|-------------------|
| **Tier 1 — Hard signals** (numeric, structured, government-published) | EIA diesel (#1), BLS PPI (#2), BTS (#3), NOAA forecasts/alerts (#4, #9), USDA grain (#11), EIA petroleum (#12) | Drive numeric scoring features (fuel-cost penalty, weather-divert flag, sector-load signal) | Tolerable: cache last-known-good for up to staleness window (Section 5.4) |
| **Tier 2 — Soft signals** (commentary, futures sentiment, port dashboards) | FreightWaves RSS (#5), DAT blog (#6), CME futures (#7), port dashboards (#8), state 511 (#13) | Feed disruption-event extraction + qualitative narrative for the AI synthesis prompt | Tolerable: omit silently if source is down |
| **Tier 3 — Disruption-event detection** | GDELT/NewsAPI (#10) + NOAA alerts (#4) | Trigger event-driven score modifiers (hurricane, strike, refinery outage) | Tolerable: false positives filtered by relevance scoring (Section 2.3) |

**Why this tier structure matters:** the hot-lane score must remain computable on a day where any single Tier-2 source is down. Tier-1 sources are the floor. Tier-2 enriches the AI narrative. Tier-3 is opportunistic — a hurricane that happens to be in NOAA's alert feed doesn't need to also appear in the news API to fire the score modifier.

### 1.3 Why not just scrape one big source

Each source has a blind spot. EIA diesel is granular regionally but tells us nothing about weather. NOAA tells us about weather but nothing about retail import surges. FreightWaves articles are narrative but unstructured and copyrighted. The composite is the value-add — neither dispatcher nor LLM gets this picture from any single feed today. A single-source briefing is what FreightWaves itself sells; replicating that doesn't justify the build.

### 1.4 ToS and fair-use posture

- **Government sources (#1, #2, #3, #4, #9, #11, #12, #13)**: public domain. Redistribute freely.
- **FreightWaves / DAT blog (#5, #6)**: copyrighted. Standard fair-use posture: link to the source, quote ≤2 sentences in the AI summary, attribute by name. Do NOT republish the article. The LLM-generated narrative ("FreightWaves is reporting a Houston refinery outage; rates may pressure upward in PADD 3") is transformative use, but we should keep snippets short and link out.
- **CME futures (#7)**: delayed quotes are free; redistribution of the raw delayed feed is restricted. We compute and display **derived signals only** (e.g., "diesel futures up 3.2% week-over-week") — this is factual and not a redistribution of the quote feed.
- **Port dashboards (#8)**: most are public ops data; attribute by port name.
- **GDELT (#10)**: free, unrestricted, designed for redistribution of metadata. Use this over NewsAPI for production.

**Decision for FN-1621 implementation phase:** legal review of the FreightWaves snippet posture should happen before launch but is not a blocker for the spike.

### 1.5 Unsuitable / deferred sources

| Source | Why deferred |
|--------|--------------|
| Twitter/X | Paid API; ToS-fragile; sentiment value not worth the cost yet |
| DAT iQ / Truckstop / SONAR | Paid; FN-1619 evaluates for per-load rate question |
| Greenscreens.ai predictive lane prices | Paid; partner-only |
| Direct broker portals | Heterogeneous; per-broker integration; not a daily-snapshot fit |
| AIS vessel tracking (MarineTraffic free tier) | Free tier too limited for daily-snapshot ingest; port dashboards cover most of the same signal |

---

## Section 2 — Hot-lane scoring model

### 2.1 What "hot" means

A lane is **hot** when, on the next 24-72h horizon, dispatching a driver to originate from that market on that equipment class is expected to be more profitable than the average market for that class, *after* accounting for cost penalties (fuel, weather, congestion) and *plus* event-driven boosts (disruption recovery demand).

Output: a **composite score** in `[0, 100]` per `(origin_market, equipment_class)` pair, refreshed daily. ≥70 is "hot, target this." 30-70 is "neutral." <30 is "avoid (or only take inbound flat-rate)."

We compute scores for the **top ~50 origin markets** (covers 80%+ of US OTR volume) × 3 equipment classes = ~150 cells per day. This stays well within the AI prompt budget (Section 5.1).

### 2.2 Input signals

Each signal is normalized to `[-1, +1]` before weighting. Positive = bullish for hot-score; negative = bearish.

| Signal | Source(s) | Calculation | Default weight |
|--------|-----------|-------------|----------------|
| `S_fuel_trend` | EIA diesel (#1) | Δ% week-over-week of PADD price for the market's PADD region. **Sign-flipped** for outbound lanes (rising fuel = lanes from this region are *more* costly to run, so score down) but **boosted** for inbound flat-rate lanes (we model outbound here, so net negative). Clipped to ±10% → ±1.0. | -0.20 |
| `S_seasonal` | Calendar + USDA grain (#11), known produce-season calendar | Static seasonal multiplier per `(origin_market, equipment_class, week_of_year)`. E.g., CA reefer in May = +0.6 (produce season → Northeast), TX flatbed in June = +0.3 (oil patch summer build). Encoded as a lookup table (Section 2.4). | +0.25 |
| `S_weather_divert` | NOAA alerts (#4), 6-10 day outlook (#9) | If origin_market intersects an active severe-weather alert (`severity in {Severe, Extreme}` and `certainty in {Likely, Observed}` and `event in {Hurricane, Tornado, Blizzard, Flood, IceStorm}`), set to -1.0. Alert *adjacent* to market (neighboring counties) = -0.5. No alert = 0. | -0.20 |
| `S_port_pressure` | LA/LB Signal API + other port dashboards (#8) | For the 5 port-adjacent markets (LA `900-907`, LB `907-908`, NY/NJ `070-089`, Savannah `300-314`, Houston `770-775`): TEU throughput Δ% vs. trailing-4-week avg. Clipped to ±20% → ±1.0. Markets with no port = 0. Reefer + Flatbed get half-weight (port pressure is mostly a dry-van + drayage signal). | +0.15 (van), +0.075 (reefer/flat) |
| `S_macro_trend` | BLS PPI (#2) | Δ% month-over-month of PCU484 freight transportation index. Applied uniformly across all markets/classes (it's a national signal). Clipped to ±5% → ±1.0. | +0.10 |
| `S_disruption_event` | NOAA alerts (#4) + GDELT (#10) + state 511 (#13) | Event-driven boost when a discrete disruption is detected near origin_market. Pipeline outage → +0.4 for nearby markets (recovery demand). Hurricane → -0.8 for markets in path, +0.3 for adjacent markets in following 24-48h (recovery freight). Port strike → -0.6 for the affected port markets, +0.4 for nearest alternate ports. Recency-decayed (linear 0→7 days). See 2.3 for extraction. | +0.15 |
| `S_news_sentiment` | FreightWaves RSS (#5) + DAT blog (#6) + CME futures (#7) | LLM-extracted sentiment per market region: bullish (rates rising) +1.0, bearish -1.0, neutral 0. Used as a soft modifier; capped contribution prevents single-article noise from dominating. | +0.15 |

**Weights sum to 1.00 in absolute value.** They are configurable per tenant (Section 5.5) so a refrigerated-only carrier can dial up `S_seasonal` and zero out `S_port_pressure`, but the defaults above are calibrated for a generic mixed-fleet carrier.

### 2.3 Disruption-event extraction

A separate ingestor (runs ahead of scoring) builds a `disruption_events` table by:

1. **NOAA alerts**: subscribe to active alerts feed; filter to severe events; map FIPS county → 3-digit zip via a static crosswalk (USPS publishes one); persist `{ event_type, severity, polygon, effective, expires }`.
2. **GDELT 2.0 GKG**: every 15 min, query articles with `V2Themes` containing freight/transport themes (`ECON_DISRUPTION`, `MANMADE_DISASTER`, `WB_2024_TRANSPORT`, `STRIKE`, `INFRASTRUCTURE`) and `V2Locations` mentioning a US state. Pull article URL + tone score. Run a small Claude call (Haiku 4.5) to: (a) confirm freight-relevance, (b) extract the affected origin_markets, (c) classify event type + impact direction. Cache per article URL — same article ingested twice = no duplicate Claude call.
3. **State 511**: per-state pollers; map closures to the nearest 3-digit-zip origin_market; ignore short-duration (< 4h) closures.

The output is a single `disruption_events` table consumed by both the scoring formula and the AI synthesis prompt (so the narrative can cite events the score already weighted).

### 2.4 Composite score formula

```
raw_score = Σ (weight_i × signal_i)        # range roughly [-1, +1] given normalized inputs

# Map to 0-100 with neutral = 50:
score = clamp(round(50 + 50 × raw_score), 0, 100)
```

**Worked example: Atlanta van (origin_market = `303`), May 10**

| Signal | Value | Weight | Contribution |
|--------|-------|--------|--------------|
| `S_fuel_trend` | -0.4 (PADD 1C diesel +1.8% w/w → outbound lanes mildly penalized) | -0.20 | +0.08 |
| `S_seasonal` | +0.3 (Southeast May = early produce + general retail flow) | +0.25 | +0.075 |
| `S_weather_divert` | 0 (no active severe alerts) | -0.20 | 0 |
| `S_port_pressure` | 0 (Atlanta is not a port market) | +0.15 | 0 |
| `S_macro_trend` | +0.4 (PPI +0.6% m/m) | +0.10 | +0.04 |
| `S_disruption_event` | 0 (no active events) | +0.15 | 0 |
| `S_news_sentiment` | +0.3 (FreightWaves: "Southeast vans tightening into Mother's Day") | +0.15 | +0.045 |
| **raw_score** | | | **+0.24** |
| **score** | `50 + 50 × 0.24 = 62` (warm, slightly above neutral) | | |

### 2.5 Why this formula vs. an ML model

- **Auditability**: dispatchers will not trust an opaque score. A linear weighted sum lets the AI narrative say "Atlanta van is at 62 because seasonal demand and macro PPI lifted it slightly, despite fuel headwind." That is the unlock.
- **Cold-start**: we have no historical labeled data ("was this lane actually hot in retrospect?"). An ML model would need a backfill period to be useful; weighted sum ships day one.
- **Tunable per tenant**: tenant-overridable weights (Section 5.5) are trivial in a linear model and a research project in any other.
- **Sanity ceiling**: keep the linear model and revisit ML in a Phase-3 spike once we have ≥ 6 months of `score → tenant-converted-load` join data.

### 2.6 Threshold defaults

| Score range | Label | UI treatment |
|-------------|-------|--------------|
| 0-29 | Avoid | Red badge; the AI should recommend repositioning *out* of these markets |
| 30-69 | Neutral | No badge; default state |
| 70-100 | Hot | Green badge; surfaced in "Top 3 lanes to target tomorrow" if it intersects a market the carrier has drivers near |

Threshold = config knob, not a hard-coded literal.

---

## Section 3 — AI synthesis prompt

### 3.1 Inputs the prompt needs

| Block | Content | Cardinality | Cacheable? |
|-------|---------|-------------|------------|
| **A. System prompt** | Persona ("You are a freight dispatch advisor for a small US trucking carrier…"), output-shape rules, tone, disclaimer | Static | Yes — set cache breakpoint after this block. Shared across all tenants and days. |
| **B. Today's public-data snapshot** | The day's serialized signal table: top-50 markets × 3 classes scored, top-10 disruption events, fuel trend by PADD, FreightWaves headlines (≤5, ≤200 chars each, with source URLs), port pressure summary | Daily, ~3-5K tokens | Yes — set cache breakpoint after this block. Identical for every tenant on a given day. **This is the primary cache win.** |
| **C. Tenant fleet positioning** | Where this tenant's drivers are right now (last-known city + state), upcoming HOS rest windows, any in-progress loads with delivery date+location, equipment mix | Per tenant per call, ~500-2000 tokens | No. Varies by call. |
| **D. Tenant query / output structure** | "Now produce: Top 3 lanes to target tomorrow, Driver positioning recommendations, Disruptions to watch. Each item must cite specific data from block B." | Static | Yes — but tiny; cache wraps blocks A+B already. |

### 3.2 Cache architecture (Anthropic prompt caching)

Anthropic caching has a 5-minute TTL by default and 1-hour TTL with the extended-cache header. Cache breakpoints can be placed up to 4 times in a request.

```
[ System prompt ]               <-- cache_control: { type: "ephemeral" }       (breakpoint 1)
[ Today's snapshot block ]      <-- cache_control: { type: "ephemeral", ttl: "1h" }  (breakpoint 2)
[ Tenant fleet block ]          <-- no cache (varies per call)
[ Query block ]                 <-- no cache (small)
```

**Cache hit math.** Block B (the snapshot) is ~4K tokens. With 1-hour cache TTL and ~20 tenants kicking off briefings within the same hour-window when their local-day starts (most US tenants are CT/ET, so requests cluster between 04:00 and 09:00 ET), we expect:

- First tenant per day: cache miss on block B, cache write. Cost: full input tokens.
- Tenants 2-N within the cache hour: cache hit on B. Cost: cache-read price (~10% of input price for the cached portion at the time of writing). Effective ~90% savings on block B for everyone after the first.

For 20 tenants at ~5K tokens of cached content each: ~95K tokens of cache reads vs. 95K tokens at full input price = roughly the difference between $0.25/day and $0.025/day on that block alone. (Section 5.1 has the full cost model.)

**Cache invalidation:** when `?refresh=true` is passed (manual user refresh) we *don't* refetch the public snapshot — we only invalidate the per-tenant fleet block. The snapshot is canonical for the day and refetching it on every refresh defeats the cache. There is one exception: if a high-severity disruption event (NOAA Extreme alert, named storm landfall) is detected mid-day, the snapshot ingestor rebuilds and bumps a `snapshot_version`; subsequent requests get the new snapshot block and pay one cache miss. This is rare (≤1×/week typical) and is the right tradeoff.

### 3.3 Prompt structure

```
[BLOCK A — system, cached]
You are a freight dispatch advisor for a US trucking carrier. Your job is to
produce a daily market-and-positioning briefing that helps a dispatcher decide
where to send drivers tomorrow. Always:

- Cite specific data from the snapshot when making a claim ("FreightWaves
  reports..."; "EIA diesel up 1.8% in PADD 1C this week").
- Acknowledge uncertainty. Free public data does not give you spot rates by
  lane. You are giving direction, not a rate.
- Never recommend specific loads or brokers — your scope is lanes and markets.
- If the snapshot has flagged a market with `score < 30` for the carrier's
  equipment class, recommend repositioning *out* of that market unless it has
  inbound advantage.

Output JSON conforming to this schema (keys in this order):
{
  "top_lanes": [ { "origin_market": "303", "equipment_class": "Van", "score": 78, "rationale": "..." }, ... ],  // 3 items
  "driver_positioning": [ { "driver_id": "...", "current_location": "...", "recommendation": "...", "rationale": "..." }, ... ],
  "disruptions_to_watch": [ { "event": "...", "regions_affected": ["..."], "horizon_hours": 48, "implication": "..." }, ... ],
  "data_caveats": [ "..." ]   // any source that was stale or unavailable
}

[BLOCK B — daily public snapshot, cached, 1h TTL]
DATE: 2026-05-10 (in tenant's local timezone — see block C for tenant tz)
SNAPSHOT_VERSION: 2026-05-10-v1

Top scoring origin_markets × equipment_class (score >= 70):
- 303 (Atlanta) Van: 78  | Drivers: seasonal +, news +
- 606 (Chicago) Van: 74  | Drivers: macro +, port pressure (NY/NJ inbound) +
- 750 (Dallas)  Reefer: 73  | Drivers: seasonal +, fuel headwind
- ... [up to ~30 lines]

Avoid (score < 30):
- 070-089 (NY/NJ) Flatbed: 22  | hurricane forecast 36-72h
- 945 (Oakland) Reefer: 28     | port congestion + diesel headwind
- ... [up to ~10 lines]

Active disruptions (last 7d, recency-weighted):
- Hurricane Watch — FL panhandle, expected landfall 2026-05-12 14:00 EDT.
  Markets affected: 320-329, 360-368. Source: NOAA NWS (link).
- Refinery outage — Beaumont, TX. Diesel pressure expected PADD 3 next 14d.
  Source: EIA petroleum movements (link).
- ... [up to ~10 events]

Macro signals:
- EIA diesel: $3.812/gal national, +0.8% w/w; PADD 1C: +1.8%; PADD 5: -0.4%.
- BLS freight PPI: +0.6% m/m.
- CME diesel futures HOK6: 2.4582, +3.2% w/w (forward fuel pressure).
- LA/LB ports: TEU throughput +12% vs trailing-4w (inbound surge).

News (≤5 headlines, attributed):
- "Southeast van capacity tightens into Mother's Day" — FreightWaves
  (2026-05-08) — link
- ... [up to 5]

[BLOCK C — tenant context, NOT cached]
Tenant: <tenant_slug>
Timezone: America/Chicago
Local date: 2026-05-10
Equipment mix: 12 vans, 4 reefers, 0 flatbeds
Active drivers (last-known position):
- D-104  Smith     Atlanta GA      HOS reset complete 06:00 CT today
- D-118  Garcia    Memphis TN      HOS reset complete 11:00 CT today
- D-122  Patel     Joliet IL       in transit, delivers Indianapolis 14:00 CT
- ... [up to ~30 driver rows]

[BLOCK D — instruction, cached]
Now produce the briefing JSON for this tenant for 2026-05-10. Limit:
3 top_lanes, up to 5 driver_positioning items (only drivers reaching HOS reset
in next 24h), up to 3 disruptions_to_watch.
```

### 3.4 Model choice

- **Default: Claude Sonnet 4.6.** Strikes the right cost/quality balance for synthesis. Tier-1 reasoning over a structured snapshot is well within Sonnet's range; we do not need Opus's depth here, and Haiku's tone gets less defensible when explaining rationale.
- **Fallback for the GDELT relevance-filter sub-call: Haiku 4.5.** Per-article freight-relevance classification is a high-volume, low-stakes call.
- **Future swap: Opus 4.7 (1M context).** If a future enhancement adds a per-tenant historical-performance block ("you've historically made $X/mile out of Atlanta vs. $Y elsewhere"), that pushes context size up and the longer-context Opus may be worth the price differential. Out of scope for FN-1621.

### 3.5 Output validation

The handler validates the JSON output before returning to the gateway:

- Schema match (`top_lanes`, `driver_positioning`, `disruptions_to_watch`, `data_caveats`); reject + retry once on malformed.
- `top_lanes[].score` must match the snapshot — defends against the model fabricating numbers.
- `top_lanes[].origin_market` must exist in the snapshot's market list.
- Each `rationale` must reference at least one `[BLOCK B]` data point (regex check for `EIA|FreightWaves|NOAA|BLS|BTS|CME|port|disruption`); on miss, retry once with a stricter instruction.

This is the same validation pattern FN-1124's briefing handler uses.

---

## Section 4 — Integration plan with FN-1124

### 4.1 Don't replace, extend

FN-1124's briefing covers **internal-tenant operations** (today's loads, driver/vehicle exceptions, recommended next action). It is the answer to "what's happening in *my* fleet today." FN-1621 answers "what's happening in *the market* today, and what should I do about it." These are complementary, not overlapping. Keep FN-1124's card; add a sibling.

### 4.2 New service file

```
backend/microservices/ai-service/
  src/handlers/
    market-briefing-handler.js          # NEW — synthesis (this story's deliverable for impl phase)
  services/
    market-snapshot-aggregator.js       # NEW — builds the daily public-data snapshot (block B)
    market-snapshot-cache.js            # NEW — daily snapshot cache (DB-backed, see 4.4)
    disruption-event-ingestor.js        # NEW — separate scheduled job (cron-driven)
    scoring-service.js                  # NEW — applies the formula from Section 2
  prompts/
    market-briefing.md                  # NEW — block A system prompt
```

The existing FN-1124 paths (`briefing-aggregator.js`, `briefing-generator.js`, `briefing-cache.js`) stay untouched. We deliberately fork the file tree because:

- Snapshot cadence + cache key shape differ (FN-1124 = per-tenant per-day; FN-1621 = global per-day for the snapshot, per-tenant per-day for the AI output).
- Source dependencies differ wildly (FN-1124 calls internal services; FN-1621 calls public APIs and a snapshot table).
- Failure modes differ (FN-1124 fails when internal data is stale; FN-1621 fails when public APIs are down → must fall back to last-good snapshot).

Sharing a generator would couple two cache strategies and make a bug in one degrade the other.

### 4.3 Frontend — Control Center layout

Today (post-FN-1124):
```
Control Center
├── Today's Operations (Daily Briefing)   <-- FN-1124
├── 7-day Trends
└── ... other widgets
```

After FN-1621 implementation:
```
Control Center
├── Today's Operations (Daily Briefing)   <-- FN-1124 (unchanged)
├── Market & Positioning                  <-- NEW (this story)
├── 7-day Trends
└── ... other widgets
```

Both briefing cards share the same loading-skeleton component, manual-refresh button, and a11y patterns from FN-1124. The new card has three subsections (Top Lanes, Driver Positioning, Disruptions to Watch) matching the JSON output shape from 3.3. Subsection 3 (Disruptions) is collapsible and defaults collapsed when there are zero events.

### 4.4 Database schema — recommendation: **sibling table, not extending FN-1124's**

FN-1124 stores a per-tenant briefing record. The market briefing has two distinct write paths with different cardinality:

1. **The daily public snapshot** (block B in 3.3) — global, one row per `(date, snapshot_version)`. Shared across tenants; the cache win in 3.2 depends on this not being per-tenant.
2. **The per-tenant market briefing output** — one row per `(tenant_id, local_date)`.

Trying to fit both into FN-1124's `daily_briefings` table (which is per-tenant-per-day) forces either denormalization (snapshot duplicated per tenant) or a JSON blob that hides the global vs. per-tenant boundary. Both are worse than the sibling-table option.

**Recommended schema:**

```sql
-- Global daily snapshot (NOT per-tenant). Drives the cached prompt block B.
CREATE TABLE market_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date   DATE NOT NULL,
  snapshot_version INT  NOT NULL DEFAULT 1,
  built_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scoring_payload JSONB NOT NULL,    -- the table from 3.3 block B
  events_payload  JSONB NOT NULL,    -- disruption events
  macro_payload   JSONB NOT NULL,    -- fuel, PPI, futures
  news_payload    JSONB NOT NULL,    -- FreightWaves/DAT/CME headlines + sources
  source_health   JSONB NOT NULL,    -- which sources succeeded/failed at build time
  UNIQUE (snapshot_date, snapshot_version)
);
CREATE INDEX market_snapshots_date_idx ON market_snapshots (snapshot_date DESC);

-- Disruption events (separate so we can recency-weight without rebuilding snapshot rows).
CREATE TABLE disruption_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL,     -- 'hurricane' | 'strike' | 'refinery_outage' | ...
  source          TEXT NOT NULL,     -- 'NOAA' | 'GDELT' | 'state_511'
  source_url      TEXT,
  source_event_id TEXT,              -- for dedup; (source, source_event_id) UNIQUE
  severity        TEXT,
  effective_at    TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ,
  affected_markets TEXT[],           -- 3-digit zip prefixes
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_event_id)
);
CREATE INDEX disruption_events_active_idx
  ON disruption_events (effective_at DESC) WHERE expires_at IS NULL OR expires_at > NOW();
CREATE INDEX disruption_events_markets_idx ON disruption_events USING GIN (affected_markets);

-- Per-tenant market briefing output (one row per tenant per local date).
CREATE TABLE tenant_market_briefings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  local_date      DATE NOT NULL,                      -- tenant-local, NOT UTC (FN-1610)
  snapshot_id     UUID NOT NULL REFERENCES market_snapshots(id),
  briefing_json   JSONB NOT NULL,                     -- the AI output from 3.3
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prompt_tokens   INT,
  cached_tokens   INT,
  output_tokens   INT,
  cost_usd_micro  BIGINT,
  UNIQUE (tenant_id, local_date)
);
CREATE INDEX tenant_market_briefings_tenant_date_idx
  ON tenant_market_briefings (tenant_id, local_date DESC);
```

**Why three tables, not one big one:**

- `market_snapshots` is global and large (multi-KB JSON); duplicating per-tenant blows up storage and breaks the prompt-cache strategy.
- `disruption_events` has a distinct lifecycle (events expire; events are queried by region GIN index); merging into the snapshot blob defeats both.
- `tenant_market_briefings` mirrors FN-1124's `daily_briefings` shape on purpose so the FE briefing-card component can be parameterized over briefing-source.

Migration writer: backend/database agent. Estimated 1 migration file.

### 4.5 Timezone (FN-1610 contract)

The new `GET /api/ai/market-briefing` endpoint follows the same `localDate` contract FN-1610 introduced:

- Accepts `?localDate=YYYY-MM-DD` (strict regex). Malformed → 400. Absent → falls back to `new Date().toISOString().slice(0,10)`.
- The cache key for `tenant_market_briefings` is `(tenant_id, local_date)`. Two users in different timezones on the same calendar day get different rows when the date crosses local-midnight, exactly as FN-1610 intended.
- `?refresh=true` invalidates the per-tenant briefing row (forces AI re-synthesis using current snapshot) but does NOT rebuild the snapshot — see 3.2 cache invalidation.
- The snapshot itself is keyed by `snapshot_date` in **US Eastern** (the canonical financial / freight-market day). One snapshot per calendar day in ET. A tenant in Hawaii calling at 02:00 HST on May 10 would get the May 9 ET snapshot — that is correct because the freight market hasn't moved yet, even though the tenant's local clock has.

This bifurcation (per-tenant briefing in tenant local time, snapshot in canonical ET) is intentional and worth documenting. The alternative (snapshot per timezone) explodes the cache without adding accuracy.

### 4.6 Endpoint shape

```
GET /api/ai/market-briefing?localDate=YYYY-MM-DD&refresh=true

Response (200):
{
  "tenant_id": "...",
  "local_date": "2026-05-10",
  "snapshot_date": "2026-05-10",      // ET-canonical; may differ from local_date for HI/AK tenants
  "generated_at": "2026-05-10T12:04:18Z",
  "briefing": {                        // schema from 3.3
    "top_lanes": [...],
    "driver_positioning": [...],
    "disruptions_to_watch": [...],
    "data_caveats": [...]
  },
  "source_health": {                   // surfaced for transparency
    "eia_diesel": "ok",
    "noaa_alerts": "ok",
    "freightwaves_rss": "stale_2h",
    ...
  }
}
```

Gateway proxies through `services/api-gateway/routes/ai.js` (same pattern as `/api/ai/briefing` from FN-1141). No new auth; reuses existing tenant-scoped JWT.

---

## Section 5 — Cost / capacity

### 5.1 Per-call AI cost (Sonnet 4.6 pricing as of 2026-05; published per-MTok)

Assume:
- Block A (system, cached): ~600 tokens
- Block B (snapshot, cached, 1h TTL): ~4,000 tokens
- Block C (tenant fleet, not cached): ~1,200 tokens
- Block D (instruction, cached): ~200 tokens
- Output: ~700 tokens

**Per-tenant cost components per briefing call:**

| Component | Tokens | Rate (Sonnet 4.6, per MTok) | Cost |
|-----------|--------|------------------------------|------|
| Cache write (first tenant of the day, 1h TTL block) | 4,800 | ~$3.75 (cache-write 1h) | ~$0.018 — paid ONCE per day across all tenants |
| Cache read (every subsequent tenant within 1h) | 4,800 | ~$0.30 (cache-read) | ~$0.0014 |
| Non-cached input (block C) | 1,200 | ~$3.00 | ~$0.0036 |
| Output | 700 | ~$15.00 | ~$0.0105 |
| **Per call (cache hit)** | | | **~$0.015** |
| **Per call (cache miss, first of day)** | | | **~$0.032** |

(Anthropic pricing changes; we will pin actual numbers in the implementation story.)

### 5.2 Daily fleet-wide cost projections

| Tenant scale | Briefings / day (1 per tenant per call) | Daily cost | Monthly cost |
|--------------|-----------------------------------------|------------|--------------|
| 20 tenants (current) | 20 | ~$0.30 | ~$9 |
| 100 tenants | 100 | ~$1.55 | ~$47 |
| 500 tenants | 500 | ~$7.55 | ~$226 |
| 2000 tenants | 2000 | ~$30 | ~$900 |

Refreshes (`?refresh=true`) cost the per-call rate again but only on the per-tenant block C+output (snapshot cache stays hot), so a 3× refresh-rate adds ~$0.015 per refresh.

**Plus disruption-event filter sub-calls (Haiku 4.5, GDELT relevance):** ~50-200 articles/day after pre-filter, ~500 input + 50 output tokens each. At Haiku rates (~$1/MTok input, ~$5/MTok output): **~$0.05-$0.20 per day total, all tenants**. Negligible.

**Plus ingestion infra:** the snapshot ingestor is a single scheduled job. No per-tenant cost. Compute is a Render cron + a few HTTP calls; well under a few cents per day on Render.

### 5.3 External API rate limits at our scale

| API | Free tier limit | Calls/day in steady state | Headroom |
|-----|-----------------|---------------------------|----------|
| EIA (#1, #12) | unpublished, ~thousands/day | ~10 (1 PADD diesel pull, 1 petroleum pull, ~8 historical refresh queries) | Plenty |
| BLS (#2) | 500/day registered | ~1 | Plenty |
| BTS (#3) | unspecified | ~1/month | Plenty |
| NOAA NWS (#4, #9) | ~100 req/min reasonable | ~50 (alerts + outlook polls every 30 min during day) | Plenty |
| FreightWaves RSS (#5) | none documented; respect robots.txt | ~24 (hourly) | Plenty |
| DAT blog scrape (#6) | none | ~7/week | Plenty |
| CME quote scrape (#7) | none, but bot detection — use a courteous UA + ≤1 req/min | ~10 | Plenty |
| Port APIs (#8) | varies; LA Signal ~10K/day; others lower | ~5 per port × 5 ports = ~25 | Plenty |
| GDELT (#10) | unlimited | ~96 (every 15 min) | Plenty |
| USDA AMS (#11) | none | ~1/week | Plenty |
| State 511 (#13) | varies; most uncapped | ~30 (hourly across 5-10 priority states) | Plenty |

We are nowhere near any rate limit at our current or projected tenant scale. The constraint is **politeness** (proper User-Agent string, exponential backoff on 429/503) not the headline limit.

### 5.4 Reliability — what happens when a source is down

Source health is recorded in `market_snapshots.source_health` (Section 4.4) and surfaced in `data_caveats` in the AI output (Section 3.5).

| Source down | Behavior | Staleness tolerance |
|-------------|----------|---------------------|
| EIA diesel API down for the daily build | Reuse last-known-good values from the previous snapshot; tag `eia_diesel: "stale_<N>d"` in source_health. Fuel-trend signal Δ% gets recomputed against last-good baseline | Up to 14d before the signal is dropped (zeroed) and a `data_caveats` entry warns the user |
| NOAA alerts down | Skip the alert-driven `S_weather_divert` modifier; data_caveats: "Severe weather monitoring unavailable, treat regional weather conditions independently" | Drop after 6h of failure |
| FreightWaves RSS down | Skip news block; AI is instructed to omit the news-sentiment modifier rationale | Drop after 24h |
| GDELT down | Skip event-driven modifiers from news; NOAA + state-511 still feed disruption_events | Drop after 24h |
| **Snapshot build fails entirely** (5+ sources unreachable) | DO NOT generate a stale briefing. Return the previous day's briefing with a clear `local_date_mismatch` flag and an FE-side "We weren't able to refresh today's market view" banner. Page on-call. | Hard fail at 2 build attempts |
| AI service (Anthropic) down | Return the cached `tenant_market_briefings` row from yesterday with a banner; same FE pattern as FN-1124. | 24h |

The pattern is **degrade gracefully, surface the degradation honestly**. We never fabricate by silently substituting old data; we always tag staleness.

### 5.5 Per-tenant configuration (deferred to follow-up story)

Out-of-scope for the spike but worth noting so the data model isn't surprised by it later:

- Tenant-level overrides for scoring weights (Section 2.2): a refrigerated-only carrier zeros out `S_port_pressure` (drayage signal) and dials up `S_seasonal`.
- Tenant-level market filter: only show top-lanes within X miles of the tenant's home base.
- Tenant-level equipment filter: hide flatbed scoring for a van-only carrier.

These slot into a `tenant_market_briefing_config` table (not in the recommended schema above; add when the configuration story is sized).

---

## Section 6 — Open questions

1. **FreightWaves snippet legal posture** — fair-use call for ≤2-sentence quotes with attribution + link is industry-standard but unverified by counsel. Action: 30-minute legal review before launching. Spike does not block on this.

2. **Snapshot canonical timezone** — Section 4.5 picks ET as the snapshot's canonical day. Does the product care about HI/AK tenants getting "yesterday's snapshot" until ~04:00 local? If yes, the alternative is two snapshots per day (ET and PT/local) — doubles the snapshot build cost but doesn't double the AI cost (cache still works per-snapshot). Recommend: ship single ET snapshot first; revisit if HI/AK tenants exist and complain.

3. **Disruption-event impact direction** — Section 2.3 defines "hurricane → -0.8 in path, +0.3 adjacent for 24-48h recovery." That recovery boost is a heuristic. Validate against historical data (FEMA disaster declarations × DAT public trend articles 7-day-after, if reachable) before locking the multipliers.

4. **GDELT filter precision** — GDELT's V2Themes is broad. Initial Haiku-relevance pass might still let 30-40% noise through. If false-positive rate stays high after week 1 of implementation, options: (a) tighten GDELT theme allowlist, (b) add a secondary Sonnet pass for high-tone articles, (c) require ≥2 source corroboration before persisting an event. Recommend (a) first.

5. **Per-tenant personalization vs. global synthesis** — current architecture does ONE Sonnet synthesis call per tenant per day, with the snapshot block cached. An alternative is ONE synthesis call globally (produce "the day's market narrative" once) + a per-tenant Haiku that personalizes for the tenant's drivers. Tradeoff: cheaper (~$0.005/tenant) but the cross-block consistency suffers (the global narrative cites lanes the tenant has no drivers near). Recommend: stick with per-tenant Sonnet at $0.015 — the consistency is worth $0.30/day at 20 tenants.

6. **Weighted weights** — Section 2.2 defaults are estimates, not calibrated. Validation plan: implementation story should backfill 30 days of public data, generate retrospective scores, and have product spot-check 5-10 lanes against "did we / would we have actually wanted to dispatch there?" judgements. Adjust weights once before GA.

7. **Disruption event UI** — should disruptions also surface as proactive alerts (push notification, email) when they crop up mid-day, or only inside the daily briefing card? Suspect "push for severity=Extreme NOAA events only." Out of scope for FN-1621; appropriate as a follow-up story.

8. **Storage cost** — `market_snapshots` rows are large (~50KB JSON each). At 1 row/day = ~18 MB/year. Negligible. Retention: keep all forever for analytics; revisit at 5+ years.

9. **Backfill strategy for the news-sentiment LLM extraction** — first day of running, GDELT has 7+ days of historical articles. Do we backfill (cost: ~$5 one-time) or skip and let the index build prospectively? Recommend: backfill 30 days, cost is one-time and gives Section 6.6's calibration material.

---

## Recommended next-steps (out-of-spike implementation tickets)

If product approves this direction, the implementation phase decomposes into:

1. **DB migration** — three tables from Section 4.4 (database agent).
2. **Snapshot ingestor** — `market-snapshot-aggregator.js` + per-source pollers (ai or backend agent; lean ai because the disruption-relevance Haiku call lives here).
3. **Scoring service** — `scoring-service.js` implementing Section 2 formula (ai agent).
4. **Market briefing handler** — `market-briefing-handler.js` calling Sonnet with the cached prompt structure (ai agent).
5. **Gateway endpoint** — `GET /api/ai/market-briefing` proxy + localDate validation (backend agent).
6. **Frontend card** — `<app-market-briefing-card>` on Control Center (frontend agent).
7. **QA validation** — cache hit/miss verification, cross-tz isolation, source-down degradation, screenshots (qa agent).

Estimated story point spread: ~21 SP across the 7 subtasks.
