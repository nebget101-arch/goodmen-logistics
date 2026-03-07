# Driver Payroll / Settlement – Phase 1: Audit & Proposal

## 1. Current state audit

### 1.1 Routes and entry points

| Route | Component | Purpose |
|-------|-----------|---------|
| `/drivers` | `DispatchDriversComponent` | Dispatch view: driver list + assignments, **pay fields in New/Edit modal** |
| `/drivers/dqf` | `DriversComponent` | DQF/safety: roster, CDL/med/DQF %, clearinghouse; Add/Edit driver, DQF checklist modal |
| `/invoices` | Lazy `InvoicingModule` | Invoices list + invoice detail only; **no settlement UI** |
| `/loads` | `LoadsDashboardComponent` | Loads table; driver/broker/truck/trailer filters and load detail (driver_id, broker_id) |
| `/dispatch-board` | `DispatchBoardComponent` | Week view by driver; driver filter, load cards |

**Finding:** There is **no dedicated settlement or payroll route**. Pay is only configured inside the Dispatch Drivers New/Edit driver modal. RBAC seed references `settlements.view` and `carrier_accountant` role but no settlement backend or frontend exists.

---

### 1.2 Driver profile and pay (current)

**Location:** `frontend/src/app/components/dispatch-drivers/`  
**Data source:** `ApiService.getDispatchDrivers()`, `getDriver(id)`, `createDriver()`, `updateDriver()`  
**Backend:** `GET/POST /api/drivers`, `GET/PUT /api/drivers/:id`; dispatch view returns `d.*` + truck/trailer unit numbers.

**Current pay-related UI (all inside one modal):**

- **Driver type:** Radio – Company driver | Owner operator (no “Hired driver for owner”).
- **Pay basis:** Radio – Per mile | Freight percentage | Flatpay | Hourly (no “Flat per load”).
- **Values:** Two inputs – “Per mile” (payRate), “Pay percentage” (payPercentage). No flat weekly amount, no per load amount. No conditional visibility by pay model.
- **Payable to:** Single text input (`payableTo`).
- **Tabs (present but disabled):** “Pay rates” (only active), “Scheduled payments/deductions”, “Additional payee”, “Notes”.

**Missing vs requirements:**

- No compensation type “Hired driver for owner”.
- No pay model “Flat per load” or “Flat weekly” (flatpay exists but not labeled as weekly).
- No expense-sharing matrix (fuel, insurance, ELD, trailer rent, tolls, repairs; Company/Driver/Owner/Shared).
- No pay routing: additional payee, rule/reason.
- No effective start/end dates.
- No recurring deductions tab (tab is disabled).
- No notes/audit area for compensation.

**Backend driver schema (from migrations):**

- `driver_type`: company | owner_operator.
- `pay_basis`: per_mile | percentage | flatpay | hourly.
- `pay_rate`, `pay_percentage`: decimals.
- `payableTo` / `payable_to`: used in frontend; if not in DB it may be in a different migration or view.

**Compatibility:** Dispatch list and modal are the only places that show pay basis/rate. Loads dashboard and dispatch board reference drivers by `id` and `name` only; no direct dependency on pay field names. Renaming or reshaping pay payloads must be reflected in driver API and in this modal until a new compensation module exists.

---

### 1.3 DQF / Drivers component (`/drivers/dqf`)

- **Focus:** Safety and qualification (CDL, medical, DQF %, clearinghouse). Add/Edit driver modals capture identity, license, medical; **no pay or settlement**.
- **Driver list:** Same `drivers` table via `getDqfDrivers()` (view=dqf); different columns (no truck/trailer/pay in list).
- **Do not overwrite:** DQF flows, document upload, DQF checklist, Send Packet. Any new “Driver profile” or “Compensation” tab should be additive (e.g. link from dispatch view to a profile, or add tabs on dispatch modal without breaking DQF).

---

### 1.4 Loads and dispatch board (driver references)

- **Loads dashboard:** Uses `driverId`, `driver_name`; driver dropdown for filters and for load create/edit. Chips/labels use driver name. Preserve: `drivers` list, `driverId`, display names.
- **Dispatch board:** Driver rows, driver filter dropdown, custom filters by driver. Preserve: driver id/name and filter behavior.
- **Load detail:** Shows driver; links/references must keep working after any driver payload changes (prefer stable `id` and display name).

---

### 1.5 Invoicing module

- **Routes:** `invoices`, `invoices/:id`. Components: list + detail. No settlement, no driver payroll, no deduction or payee logic. Can later add “Settlements” as sibling under Accounting or separate section.

---

### 1.6 Backend gaps (from codebase grep)

