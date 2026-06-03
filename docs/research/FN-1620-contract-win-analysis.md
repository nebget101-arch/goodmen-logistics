# FN-1620 — AI dedicated-freight contract win analysis (research spike)

**Status:** Research-only. No code in this story.
**Parent epic:** FN-1617 — AI Tools Phase 2 — Strategic dispatch, market intelligence, partner integrations.
**Branch:** `agent/ai/FN-1620/contract-win-spike`
**Author:** ai-agent
**Date:** 2026-05-09

## Recommendation up front

A useful "AI contract-win helper" is feasible in **two phases of dramatically different cost and risk**:

- **Phase 2a (4–6 weeks, low risk, high value):** Ingest **SAM.gov** (free, structured, public-domain) and **SEC EDGAR** (free, public-domain) into a `rfp_opportunities` table. Score per-tenant fit using the FN-1411 FMCSA reference dataset + internal lane/equipment history. Two-call AI architecture (probability + strategy). Surface as a daily-briefing card and a new "Opportunities" page. **Recommend pursuing.**
- **Phase 2b (6+ months, high risk, deferred):** Direct shipper portals (Walmart Connect, Amazon Relay, Target supplier portals) and paid load boards (DAT, Truckstop, GovWin IQ, BidNet). All require either a shipper relationship, a paid contract, or both. **Recommend deferring** until Phase 2a is in market and we have signal that customers want it.

Phase 2a alone gives carriers a real edge — there are tens of thousands of govt freight RFPs/IDIQs and shipper-spend signals that nobody on a small carrier team has time to read. Phase 2b is a "go big or skip it" call that depends on partnership economics that don't exist today.

The rest of this doc backs that recommendation.

---

## Section 1 — RFP / opportunity sources matrix

The eight sources surveyed below are the realistic universe. They split cleanly into three tiers: free + structured, free + unstructured, paid. We should build only on the first tier in this epic.

| # | Source | Cost | Access | Refresh | Dedicated-lane signal | Recommended use |
|---|---|---|---|---|---|---|
| 1 | **SAM.gov** (System for Award Management — federal contracting) | Free | Structured REST API + bulk extracts (`api.sam.gov/opportunities/v2/search`) | Real-time, ~daily new postings | High — USPS HCR, USDA AMS, DoD MTMC freight solicitations are explicit dedicated lanes/IDIQs | **Tier 1.** Primary ingest. Filter by NAICS `484110` (general freight, long-distance, truckload), `484121` (LTL), `484122`, `492110`. |
| 2 | **SEC EDGAR** 10-K / 10-Q filings | Free | Structured REST API + bulk index files; full-text search via `efts.sec.gov` | Quarterly | Indirect — shipper freight-spend disclosures, Scope 3 emissions commitments, growth signals (new DCs, new product lines) | **Tier 1.** Secondary signal. Use to enrich shipper-fit features and to surface "shippers worth direct outreach" leads. |
| 3 | **State DOT bid boards** (e.g., Texas DIR, California Caltrans, NY OGS) | Free | Per-state HTML or RFP portals; some have RSS, most need scraping | Per-agency, weekly–daily | Medium — state-level freight, ag & equipment moves, government fleet shop services | **Tier 1, deferred.** Aggregator workload (~50 portals); add after SAM.gov is live and we have a pattern. |
| 4 | **FreightWaves Marketplace / SONAR API** | Mixed (read-only marketplace listings free; SONAR rate-data is paid) | Public listings via web scrape; SONAR via paid API | Hourly | Low–medium — skews spot, not dedicated, but lane-rate context useful for bid-pricing features | **Tier 2.** Skip for opportunity discovery; revisit later for **rate enrichment** in the strategy generator. |
| 5 | **DAT Power / DAT Loadboards / Truckstop dedicated boards** | Paid (DAT Power ~$60–150/mo per seat; broker plans more) | Authenticated REST API for paying customers | Real-time | Medium — most listings are spot, but "dedicated" filter exists and is heavily used by mid-size carriers | **Tier 3.** Only worth integrating if a customer brings their own DAT credentials; build OAuth-style BYO-creds rather than a platform license. |
| 6 | **Direct shipper portals — Walmart Connect, Amazon Relay, Target, Schneider Logistics, JB Hunt 360** | Free to register, but **only carriers with an existing shipper relationship can see RFPs** | Authenticated portals, no public API; Amazon Relay has a partner API for select carriers | Per-shipper, varies | Highest quality — these *are* the dedicated contracts | **Tier 3 / Phase 2b.** Document as "customer brings credentials" path; not a platform-level integration in the foreseeable roadmap. |
| 7 | **GovWin IQ / BidNet Direct** (state/local govt aggregators) | Paid ($3k–10k/yr per seat) | Web UI + API for enterprise plans | Daily | Medium-high — captures the state/local 90% that SAM.gov misses | **Tier 3.** Add if Phase 2a customer feedback says "good, but I need state/local too." |
| 8 | **BLS QCEW + Census County Business Patterns** (employer freight-spend proxies) | Free | Bulk CSV / Census API | Quarterly / annual | Indirect — county-level shipper-density signal, useful for outbound prospecting | **Tier 1, optional.** Cheap, useful for identifying *underserved* lanes (lanes with high shipper density and few large carriers). Add in iteration 2 of Phase 2a. |

