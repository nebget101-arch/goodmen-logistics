# State Sales-Tax Rules for Motor-Vehicle / Equipment Repair (2026 baseline)

Companion methodology + caveats for `state-sales-tax-rules-2026.csv`.

This dataset feeds the `state_tax_rules` table seeded by FN-1521.database (FN-1537) and consumed by the work-order tax-computation engine (FN-1538). It captures, for each US state + DC, the **state-level base sales-tax rate** plus per-component flags (labor / parts / fees) for **motor-vehicle and equipment repair** invoices.

`effective_from = 2026-01-01` for every row.

## Scope

- **In scope**: state-level base sales-tax rate; whether repair labor / parts / shop fees are subject to state sales tax for motor-vehicle and tangible-personal-property repair work.
- **Out of scope**: city/county/transit-district add-ons; sector-specific exemptions (warranty work, interstate-commerce trucks, farm equipment); manual override semantics (handled by the existing `tax_rate_percent` field on a work order).

## Method

State-by-state, in three layers:

1. **Base rate** — pulled from each state Department of Revenue's published rate page or the Tax Foundation 2026 sales-tax rates index. State base only.
2. **Labor / parts taxability** — verified against the actual statute, regulation, or DoR publication. An aggregator (Avalara, TaxJar) was used only as a triage hint, never as a source of truth — primary state sources resolved every classification.
3. **Spot checks** — five states verified hand-to-DoR before publishing: TX, CA, FL, NY, PA (citations below).

## Findings — taxonomy

The 51 jurisdictions cluster into four groups:

### Cluster A — No state sales tax (5)
**AK, DE, MT, NH, OR.** Rate `0`, all flags `false`. Locality-level taxes (Alaska in particular) are explicitly out of scope per FN-1521 description.

### Cluster B — Repair labor exempt when separately stated (~26)
**AL, AZ, CA, CO, GA, ID, IL, IN, MA, MD, ME, MI, MN, MO, NE, NV, ND, OH, OK, RI, SC, TX, VA, VT** (and conditionally MA via the 10% inconsequential-elements rule).
The dominant US pattern. Rule: itemize labor and parts separately on the invoice; tax flows only to parts. **Lump-sum invoices flip the entire amount to taxable.**

### Cluster C — Repair labor fully taxable (~16 + DC)
**AR, CT, DC, FL, HI, IA, KS, KY, LA, MS, NC, NJ, NM, NY, PA, SD, TN, WA, WI, WV, WY.**
Either the state statute explicitly enumerates motor-vehicle repair as a taxable service (NY §1105(c)(3); PA §31.50; NC §105-164.4(a)(16); KS §79-3603(p)) or the state taxes services-by-default (HI GET; NM GRT; WV §11-15-8; SD §10-45-4).

### Cluster D — Special edge cases
- **MA** — 10% inconsequential rule: parts < 10% of total and not separately stated = full exemption; otherwise Cluster B behavior.
- **VA** — Diagnostic labor explicitly exempt by statute (§58.1-609.5(8), eff. 2023-07-01); separately-stated repair labor exempt; **shop supplies separately stated are taxable** (TB 17-7) — atypical for Cluster B, captured via `fees_taxable=true`.
- **HI / NM** — Not technically sales taxes (GET / GRT), but functionally equivalent on the customer invoice; treated as taxable.
- **KY** — 2018 statute change (HB 487): labor associated with taxable parts is now taxable even when separately stated.
- **FL / NJ** — Conditional. Pure-labor repairs (no parts furnished) are not taxable; once any parts/materials are furnished, the entire bundle becomes taxable.

## The `fees_taxable` axis

In most states, shop fees / EPA-disposal / hazmat / shop-supply line items follow the taxability of the underlying repair charge:

- In Cluster C states, fees are almost always taxable.
- In Cluster B, fees follow the parts when the underlying parts charge is taxable, but several states (TX Pub 94-113; MN Industry Guide; NE 6-540; VA TB 17-7) explicitly tax shop supplies when separately stated. These are reflected as `fees_taxable=true` even though `labor_taxable=false`.
- For the rest of Cluster B, `fees_taxable=false` is a defensible default — but this flag is the most application-dependent of the three.