- **Settlement:** No `settlement` routes or tables found. RBAC has `settlements.view` and accountant role; no API or DB yet.
- **Recurring deductions:** None.
- **Variable deductions / imported expenses:** None.
- **Driver compensation:** Only `driver_type`, `pay_basis`, `pay_rate`, `pay_percentage` (and possibly `payable_to`) on `drivers`. No effective dates, no expense matrix, no additional payee.

Phase 2+ will require backend support for: compensation profiles (or extended driver fields), recurring deductions, settlements (header + lines), variable deductions/expenses, and approval workflow.

---

## 2. Proposed information architecture (IA)

### 2.1 High-level areas

- **Drivers (dispatch)** – Keep as main “driver + pay” entry. Evolve from single modal to:
  - **Option A:** Same list + improved “Driver profile” (tabs: Profile, Compensation, Recurring deductions, Notes). Compensation tab = new structured form; deductions = new sub-ui.
  - **Option B:** List + “Driver detail” route (e.g. `/drivers/:id`) with tabs Profile | Compensation | Deductions | Notes; New/Edit driver modal stays for quick add, but “Edit” can open detail page.
- **Settlement center** – New area. Suggested placement: under **Accounting** (with Invoices) or its own nav item “Payroll” or “Settlements”.
- **Invoicing** – Unchanged (invoices only). Optional later: link “Settlement” from invoice context if business ties them.

Recommended: **Option A** first (tabs inside improved modal or a “driver profile” slide-out/drawer from dispatch list) to avoid new routes and to keep one source of truth for “edit driver + pay.” Option B can follow when you add a full driver profile page.

### 2.2 Proposed routes

| Route | Component / module | Purpose |
|-------|--------------------|---------|
| `/drivers` | `DispatchDriversComponent` (evolved) | List + New driver; row action “Edit” opens Compensation/Profile (tabs: Identity, Compensation, Deductions, Notes) |
| `/drivers/dqf` | `DriversComponent` | Unchanged – DQF/safety |
| `/settlements` | New `SettlementListComponent` | Settlement list + filters |
| `/settlements/new` | New `SettlementWizardComponent` or multi-step container | Create settlement (wizard or guided form) |
| `/settlements/:id` | New `SettlementDetailComponent` | View/edit settlement, totals, approval, PDF/email |

Settlement routes can live in a new lazy-loaded module (e.g. `SettlementsModule`) or under an existing `AccountingModule` that also hosts Invoices. Nav: add “Settlements” under Accounting or as a top/section link.

### 2.3 Driver compensation (where it lives)

- **Primary place:** Dispatch Drivers → Edit driver → **Compensation** tab (redesigned).
- **Fields (aligned with your spec):**  
  A. Compensation type (Company driver | Owner operator | Hired driver for owner)  
  B. Pay model (Per mile | Percentage | Flat weekly | Flat per load)  
  C. Compensation values (CPM, %, weekly amount, per load amount – show only by model)  
  D. Expense responsibility matrix (fuel, insurance, ELD, trailer rent, tolls, repairs → Company/Driver/Owner/Shared)  
  E. Pay routing (Primary payable to, Additional payee, rule/reason)  
  F. Effective dates (start/end)  
  G. Recurring deductions tab (add/edit/disable rules, show active/history)  
  H. Notes / audit summary  

Backend will need to support these (new tables or columns + API). Frontend keeps using existing driver GET/PUT until new compensation/deduction APIs exist; then switch to new endpoints or extended payloads without breaking existing driver list/detail consumption (loads, dispatch board).

---

## 3. Component map (proposed)

### 3.1 Driver compensation (dispatch flow)

| Component | Type | Responsibility |
|-----------|------|----------------|
| `DispatchDriversComponent` | Page | List, filters, “New driver”, “Edit” opening compensation/profile |
| `DriverFormModalComponent` or inline | Modal / drawer | Identity, contact, CDL, truck/trailer (existing), **tabs** for Compensation | Deductions | Notes |
| `DriverCompensationFormComponent` | Presentational / section | Compensation type, pay model, values, expense matrix, pay routing, effective dates |
| `DriverRecurringDeductionsComponent` | Section | List + add/edit/disable recurring deduction rules; active/history |
| `ExpenseResponsibilityMatrixComponent` | Presentational | Grid/selectors: expense type × Company | Driver | Owner | Shared |

Reuse existing driver create/update API from modal; when backend adds compensation/deduction APIs, call them from these components (same driver id). Preserve `payableTo` and pay basis/rate for backward compatibility until backend is extended.

### 3.2 Settlement center