**Source count: 8 surveyed (target: ≥6). Tier-1 build set: SAM.gov + EDGAR (mandatory), state DOT boards + BLS QCEW (iteration 2, optional).**

### Why we are not building on Tier 2/3 in this epic

The non-free, non-public-domain sources fail one of three tests:
- **Acquisition cost > project budget** — a per-tenant DAT or GovWin license dwarfs the AI infra cost.
- **Per-tenant credential model** — Amazon Relay etc. only work as "BYO-credentials" integrations, which is a different product (an OAuth/RPA layer, not a sourcing pipeline).
- **No public-domain redistribution rights** — even where we *can* read the data, our ToS doesn't let us aggregate and resurface it across tenants.

Building only on Tier 1 means everything in `rfp_opportunities` is freely redistributable across tenants and we can rank/recommend without per-tenant credential plumbing.

---

## Section 2 — Carrier-fit scoring features

The scoring model takes one carrier (one FN tenant) and one RFP and produces fit features. All inputs below are already available in FleetNeuron once FN-1411 (FMCSA reference dataset) lands, plus a handful of internal joins.

### 2.1 From FN-1411 FMCSA reference dataset (`fmcsa.*` schema)

Joined by `dot_number` on the carrier's tenant record:

| Feature | Source table (FN-1411) | Why it matters |
|---|---|---|
| `safetyRating` | `fmcsa.carriers` | Federal contracts often require Satisfactory or Conditional+. |
| `smsBasicScores` (Unsafe Driving, HOS, Driver Fitness, Controlled Substances, Vehicle Maintenance, HM, Crash) | `fmcsa.basic_scores` | Threshold-based filters in many shipper RFPs ("must be below X percentile in Unsafe Driving"). |
| `inspectionPassRate` (last 24 months) | `fmcsa.inspections` | Direct quality signal for win probability. |
| `crashCount24mo`, `crashSeverityScore` | `fmcsa.crashes` | Insurance underwriting proxy. |
| `authorityAgeYears` | `fmcsa.authorities` (`grant_date`) | Many RFPs require ≥3 yrs authority. Hard filter. |
| `fleetSize` (power units) | `fmcsa.carriers` | Hard filter — RFP minimum lane capacity. |
| `operatingStatus`, `outOfServiceDate` | `fmcsa.carriers` | Hard filter — must be Active. |
| `insuranceOnFile` (BIPD, Cargo) | `fmcsa.carriers` | Hard filter — most shippers require BIPD ≥ $1M. |

### 2.2 From internal FleetNeuron data

| Feature | Source | Why it matters |
|---|---|---|
| `lanesServed` (unique O–D state/MSA pairs in last 12 mo) | `loads` (existing) | Lane-overlap match with the RFP's stated lanes. |
| `equipmentMix` (counts by trailer type: dry van, reefer, flatbed, step deck, etc.) | `vehicles` + `vehicle_types` | Hard filter — RFP names equipment. |
| `onTimePickupRate`, `onTimeDeliveryRate` (last 12 mo) | `loads.actual_pickup_at`, `loads.actual_delivery_at` vs `scheduled_*` | Quality signal; many RFPs ask for KPI evidence. |
| `driverPoolSize` (active + qualified) | `drivers` (active=true) | Capacity signal for high-volume contracts. |
| `dedicatedExperience` (count of past loads tagged dedicated) | `loads.is_dedicated` flag (new field — part of Phase 2 if not present) | Past dedicated wins predict future ones. |
| `factoringDependency` / `cashRunway` (proxy) | Existing settlements + invoices tables, or Spike A output if delivered | Financial-stability signal — large shippers run D&B checks. |

