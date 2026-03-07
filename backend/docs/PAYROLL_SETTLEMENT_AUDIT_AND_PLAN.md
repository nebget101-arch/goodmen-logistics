# Driver Payroll / Settlement – Phase 1: Audit and Migration Plan

## 1. Schema Audit Summary

### 1.1 Existing Tables and Pay/Settlement Relevance

| Table | Purpose | Pay/Settlement relevance |
|-------|---------|---------------------------|
| **drivers** | Core driver entity (schema.sql + migrations) | **Relevant.** Has `driver_type` (company \| owner_operator), `pay_basis` (per_mile \| percentage \| flatpay \| hourly), `pay_rate`, `pay_percentage`, `truck_id`, `trailer_id`, `co_driver_id`. No payee or settlement linkage. |
| **driver_licenses** | One row per driver, CDL info | Reference only (driver_id). |
| **driver_compliance** | Medical, MVR, clearinghouse | Reference only (driver_id). |
| **driver_onboarding_***, **dqf_*** | Onboarding and DQF | Reference only (driver_id). |
| **loads** | Freight loads | **Core for settlement.** Has `driver_id`, `truck_id`, `trailer_id`, `broker_id`, `rate`, `completed_date`, `pickup_date`, `delivery_date` (from stops or columns). No `loaded_miles` column (computed in API from load_stops zips). No settlement reference. |
| **load_stops** | Pickup/delivery stops per load | Used to derive pickup_date, delivery_date, and (via zip) loaded/empty miles in API. |
| **load_attachments** | Rate cons, BOL, etc. | Reference only. |
| **vehicles** | Trucks and trailers (vehicle_type) | Referenced by loads (truck_id, trailer_id) and drivers (truck_id, trailer_id). No payroll columns. |
| **brokers** | Broker/customer info for loads | Reference only. |
| **users** | App users | Has `driver_id` (link to drivers). RBAC includes `settlements.view` for carrier_accountant. No settlement tables yet. |
| **invoices** / **invoice_*** | Work order / customer invoicing | **Not** driver payroll. Separate domain (customers, work_orders, locations). |

### 1.2 What Does Not Exist Today

- **No** `settlements`, `settlement_*`, `payroll_periods`, or `payees` tables.
- **No** `driver_compensation_profiles`, `expense_responsibility_profiles`, or `recurring_deduction_rules`.
- **No** `imported_expense_sources` / `imported_expense_items`.
- **No** API or service for settlement calculation, approval, PDF, or email.

### 1.3 Existing Pay-Related Columns on `drivers`

- `driver_type`: company \| owner_operator  
- `pay_basis`: per_mile \| percentage \| flatpay \| hourly  
- `pay_rate`: decimal (e.g. cents per mile or flat amount)  
- `pay_percentage`: decimal (e.g. 88)  
- No effective dates, no expense-sharing flag, no link to “additional payee.”

**Conclusion:** Keep these columns unchanged. New `driver_compensation_profiles` (and related) will be the source of truth for new settlement flows; backfill can populate profiles from current driver rows for compatibility.

### 1.4 Load Eligibility for Settlement

- **Eligible:** Loads with status that implies “completed” (e.g. DELIVERED) and not already tied to a non-void settlement. Date basis: pickup_date or delivery_date from `load_stops` or `loads.pickup_date` / `loads.delivery_date`.
- **Loaded miles:** Not stored on `loads`; computed in `loads.js` from load_stops zips. Settlement engine will compute at settlement time and store in `settlement_load_items` (e.g. `loaded_miles`, `pay_basis_snapshot`, `gross_amount`, `driver_pay_amount`).

### 1.5 Foreign Key and Reference Map

- **drivers:** Referenced by `loads.driver_id`, `users.driver_id`, driver_licenses, driver_compliance, dqf_driver_status, driver_documents, driver_onboarding_packets. **Do not drop or rename drivers.id or critical columns.**
- **loads:** Referenced by load_stops, load_attachments. **Do not drop loads.id.**
- **vehicles:** Referenced by loads (truck_id, trailer_id), drivers (truck_id, trailer_id). **Do not drop vehicles.id.**

---

## 2. Proposed Migration Plan (Additive Only)

### 2.1 Principles

- **Additive only:** New tables and new columns only; no dropping or renaming of existing driver/load/vehicle columns or FKs.
- **Backfill:** Script(s) to create initial `driver_compensation_profiles` (and optionally `expense_responsibility_profiles`) from existing `drivers` data.
- **Compatibility:** Existing APIs that read `drivers.pay_basis`, `pay_rate`, `pay_percentage` continue to work; new settlement logic reads from `driver_compensation_profiles` when present, with fallback to drivers for legacy.

