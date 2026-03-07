# Payroll / Settlement – UI Review & Contract Verification

## 1. Review of Current UI Work

### What’s in place (good)

- **Settlements module** – Lazy-loaded route `/settlements`, list + wizard + detail structure.
- **Settlement list** – Table with settlement #, period, driver, payable to, additional payee, status, gross, deductions, net driver, net additional, updated, actions. Uses `getDispatchDrivers()` for the driver dropdown. Filters: week, driver, status. Placeholder uses mock data with a TODO to switch to API.
- **Settlement wizard** – Steps: Period → Driver → Payees → Summary. Uses `getDispatchDrivers()`, default week (Mon–Sun), payee reason and optional additional payee. Submit currently simulated with TODO for `ApiService.createSettlement(payload)`.
- **Settlement detail** – Placeholder explaining that compensation summary, load earnings, deductions, adjustments, totals, and approval will appear when backend is wired.
- **Dispatch drivers** – Driver modal has Pay rates, Recurring deductions, Additional payee, Notes; `payeeReason` and `compensationNotes` are in the model (not yet sent to settlement backend).
- **Access control** – Permissions for `settlements.view`, `settlements.create`, `settlements.edit`, `settlements.approve` are defined; nav shows Settlements under Accounting.

### Gaps / alignment with backend

1. **List API and response shape**  
   Backend returns **snake_case** and a different **status** set. The UI should call **`GET /api/settlements/settlements`** and map backend fields to the list model (or map in `ApiService`).

2. **Status mapping**  
   - Backend: `preparing` | `ready_for_review` | `approved` | `paid` | `void`  
   - UI currently: `draft` | `pending_approval` | `approved` | `void`  
   Suggested mapping: `preparing` → Draft, `ready_for_review` → Pending approval, `approved` / `paid` → Approved, `void` → Void.

3. **Wizard → create draft**  
   Backend does **not** accept “period + driver + payees” in one call. It expects:
   - A **payroll period** to exist (create via `POST /api/settlements/payroll-periods` with `period_start`, `period_end`, or select from `GET /api/settlements/payroll-periods`).
   - Then **`POST /api/settlements/settlements/draft`** with:
     - `payroll_period_id` (required)
     - `driver_id` (required)
     - `date_basis` (optional, `'pickup'` | `'delivery'`, default `'pickup'`)
   - Primary payee (and optional additional payee) are **resolved on the backend** from driver payee assignments; the wizard can still show/override them in a later step if we add an “override payees” API, but the **draft creation** only needs period + driver (+ date_basis).

   So the wizard flow should be:
   - Step Period: pick or create a payroll period (e.g. call `GET /api/settlements/payroll-periods` and match week, or `POST` a new period for that week).
   - Step Driver: pick driver (already using `getDispatchDrivers()`).
   - Step Payees: optional display/override (backend already resolves from driver; override can be a follow-up enhancement).
   - Step Summary: call `POST /api/settlements/settlements/draft` with `{ payroll_period_id, driver_id, date_basis }`, then redirect to the new settlement detail (e.g. `/settlements/<id>`).

4. **List filters**  
   Backend supports:
   - `driver_id`
   - `payroll_period_id`
   - `settlement_status`
   - `settlement_number`
   - `limit`, `offset`  
   There is **no** “week starting” or date range filter on list. Options:
   - Load payroll periods (e.g. `GET /api/settlements/payroll-periods`), and when the user picks a “week”, map it to a `payroll_period_id` and send that, or
   - Backend could be extended later to filter by `period_start` / `period_end` if needed.

5. **Week input**  
   The list uses `<input type="week">`, which gives values like `"2025-W10"`. Backend expects **date** strings (`YYYY-MM-DD`) for period_start/period_end. So when creating a period or matching to one, convert week (e.g. ISO week) to the period’s Monday and Sunday dates.

6. **Settlement detail**  
   To load one settlement with items: **`GET /api/settlements/settlements/:id`**. Response includes `load_items` and `adjustment_items` (arrays). All fields are snake_case (e.g. `settlement_number`, `subtotal_gross`, `total_deductions`, `net_pay_driver`, `settlement_status`).

7. **Payees in wizard**  
   Backend resolves primary (and optional additional) payee from **driver payee assignments** when creating the draft. The wizard’s “payable to” / “additional payee” are good for display or future override; for the first integration, creating the draft with only `payroll_period_id` and `driver_id` is enough.

---

## 2. Backend Contract Summary (for UI)