### 2.3 From shipper public data (SEC EDGAR enrichment)

For every named shipper in an RFP we look up the EDGAR CIK and pull:

| Feature | Source | Why it matters |
|---|---|---|
| `shipperFreightSpendUsd` | 10-K (logistics/distribution expense lines) | Sets the scale of the contract. |
| `shipperSustainabilityCommitments` | 10-K, sustainability reports | Carriers with newer / cleaner equipment are favored. |
| `shipperGrowthSignals` (new DC announcements, new SKUs, M&A) | 8-K filings | Lane-creation signals. |
| `shipperCarrierProgramReferences` | 10-K Risk Factors and MD&A sections | Reveals if shipper has an existing dedicated-carrier program. |

### 2.4 Lane-match signal (the most important single feature)

A dedicated RFP names lanes (e.g., "Joliet IL → DFW TX, 8 round trips/week, 53' dry van"). The lane-match score combines:
- **Direct overlap:** does the carrier already run loads in this O–D pair? (binary, weighted heavily)
- **State-pair overlap:** has the carrier run any state-pair containing the RFP origin or destination state? (broader signal)
- **Extension feasibility:** distance from the carrier's existing footprint to the RFP origin (deadhead cost proxy)
- **Equipment overlap:** is the carrier's `equipmentMix` capable of the RFP's spec?

Lane-match is computed in SQL (no AI required) and passed as a structured numeric feature into the AI win-probability call.

---

## Section 3 — AI scoring + strategy model

Two distinct Claude calls, by design. Mixing them produces worse outputs because the first is a calibration task and the second is a generation task, and they reward different prompt styles.

### 3.1 Call 1 — Win-probability scorer

**Model:** `claude-haiku-4-5-20251001` (latency- and cost-sensitive; used for batch nightly scoring of every RFP × every tenant pair).

**Input shape:**
```jsonc
{
  "rfp": {
    "source": "sam.gov",
    "id": "SAM-12345",
    "agency": "USPS",
    "lanes": [{ "origin": "Memphis, TN", "destination": "Chicago, IL", "distanceMiles": 540 }],
    "equipmentRequired": "53' dry van",
    "weeklyVolume": "10 round trips",
    "contractTermMonths": 36,
    "estimatedAnnualValueUsd": 4500000,
    "minRequirements": {
      "authorityAgeYears": 3,
      "satisfactoryRatingRequired": true,
      "minBipdInsuranceUsd": 1000000
    }
  },
  "carrier": {
    "dotNumber": 1234567,
    "fleetSize": 42,
    "lanesServed": [["Memphis, TN", "St Louis, MO"], ["Chicago, IL", "Indianapolis, IN"]],
    "equipmentMix": { "dryVan53": 38, "reefer": 4 },
    "smsBasicScores": { "unsafeDriving": 22, "hos": 15, "driverFitness": 8, "vehicleMaintenance": 30 },
    "authorityAgeYears": 7,
    "safetyRating": "Satisfactory",
    "insurance": { "bipdUsd": 1000000, "cargoUsd": 100000 },
    "onTimeDeliveryRate12mo": 0.962,
    "dedicatedExperience": 3,
    "laneMatchScore": 0.42
  }
}
```

**Output schema (strict JSON, validated server-side):**
```jsonc
{
  "winProbability": 0.0,        // 0..1
  "confidence": "low|medium|high",
  "topStrengthFactors": ["string", "..."],   // ≤5
  "topRiskFactors": ["string", "..."],       // ≤5
  "hardDisqualifiers": ["string", "..."]     // empty if none
}
```

**Prompt strategy:**
- System prompt: ~2,500 tokens, **cached**. Defines the model's role, the rubric (how to weight lane match vs SMS scores vs authority age), the output schema, and a few-shot of three diverse historical RFPs with hand-labeled scores.
- User prompt: the JSON above. ~500 tokens.
- Temperature: `0.0` (we want consistent calibration).
- Output is JSON-mode (`response_format: { type: "json_object" }`) and validated against the schema; on validation failure we retry once with a "your previous output was invalid because X" turn.