### 2.2 New Tables (Order for FK Dependencies)

1. **payees** – no FK to drivers/loads.  
2. **driver_compensation_profiles** – FK driver_id → drivers.  
3. **expense_responsibility_profiles** – FK driver_id or compensation_profile_id.  
4. **driver_payee_assignments** – FK driver_id, primary_payee_id, additional_payee_id → payees.  
5. **payroll_periods** – no FK to drivers/loads.  
6. **settlements** – FK payroll_period_id, driver_id, compensation_profile_id, primary_payee_id, additional_payee_id.  
7. **settlement_load_items** – FK settlement_id, load_id. Unique (load_id + non-void settlement context) enforced in app or partial unique index.  
8. **settlement_adjustment_items** – FK settlement_id.  
9. **recurring_deduction_rules** – FK driver_id, payee_id, equipment_id (vehicle) nullable.  
10. **imported_expense_sources** – no FK to drivers.  
11. **imported_expense_items** – FK imported_source_id; optional matched_driver_id, matched_payee_id, matched_vehicle_id, settlement_adjustment_item_id.

### 2.3 Optional: Add `loaded_miles` to loads

- **Option A (recommended):** Do **not** add to `loads`. Compute at settlement time and store only in `settlement_load_items`. Keeps loads table unchanged.  
- **Option B:** Add `loaded_miles` to `loads` in a later migration and backfill from load_stops; then settlement can use stored value. Defer to later if needed.

### 2.4 Compatibility Layer Notes

- **Driver pay fields:**  
  - **Read:** Settlement and payroll APIs use `driver_compensation_profiles` for the effective profile; if none, fall back to `drivers.pay_basis`, `pay_rate`, `pay_percentage` for display/legacy.  
  - **Write:** Driver create/update can continue to write to `drivers`; a hook or background job can create/update `driver_compensation_profiles` for the same effective period, or we do it only when first creating a settlement for that driver.  
- **RBAC:** Existing `settlements.view` (carrier_accountant) is already defined; add permissions such as `settlements.create`, `settlements.approve`, `settlements.manage` as needed. No change to existing role names or tables.

### 2.5 Risks and Impacted Modules

| Risk | Mitigation |
|------|------------|
| Double-settlement of a load | Unique constraint or app logic: one load_id can appear in at most one non-void settlement_load_item per “payable context” (e.g. driver + period). |
| Existing reports/dashboards that join drivers/loads | No schema change to drivers/loads; no impact. New tables are additive. |
| Drivers without compensation profile | Backfill script; runtime fallback to drivers.pay_* when profile missing. |
| Payroll period date range vs load date basis | Clear business rule: period is weekly; eligible loads by pickup_date or delivery_date in that range; store date basis on settlement. |

**Impacted modules (new or extended):**

- **New:** Payroll/Settlement service (or routes under logistics or a dedicated service): compensation profiles, payees, payroll periods, settlements, adjustments, recurring deductions, import expense matching, PDF/email.  
- **Existing:**  
  - **drivers.js:** Optional: when creating/updating driver, create or update `driver_compensation_profiles` for default effective range.  
  - **loads.js:** No change required for list/get; settlement will query loads for “eligible, not yet settled” in its own module.  
  - **RBAC:** Add new permissions for settlements (create, approve, manage) and assign to carrier_accountant / admin.

---

## 3. Target Domain Model (Recap)

As specified; names aligned with project conventions (snake_case, UUIDs, timestamps).

- **driver_compensation_profiles** – profile_type, pay_model, rates, expense_sharing_enabled, effective dates.  
- **payees** – type (company \| driver \| owner \| external_company \| contractor), contact info.  
- **driver_payee_assignments** – driver_id, primary_payee_id, additional_payee_id, rule_type, effective dates.  
- **payroll_periods** – period_start, period_end, run_type, status (draft → finalized → approved → emailed \| void).  
- **settlements** – per driver/payee/period; totals (subtotal_gross, subtotal_driver_pay, total_deductions, net_pay_driver, etc.), status, approval.  
- **settlement_load_items** – load_id, snapshot (loaded_miles, pay_basis, gross, driver_pay, additional_payee).  
- **settlement_adjustment_items** – item_type, source_type, amount, charge_party, apply_to, source_reference.  
- **recurring_deduction_rules** – driver/payee/equipment scope, amount, frequency, start/end date.  
- **expense_responsibility_profiles** – who pays fuel, insurance, ELD, trailer_rent, etc.  
- **imported_expense_sources** – source_type, file/storage, parse_status.  
- **imported_expense_items** – link to source; match keys; matched_driver_id, matched_vehicle_id; link to settlement_adjustment_item when applied.