| Component | Type | Responsibility |
|-----------|------|----------------|
| `SettlementListComponent` | Page | Table (settlement #, period, driver, payable to, additional payee, status, gross, deductions, net driver, net additional payee, updated at); filters (week, driver, status, pay type, company/owner) |
| `SettlementWizardComponent` | Page or full-page flow | Steps: week → driver → payees → date basis → loads → scheduled deductions → variable deductions → manual adjustment → totals → save draft / submit |
| `SettlementDetailComponent` | Page | Header (meta, actions), Compensation summary card, Load earnings table, Scheduled deductions table, Variable deductions table, Manual adjustments, Totals sidebar, Approval timeline |
| `SettlementLoadEarningsTableComponent` | Presentational | Include checkbox, load #, pickup, delivery, truck, trailer, gross, miles, pay basis, driver amount, additional payee amount, settled status, issues |
| `SettlementDeductionsTableComponent` | Presentational | Scheduled: source, description, amount, applies to, status, override, final amount |
| `SettlementVariableDeductionsTableComponent` | Presentational | Variable/imported: source type, date, id, description, match, amount, assigned to, apply toggle, notes |
| `ManualAdjustmentModalComponent` | Modal | Add earning / deduction / reimbursement / advance / correction; amount + reason |
| `OverrideDeductionModalComponent` | Modal | Override or remove scheduled deduction; require reason; mark overridden |
| `EmailSettlementModalComponent` | Modal | To driver, to additional payee, CC accounting; subject/body template |
| `SettlementTotalsSidebarComponent` | Presentational | Sticky summary: gross, driver/additional payee earnings, recurring/variable deductions, advances, reimbursements, net driver, net additional payee |

### 3.3 Shared / reuse

- **Driver selector:** Reuse or extend existing driver dropdown/typeahead (loads dashboard, dispatch) for settlement wizard and filters.
- **Payable to / additional payee:** May be a small presentational block or part of compensation form and settlement header; backend to define if these are on driver profile or per-settlement override.
- **Status badges:** Reuse app-wide status pill/badge pattern; add settlement-specific statuses (draft, pending_approval, approved, void).
- **Permissions:** Use existing RBAC; gate “approve”, “void”, “override” by roles (e.g. manager, accountant). Settlement list/detail show/hide actions by permission.

---

## 4. Data flow and backend alignment

- **Driver:** Keep using `GET /api/drivers` (dispatch view) and `GET/PUT /api/drivers/:id` for list and basic profile. When backend adds compensation/deduction:
  - Option 1: Extend driver response with nested `compensation`, `recurring_deductions`, `payees`.
  - Option 2: New endpoints e.g. `GET/PUT /api/drivers/:id/compensation`, `GET/PUT /api/drivers/:id/deductions`; settlement and driver compensation UI call these.
- **Settlements:** New APIs needed: list, get, create (draft), update, submit, approve, void, recalculate; plus PDF generate and email. Frontend will assume REST or equivalent; exact payloads to be defined with backend (e.g. eligible loads, deduction rules, variable expenses per driver/week).
- **Loads:** Existing load list/detail and “driver_id” / “driver_name” must remain. Settlement “eligible loads” will be a filter (e.g. by driver + week + not yet settled); reuse existing load service where possible.

---

## 5. Regression and compatibility checklist

Before changing existing screens:

- [ ] Trace all references to `driver.id`, `driver.firstName`, `driver.lastName`, driver display name (loads dashboard, dispatch board, load detail).
- [ ] Keep existing driver list columns (Name, Type, Status, Hire/Term, Phone, Email, Truck, Trailer, Pay basis, Pay rate/%) and filter behavior; add new columns only if needed.
- [ ] If pay field names or payload shapes change, update: `DispatchDriversComponent` (newDriver, startEdit, saveDriver), `ApiService` driver methods, and any other consumer of driver payload.
- [ ] Preserve DQF page and modals; no removal of DQF tabs or document upload.
- [ ] If a “Driver profile” or Compensation tab is added, keep “New driver” and “Edit” entry points; avoid breaking links from dispatch board or loads to “edit driver.”
- [ ] After backend adds settlement/deduction APIs: search codebase for `driver`, `load`, `broker`, `truck`, `trailer` usages and update any affected chips, labels, links, and detail drawers.

---

## 6. Suggested implementation order (phases)

- **Phase 2:** Redesign driver compensation area (Compensation tab + expense matrix + pay routing + effective dates); build recurring deductions UI; backend: extend driver or add compensation/deduction APIs.
- **Phase 3:** Settlement list page + settlement create wizard; backend: settlement list/create APIs and eligible loads + deductions data.
- **Phase 4:** Settlement detail page (tables, totals, overrides, approval, void); backend: detail, update, submit, approve, void, recalculate.
- **Phase 5:** PDF/email UX; empty/error states; permission-based actions; optional: driver profile route (e.g. `/drivers/:id`) with same tabs for deeper bookmarking.

This document is the Phase 1 deliverable: audit of current payroll and driver-related UI, and proposed IA and component map for the production-ready payroll/settlement experience.