**Why caching matters:** every tenant × RFP scoring call shares the same system prompt. A nightly batch over (say) 200 tenants × 500 RFPs = 100k calls. Without caching, the system prompt is re-billed 100k times. Cache TTL is 5 min, so we batch all calls for one tenant together and run sequentially within the window.

**Cost estimate** (Haiku 4.5, post-cache):
- System prompt ~2.5k tokens, cached read ~$0.10 / Mtok → ~$0.00025 per call after first.
- User prompt + output ~700 tokens at standard price.
- ~**$0.001 per scoring call**, or ~**$100 / day** for 100k calls. Acceptable.

### 3.2 Call 2 — Strategy generator

**Model:** `claude-sonnet-4-6` (quality matters; called only on opportunities the user clicks into, ~10s of times per day per tenant, not 100k).

**Input:** same `rfp` and `carrier` blocks as Call 1, **plus** Call 1's output (`winProbability`, `topStrengthFactors`, `topRiskFactors`, `hardDisqualifiers`), **plus** EDGAR-derived shipper context.

**Output schema:**
```jsonc
{
  "executiveSummary": "string",            // 2–3 sentences
  "recommendedBidUsd": { "perMile": 0, "perStop": 0, "fuelSurchargeFormula": "string" },
  "mustHaveDifferentiators": ["string", "..."],
  "talkingPoints": [{ "topic": "string", "evidence": "string" }],
  "proposalOutline": "string (markdown)",
  "redFlagsToAddress": ["string", "..."],
  "nextSteps": ["string", "..."]
}
```

**Prompt strategy:**
- System prompt: ~3,500 tokens, **cached** (per-tenant suffix on the system prompt for tenant brand voice / past wins; cache hit rate slightly lower but still high).
- Two-tier cache: (1) global rubric, (2) per-tenant context (their wins, their service guarantees, their fleet profile).
- Temperature: `0.4` — needs some creativity in talking points.
- We do **not** ask Claude to produce the actual proposal document; the outline + talking points feed into a human-edited draft.

**Where it lives in code:**
- Both handlers live in `backend/microservices/ai-service/src/handlers/`.
- Suggested filenames: `contract-win-scorer.handler.ts` and `contract-win-strategy.handler.ts`.
- Exposed via REST: `POST /api/ai/opportunities/score` and `POST /api/ai/opportunities/:id/strategy`.
- Both routed through the existing `gateway` per `.agent/docs/render_services.md` (`fleetneuron-logistics-gateway` → `fleetneuron-ai-service`).

### 3.3 Why two calls instead of one

Three reasons:
1. **Cost shape.** Call 1 runs nightly on every (tenant × RFP) pair (high volume, cheap model). Call 2 only runs on opportunities a user clicks (low volume, expensive model). One mega-prompt would force us to use Sonnet on every pair, ~10× the budget.
2. **Determinism vs creativity.** Calibration and proposal-writing want different temperatures and different few-shot patterns. Splitting them lets each prompt do one job well.
3. **Auditability.** A separate scoring call gives us a numeric `winProbability` we can log, calibrate over time against actual wins, and use as the rank order in the Opportunities page. A combined call would bury that number inside prose.

---

## Section 4 — Ingest pipeline sketch

### 4.1 New worker

A new long-running job: **`opportunities-sourcing-worker`**. Three reasonable homes:
1. Inside `fleetneuron-integrations-service` (where FMCSA scraping currently lives) — lowest infra delta, but the service already does a lot.
2. New Render service `fleetneuron-opportunities-worker` — clean separation, mirrors how `fleetneuron-db-migrations` is its own service.
3. Inside `fleetneuron-ai-service` — co-located with the AI consumers, but mixes ingestion + serving.

**Recommendation:** option 2 (new Render service). The job is fundamentally different from integrations (no per-tenant webhook surface), it runs on a cron, and it's easy to scale independently.

### 4.2 Tables