- **Base URL for settlements:** `GET/POST /api/settlements/...` (gateway proxies to logistics service).
- **Auth:** All settlement endpoints require a valid JWT and role **admin**, **carrier_accountant**, or **dispatch_manager**.
- **Naming:** Responses use **snake_case** (e.g. `settlement_number`, `period_start`, `driver_id`, `subtotal_gross`, `total_deductions`, `net_pay_driver`, `net_pay_additional_payee`, `settlement_status`, `created_at`, `updated_at`).
- **List settlements:** `GET /api/settlements/settlements?driver_id=&payroll_period_id=&settlement_status=&settlement_number=&limit=&offset=`  
  Returns array of settlement objects (with optional `period_start`, `period_end` from join). No pagination meta in response yet; use `limit`/`offset` and length of array for “more” logic if needed.
- **Create draft:** `POST /api/settlements/settlements/draft`  
  Body: `{ "payroll_period_id": "<uuid>", "driver_id": "<uuid>", "date_basis": "pickup" | "delivery" }`  
  Returns the created settlement object (snake_case).
- **Get one:** `GET /api/settlements/settlements/:id`  
  Returns settlement + `load_items` + `adjustment_items` (all snake_case).
- **Status values:** `preparing` | `ready_for_review` | `approved` | `paid` | `void`.

A full API table is in **`backend/docs/PAYROLL_SETTLEMENT_AUDIT_AND_PLAN.md`** (Section 5).

---

## 3. Impact on Existing Flows – No Breaking Changes

Verified:

- **Existing routes and behavior**
  - **`/api/loads`** – Implemented in `backend/packages/goodmen-shared/routes/loads.js`. No changes were made. All existing load list, get, create, update, bulk-rate-confirmations, attachments, etc. are unchanged.
  - **`/api/drivers`** – Served by the **drivers-compliance-service** (gateway proxies to `DRIVERS_COMPLIANCE_SERVICE_URL`). No changes were made to that service or to the gateway path for `/api/drivers`. Settlement routes live under **`/api/settlements`** (e.g. `/api/settlements/drivers/:driverId/compensation-profile`); they do **not** touch `/api/drivers`.
  - **`/api/brokers`** – Implemented in `backend/packages/goodmen-shared/routes/brokers.js`. No changes.
  - **`/api/invoices`**, **`/api/credit`**, **`/api/locations`**, **`/api/geo`** – Unchanged.

- **Database**
  - Payroll/settlement work added **new tables only** (payees, driver_compensation_profiles, payroll_periods, settlements, etc.). No existing columns or tables were dropped or renamed on **drivers**, **loads**, **vehicles**, **brokers**, or **users**.
  - **drivers** table still has the same columns (including optional pay fields); they are still read/written by existing driver APIs. New settlement logic uses **driver_compensation_profiles** for new flows, with optional fallback to driver columns for legacy.

- **Gateway**
  - Only **added** `app.use('/api/settlements', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'))`. No existing proxy paths were changed or removed.

- **Frontend**
  - **getDispatchDrivers()** still calls `GET /api/drivers?view=dispatch` (unchanged).
  - **getLoads()** still calls `GET /api/loads` (unchanged).
  - Any new settlement calls will go to `GET/POST /api/settlements/...` and do not alter existing load or driver contracts.

**Conclusion:** Existing flows (loads, drivers, brokers, dispatch board, invoicing, etc.) are unchanged. No existing API contract was broken; only new endpoints under `/api/settlements` were added.

---

## 4. Suggested Next Steps for UI Dev

1. **ApiService** – Add methods such as:
   - `listSettlements(filters)` → `GET /api/settlements/settlements` with query params.
   - `createSettlementDraft(payrollPeriodId, driverId, dateBasis?)` → `POST /api/settlements/settlements/draft`.
   - `getSettlement(id)` → `GET /api/settlements/settlements/:id`.
   - Optionally: `listPayrollPeriods()`, `createPayrollPeriod(periodStart, periodEnd)`.
2. **List page** – Replace mock with `listSettlements(filters)`. Map response to `SettlementRow` (snake → camel and map `settlement_status` to the UI status/labels). Use `driver_id` and `settlement_status` (with status mapping above) for filters; for “week”, either use `payroll_period_id` (from a period picker) or keep as client-side filter until backend supports date range.
3. **Wizard** – In submit (or “Create draft”):
   - Ensure a payroll period exists for the chosen week (create or select).
   - Call `createSettlementDraft(payrollPeriodId, driverId, date_basis)`.
   - On success, redirect to `/settlements/<returned.id>`.
4. **Detail page** – Load settlement with `getSettlement(id)`, then show compensation summary, load_items, adjustment_items, totals, and (when permissions allow) approve/void using `POST /api/settlements/settlements/:id/approve` and `POST /api/settlements/settlements/:id/void`.

If you want, the next step can be a small **ApiService** snippet (TypeScript) with the exact method signatures and URL/query/body for these calls.
