# Reports — Drill-down URL Contracts

**Story:** FN-1119 / **Subtask:** FN-1183

This document defines the URL contracts that report KPI cells and table rows
use to deep-link into Loads, Drivers, and Customers screens with filter
pre-population. The reports module owns the contract; receiving screens
consume the documented query params.

---

## Destinations

| Destination | Route base       | Source component                            |
|-------------|------------------|---------------------------------------------|
| Loads       | `/loads`         | `loads-dashboard` (`LoadsDashboardComponent`) |
| Customers   | `/shop-clients/:id` | `customer-management` (`CustomerDetailComponent`) |
| Drivers     | `/drivers`       | `dispatch-drivers` (`DispatchDriversComponent`) |

A drill-down target with `commands` and optional `queryParams` is built by
`DrilldownService` (`frontend/src/app/reports/services/drilldown.service.ts`).
When no useful destination exists for a row/card, the service returns `null`
and the cell renders plain (no hover affordance, no anchor).

---

## Row drill-down resolution order

`DrilldownService.getRowTarget(reportKey, row, filters)` inspects the row in
this priority order:

1. `load_id` / `loadId` → **Loads** detail-drawer deep-link
2. `customer_id` / `customerId` / `broker_id` / `brokerId` → **Customer detail**
3. `driver_id` / `driverId` → **Drivers** filtered by `driverId` + date range
4. `dispatcher_id` / `dispatcherId` (only on `revenue-by-dispatcher`) →
   **Loads** filtered by `dispatcherId` + date range

If none of those are present, the row renders plain.

---

## URL contracts

### Loads — `/loads`

| Query param      | Type     | Source                            | Receiving status |
|------------------|----------|-----------------------------------|------------------|
| `loadId`         | string   | `load_id` / `loadId` row column   | Honored — opens detail drawer |
| `from`           | yyyy-MM-dd | report `startDate` / `date_from` | Documented; loads-dashboard does **not yet** pre-populate the date filter from this param. Tracked as follow-up. |
| `to`             | yyyy-MM-dd | report `endDate` / `date_to`     | Documented; same caveat as `from`. |
| `driverId`       | string   | `driver_id` row column or filter  | Documented; loads-dashboard does not yet read `driverId` from query params. |
| `dispatcherId`   | string   | `dispatcher_id` row column or filter | Documented; not yet read by loads-dashboard. |
| `customerId`     | string   | `customer_id` / `broker_id`       | Documented; not yet read by loads-dashboard. |

**Examples:**

- Row with `load_id: "L-123"` →
  `/loads?loadId=L-123`
- `revenue-by-dispatcher` row with `dispatcher_id: "d-7"` and report date
  filter Apr-2026 →
  `/loads?from=2026-04-01&to=2026-04-30&dispatcherId=d-7`

### Customers — `/shop-clients/:id`

The customer-management routing already supports `:id` as a path param.
Drill-down navigates directly to detail with no additional query params.

**Examples:**

- Row with `customer_id: "cust-9"` → `/shop-clients/cust-9`
- Row with `broker_id: "b-7"` and no `customer_id` → `/shop-clients/b-7`

### Drivers — `/drivers`

| Query param | Type     | Source                          | Receiving status |
|-------------|----------|---------------------------------|------------------|
| `driverId`  | string   | `driver_id` / `driverId` row    | Documented; `dispatch-drivers` does not yet focus/highlight by query param. |
| `from`      | yyyy-MM-dd | report `startDate`            | Documented (carried for future driver-perf drill-downs). |
| `to`        | yyyy-MM-dd | report `endDate`              | Documented. |

The drivers screen lists drivers; receiving the params lets a future
enhancement scroll-to / pre-filter the list. Until then, the drill-down
navigates to the page; the user sees the full list.

---

## KPI card drill-down resolution

`DrilldownService.getCardTarget(reportKey, cardKey, filters)`:

| Card key (any of)                                                                                | Destination | Carries          |
|--------------------------------------------------------------------------------------------------|-------------|------------------|
| `total_revenue`, `totalRevenue`, `revenue`, `loads_count`, `loadsCount`, `gross_profit`, `grossProfit`, `direct_profit`, `directProfit`, `fully_loaded_profit`, `fullyLoadedProfit` | Loads | `from`/`to` + filter `dispatcherId`/`driverId` |
| `payment-summary` + (`total_paid` or `outstanding`)                                              | Loads       | `from`/`to`      |
| (any other key)                                                                                  | _none_ — card renders plain |  |

---

## Reverse contract (loads-dashboard side, today)

`LoadsDashboardComponent.applyRouteQueryParams` currently reads:

- `status` → `filters.status`
- `billingStatus` → `filters.billingStatus`
- `loadId` (+ optional `action=reassign`) → opens the load (detail or wizard)

The other params (`from`, `to`, `driverId`, `dispatcherId`, `customerId`) are
defined by this contract and may be wired into the loads-dashboard reader in
a follow-up subtask. Until they are, the receiving filter UI shows the
default state — but the URL still carries the contract, so the date is not
lost on the report→loads round-trip.

---

## When to render plain (no drill-down)

`DrilldownService` returns `null` — and the row/card therefore renders plain
without hover affordance — when:

- The row has no recognized identifier column AND the report is not
  `revenue-by-dispatcher` with a `dispatcher_id`.
- The card key is not in the drillable set above.
- A `dispatcher_id` exists but the source report is not
  `revenue-by-dispatcher` (we don't synthesize a "loads-by-dispatcher"
  drill-down from non-revenue reports).

Components observe this null and use a plain `<article>` / `<tr>` instead of
a `routerLink` anchor.

---

## Test coverage

`drilldown.service.spec.ts` covers:

- Empty / null rows → null
- All four destination resolutions (load_id, customer_id, broker_id fallback,
  driver_id with date range, revenue-by-dispatcher dispatcher_id)
- Date-range carry-over via both `startDate/endDate` and legacy
  `date_from/date_to`
- Priority order (loadId beats customer/driver when the row has multiple IDs)
- Card targets: revenue family + payment-summary aggregates + non-drillable
  card returns null