```sql
-- New schema, mirrors the FN-1411 pattern
create schema if not exists opportunities;

create table opportunities.rfp_opportunities (
  id                   bigserial primary key,
  source               text    not null,        -- 'sam.gov' | 'edgar' | 'state_dot' | ...
  source_id            text    not null,        -- vendor-side unique id
  fingerprint          text    not null,        -- hash for dedupe across sources
  agency_or_shipper    text,
  posted_at            timestamptz,
  closes_at            timestamptz,
  estimated_value_usd  numeric(14,2),
  contract_term_months int,
  equipment_required   text,
  weekly_volume_text   text,                    -- raw "10 round trips/week"
  weekly_volume_loads  int,                     -- normalized
  min_requirements     jsonb,
  raw                  jsonb   not null,        -- full original payload
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (source, source_id)
);

create table opportunities.rfp_lanes (
  id                bigserial primary key,
  rfp_id            bigint references opportunities.rfp_opportunities(id) on delete cascade,
  origin_city       text, origin_state text,
  destination_city  text, destination_state text,
  distance_miles    int
);

create table opportunities.rfp_scores (
  id                bigserial primary key,
  rfp_id            bigint not null references opportunities.rfp_opportunities(id),
  tenant_id         uuid   not null references public.tenants(id),
  win_probability   numeric(4,3) not null,
  confidence        text   not null,
  strength_factors  jsonb  not null,
  risk_factors      jsonb  not null,
  disqualifiers     jsonb  not null,
  scored_at         timestamptz not null default now(),
  unique (rfp_id, tenant_id)
);

create table opportunities.import_runs (
  id            bigserial primary key,
  source        text    not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  rows_added    int default 0,
  rows_updated  int default 0,
  rows_skipped  int default 0,
  status        text    not null,    -- 'running' | 'success' | 'failed'
  error         text
);
```

Reuses the FN-1411 pattern (separate schema, `import_runs` ledger, `raw jsonb` for forward-compat).

### 4.3 Cron schedule

| Job | Cadence | Notes |
|---|---|---|
| `sam.gov` ingest | Daily 06:00 UTC | API supports incremental "since last run" via `postedFrom` param. |
| `EDGAR` enrichment | Weekly Sunday 02:00 UTC | Quarterly/annual filings — no value in higher cadence. |
| `score-all-tenants` | Daily 07:00 UTC (after ingest) | Batches Haiku scoring with cache windows. Skips (rfp, tenant) pairs already scored within last 7 days unless RFP changed. |
| `strategy` generation | On-demand (user click) | Sonnet, cached, response within 5–10s acceptable. |

### 4.4 Front-end surface (out of scope for this spike, listed for sequencing)

Two surfaces, both new:
1. **Daily-briefing card** — adds a "New opportunities for you" card to the existing AI briefing widget. Top 3 by `winProbability * estimatedValue`.
2. **Opportunities page** — `/opportunities` route. Filterable list (source, lane, value), per-row click → strategy generation modal with talking points and proposal outline.

Both are FE-001 Phase 2 work, separate stories.

---

## Section 5 — Legal + ToS notes

| Source | robots.txt / API ToS | Rate limits | Redistribution | Risk level |
|---|---|---|---|---|
| **SAM.gov** | API ToS at `open.gsa.gov/api/get-opportunities-public-api/`; explicitly allows programmatic access. Public-domain US-government data (17 USC § 105). | 1,000 req/hr standard key, 10k/hr "system account" key — easy upgrade. | **Allowed.** Public-domain, redistributable. | **Low.** Use the API, register for a system account. |
| **SEC EDGAR** | Fair-access policy at `sec.gov/about/developer.htm`; requires a `User-Agent: Company name contact@email` header. Public-domain. | 10 req/sec hard cap. Honors caching headers. | **Allowed.** Public domain. | **Low.** Use the JSON endpoints; don't scrape HTML. |
| **State DOT bid boards** | Per-state. Most are public-records portals with implicit "for public inspection" language. A handful (CA, NY) have explicit T&Cs allowing programmatic harvest with rate-limit. Some have CAPTCHA. | Per-state; assume 1 req/sec to stay safe. | **Mostly allowed** (govt data), but check per state. | **Medium.** Triage per-state before building; some may need manual paste-in. |
| **FreightWaves SONAR** | Paid API; ToS forbids redistribution outside "the Customer's organization." | Per-contract. | **Not allowed cross-tenant.** | **High** if multi-tenant. Don't build on this for shared ingest. |
| **DAT / Truckstop** | Paid API; ToS forbids any redistribution and requires per-customer auth. | Per-contract. | **Not allowed.** | **High.** BYO-creds only. |
| **Walmart Connect / Amazon Relay / shipper portals** | Per-portal ToS; many explicitly forbid scraping. Amazon Relay partner API has a strict NDA. | N/A | **Not allowed** without a partner agreement. | **High.** Phase 2b only, partnership-led. |
| **GovWin IQ / BidNet** | Paid; ToS forbids redistribution. Each subscription is per-seat. | Per-contract. | **Not allowed.** | **High.** BYO-license only. |
| **BLS QCEW / Census CBP** | Public-domain federal data; explicit redistribution OK. | API key required, generous limits. | **Allowed.** | **Low.** Use the bulk CSV. |