**Implementer's note**: `fees_taxable` is a default at the state level. Real-world fee taxability is fact-dependent (separately stated vs. lump-sum, hazmat vs. shop-supply, customer type). The work-order tax engine (FN-1538) should allow per-line-item override on the invoice; this CSV gives the safe default.

## Spot checks (5 states verified to DoR)

| State | Source | Confirmed |
|-------|--------|-----------|
| TX | [Comptroller Pub. 94-113](https://comptroller.texas.gov/taxes/publications/94-113.php) — "There is no sales tax on the labor to repair to a motor vehicle... Parts used to repair motor vehicles are taxable" | rate `0.0625`, labor `false`, parts `true`, fees `true` (shop supplies) |
| CA | [CDTFA Reg. 1546](https://www.cdtfa.ca.gov/lawguides/vol1/sutr/1546.html) — separately stated repair labor not taxable; fabrication labor taxable | rate `0.0725`, labor `false`, parts `true`, fees `false` |
| FL | [FDOR GT-800010](https://floridarevenue.com/Forms_library/gt800010.pdf) — "When a repairer supplies any parts or materials, the total amount charged for repairing tangible personal property is taxable" | rate `0.06`, labor `true` (when parts furnished), parts `true`, fees `true` |
| NY | [NYS TG Auto Repair Bulletin](https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/auto_repair.htm) — "You must collect sales tax on the total charge for parts and labor for the repair services that you provide" | rate `0.04`, labor `true`, parts `true`, fees `true` |
| PA | [61 Pa. Code §31.50](https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/061/chapter31/s31.50.html) — "inspecting, altering, cleaning, lubricating, polishing, repairing or waxing motor vehicles" is taxable | rate `0.06`, labor `true`, parts `true`, fees `true` |

## Limitations

- **Local rates excluded.** AL combined often ~9–11%; LA combined ~9.5%; locality is a separate concern for the application.
- **Heavy-equipment / interstate-commerce / farm equipment exemptions.** Several states (UT explicitly; many others by sector) carve out specific equipment classes. Not represented in this dataset; should be modeled as override flags or sector lookup downstream.
- **Warranty / insurance work.** Manufacturer-warranty repairs are typically zero-charge to customer = no tax. The `parts_taxable=true` flag describes the customer-side transaction, not the resale-certificate purchase by the shop.
- **Date sensitivity.** Several rules have changed recently (KY 2018, VA 2023). Re-validate annually.

## Maintenance

When updating this dataset:

1. Pull a new copy of each state's DoR rate page; validate the base rate hasn't moved.
2. Re-verify labor taxability for any state that has had statute changes since the prior baseline.
3. Bump `effective_from` to the new baseline date for any modified row.
4. Update this README with the new spot-check evidence.

## CSV consumer contract

The CSV is consumed by FN-1521.database (FN-1537), which seeds it into the `state_tax_rules` table. Column contract:

| Column | Type | Notes |
|--------|------|-------|
| `state_code` | char(2) | Primary key candidate |
| `state_name` | text | Human-readable |
| `default_sales_tax_rate` | numeric(6,4) | Decimal, e.g. `0.0625`. State base only. |
| `labor_taxable` | boolean | lowercase `true`/`false` |
| `parts_taxable` | boolean | lowercase `true`/`false` |
| `fees_taxable` | boolean | Shop fees / EPA / hazmat default |
| `notes` | text | Quoted; may contain commas. CSV-escaped per RFC 4180. |
| `source_url` | text | Direct DoR or primary-source link |
| `effective_from` | date | ISO `YYYY-MM-DD` |

Booleans are lowercase to match Postgres' parser without coercion. `notes` and `source_url` are bare or quoted per RFC 4180; the seed script should use a CSV parser, not naive `split(',')`.