---

## 4. Migration and Backfill Commands

After deploying the migration:

```bash
# Run migrations (from repo root or service that runs knex)
npx knex migrate:latest --env production --knexfile backend/packages/goodmen-database/knexfile.js

# Backfill driver_compensation_profiles from existing drivers
NODE_ENV=production node backend/scripts/backfill-driver-compensation-profiles.js

# Re-seed RBAC to grant settlements.create, settlements.edit, settlements.approve, settlements.manage to carrier_accountant (optional if already seeded)
npx knex seed:run --env production --knexfile backend/packages/goodmen-database/knexfile.js
```

## 5. Settlement API Summary (for UI)

Base path: **`/api/settlements`** (proxied via gateway to logistics-service). All routes require auth and role `admin`, `carrier_accountant`, or `dispatch_manager`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/payees` | List payees (query: type, search, is_active, limit) |
| POST | `/payees` | Create payee |
| GET | `/payees/:id` | Get payee |
| PUT | `/payees/:id` | Update payee |
| GET | `/drivers/:driverId/compensation-profile` | Active profile (query: asOf) |
| GET | `/drivers/:driverId/compensation-profiles` | All profiles for driver |
| POST | `/drivers/:driverId/compensation-profiles` | Create profile |
| PUT | `/compensation-profiles/:id` | Update profile |
| GET | `/drivers/:driverId/payee-assignment` | Active payee assignment |
| POST | `/drivers/:driverId/payee-assignments` | Create payee assignment |
| GET | `/drivers/:driverId/expense-responsibility` | Active expense responsibility |
| POST | `/drivers/:driverId/expense-responsibility` | Create expense responsibility |
| GET | `/recurring-deductions` | List (query: driver_id, enabled) |
| POST | `/recurring-deductions` | Create |
| PATCH | `/recurring-deductions/:id` | Update (enabled, end_date) |
| GET | `/payroll-periods` | List periods (query: status, limit) |
| POST | `/payroll-periods` | Create period (period_start, period_end) |
| PATCH | `/payroll-periods/:id` | Update period (status) |
| GET | `/eligible-loads` | Preview eligible loads (query: driver_id, period_start, period_end, date_basis) |
| GET | `/recurring-deductions/preview` | Preview deductions (driver_id, period_start, period_end) |
| GET | `/settlements` | List settlements (filters: driver_id, payroll_period_id, settlement_status, settlement_number) |
| POST | `/settlements/draft` | Create draft (body: payroll_period_id, driver_id, date_basis) |
| GET | `/settlements/:id` | Get settlement with load_items and adjustment_items |
| POST | `/settlements/:id/recalc` | Recalculate totals |
| POST | `/settlements/:id/loads` | Add load (body: load_id) |
| DELETE | `/settlements/:id/loads/:loadItemId` | Remove load item |
| POST | `/settlements/:id/adjustments` | Add adjustment (body: item_type, amount, description, …) |
| DELETE | `/settlements/:id/adjustments/:adjustmentId` | Remove adjustment |
| POST | `/settlements/:id/approve` | Approve settlement |
| POST | `/settlements/:id/void` | Void settlement |
| GET | `/settlements/:id/pdf-payload` | Get payload for PDF (settlement, driver, payees, period, load_items, adjustment_items) |
| POST | `/settlements/:id/send-email` | Request email (body: to_driver, to_additional_payee, cc_internal) |
| GET | `/imported-expense-sources` | List imported sources |
| POST | `/imported-expense-sources` | Create source (after upload/parse) |
| GET | `/imported-expense-items` | List items (query: source_id, status, matched_driver_id) |
| PATCH | `/imported-expense-items/:id/match` | Set match (matched_driver_id, matched_payee_id, matched_vehicle_id) |
| POST | `/imported-expense-items/:id/apply-to-settlement` | Apply to settlement (body: settlement_id) |

## 6. Next Steps (Phases 2–5)

- **Phase 2:** Additive migrations for all new tables; backfill script for driver_compensation_profiles (and optionally expense_responsibility_profiles) from drivers. **Done:** migration `20260309100000_add_payroll_settlement_tables.js`, backfill script `backend/scripts/backfill-driver-compensation-profiles.js`, RBAC updates, `settlement-calculation.js` skeleton.
- **Phase 3:** Calculation engine (pay models, deductions, additional payee split); APIs for profiles, payees, periods, settlements, adjustments, recurring rules.
- **Phase 4:** Import expense sources/items and matching; settlement PDF payload and email hooks.
- **Phase 5:** Tests (pay models, double-settle prevention, approval locking, PDF totals) and compatibility validation.