**Bottom line:** Tier-1 sources (SAM.gov, EDGAR, BLS, most state DOTs) are unambiguously OK to ingest, store, and resurface across tenants. Everything else is "BYO credentials" or partnership-gated.

**One legal nit worth flagging to the team:** even where data is public-domain, our **resurfacing of it as AI-generated win-probabilities and bid recommendations** is our content, and our customers may rely on it. We should add a clear "informational, not legal/financial advice" disclaimer to the Opportunities page — mirrors the AI Diagnosis page disclaimer pattern.

---

## Section 6 — Open questions

1. **Calibration data.** Win-probability is meaningless without a feedback loop. Who will tag historical wins/losses for the first ~50 tenant-RFP pairs to bootstrap calibration? Suggest: ask 3 design-partner carriers to label 20 past bids each. Without this, the model is uncalibrated and the number is decorative.
2. **`loads.is_dedicated` flag.** Does the `loads` table currently distinguish dedicated from spot? If not, we need a small backend story to add the flag and a backfill heuristic (e.g., "≥10 loads on the same O–D pair within 90 days" → infer dedicated).
3. **Tenant-fit vs platform-wide ranking.** Do we surface every RFP to every tenant (and let scores filter), or do we hard-filter at ingest time per the carrier's authority/equipment? Hard-filtering is cheaper and produces a cleaner UX; doing both at scoring time gives more flexibility but doubles compute. Suggest hard-filter at SQL, soft-rank in AI.
4. **Shipper-portal partnerships.** Should we pursue a Walmart Carrier Setup integration as a separate epic now, or wait for customer pull? My read: wait. Net-new shipper integrations have 6–12 month sales cycles and add no value if the carrier doesn't already have the relationship.
5. **Spike A (factoring/financial signal) dependency.** Several carrier-fit features (cash runway, factoring dependency) come from Spike A. If Spike A defers, do we ship without those features? Yes — they're "nice to have" not "must have." Win probability still works on lane match + safety + experience.
6. **MOTUS dependency.** FN-1411 already calls out FMCSA's MOTUS migration in 2026. If the FMCSA reference dataset shape changes mid-build, our scoring features would need to track those renames. Suggest: keep the carrier feature object behind a single accessor (`buildCarrierFeatures(tenantId)`) so a downstream FMCSA shape change is one file to update.
7. **Cost of nightly scoring.** ~$100/day at projected scale (Section 3.1) is fine for now but assumes Haiku 4.5 pricing. If volume 10×s, we should re-evaluate batching frequency (daily → weekly for low-fit tenants) before re-evaluating model choice.
8. **Where does the front-end live?** The Opportunities page can sit under the existing AI module or under a new "Sales / Opportunities" module. Probably the latter — the primary user is the dispatcher/sales lead, not the AI power user.

---

## Appendix A — Effort estimate (if approved)

Rough sizing assuming Phase 2a only (Tier-1 sources, two-call AI, daily-briefing card + new page):

| Workstream | Story-points est. |
|---|---|
| DB migrations + schema (`opportunities.*`) | 3 |
| SAM.gov ingest worker | 8 |
| EDGAR enrichment worker | 5 |
| Carrier feature builder (joins FMCSA + internal) | 5 |
| Win-probability handler + prompt + cache | 5 |
| Strategy handler + prompt + cache | 5 |
| Daily-briefing card extension | 3 |
| Opportunities page (FE) | 8 |
| QA — Cypress + k6 + Karate | 5 |
| **Total** | **~47 points** |

That's a 4–6 week effort for a 2-developer cell with QA support. Phase 2b is separately estimated only if/when partnerships exist.

## Appendix B — What we explicitly are NOT recommending

- **Scraping shipper portals** (Amazon, Walmart, Target). High legal risk, low success rate, no redistribution path.
- **Buying GovWin IQ for the platform.** Not a defensible cost — customers can BYO.
- **Building a generic "RFP marketplace."** Out of scope; we are augmenting carriers' existing sales motion, not disintermediating brokers.
- **Replacing the strategy generator with a fine-tuned model.** Premature; prompt + cache is fine until we have calibration data.
