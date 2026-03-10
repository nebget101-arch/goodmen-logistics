# FleetNeuron Frontend README (for ChatGPT)

## Stack

- Angular 17
- TypeScript
- RxJS
- Angular Material (datepicker/form controls)
- Single frontend app with role-aware navigation

Primary files:
- App module: [frontend/src/app/app.module.ts](../frontend/src/app/app.module.ts)
- App routes: [frontend/src/app/app-routing.module.ts](../frontend/src/app/app-routing.module.ts)
- API service: [frontend/src/app/services/api.service.ts](../frontend/src/app/services/api.service.ts)
- Environment config:
  - [frontend/src/environments/environment.ts](../frontend/src/environments/environment.ts)
  - [frontend/src/environments/environment.prod.ts](../frontend/src/environments/environment.prod.ts)

---

## Core frontend architecture

1. **Routing-driven feature areas**
   - Top-level routes in `app-routing.module.ts`
   - Lazy modules for:
     - customer management
     - invoicing
     - settlements
     - reports

2. **Auth + RBAC**
   - `AuthGuard` protects internal pages
   - `PermissionGuard` protects permission-sensitive pages (e.g., user creation)
   - `AccessControlService` centralizes role/permission/location logic
   - Permission directives: `HasPermissionDirective`, `HasAnyPermissionDirective`

3. **HTTP handling**
   - `AuthInterceptor` for auth token behavior
   - `CacheBustingInterceptor` for stale-cache mitigation
   - Centralized API calls through `ApiService`

4. **API base URL**
   - Dev: `http://localhost:4000/api`
   - Prod: `https://fleetneuron-logistics-gateway.onrender.com/api`

---

## Main pages (top-level routes)

From [frontend/src/app/app-routing.module.ts](../frontend/src/app/app-routing.module.ts):

- `/dashboard` → KPI and status dashboard
- `/drivers` → dispatch-focused driver management
- `/drivers/dqf` → compliance/DQF driver management
- `/vehicles` → truck management
- `/trailers` → trailer management
- `/hos` → hours-of-service records
- `/maintenance` → maintenance management
- `/work-order` and `/work-order/:id` → service work order flow
- `/loads` → load dashboard (main logistics load workflow)
- `/dispatch-board` → dispatch planning board
- `/audit` → audit and compliance views
- `/parts` → parts catalog
- `/barcodes` → barcode lookup/management
- `/receiving` → receiving workflow
- `/inventory-transfers` → transfer workflow
- `/direct-sales` → direct sales workflow
- `/inventory-reports` → inventory reports
- `/profile` → user profile
- `/users/create` → user creation (permission-gated)
- `/login` → auth
- `/privacy`, `/terms`, `/communication-preferences` → policy/consent pages
- Public onboarding: `/onboard/:packetId`

Lazy-loaded modules:
- `/customers` (customer list/detail/form/bulk upload)
- `/invoices` (invoice list/detail)
- `/settlements` (list, wizard, detail, deductions, equipment owners)
- `/reports` (analytics dashboard)

---

## Feature pages by module

### 1) Dispatch & logistics

- Components:
  - `LoadsDashboardComponent`
  - `DispatchBoardComponent`
  - `DispatchDriversComponent`
  - `LoadsComponent` (legacy/simple loads UI)

Key logic patterns:
- Load creation supports manual + assisted/auto entry
- Attachment workflow includes upload + replace behaviors
- Route/stop management supports adding/editing pickup/delivery stop details
- Broker creation can occur in-context from load workflow
- Settlement integration points (load eligibility, assignment)

### 2) Drivers & compliance

- Components:
  - `DispatchDriversComponent`
  - `DriversComponent` (DQF/driver profile side)
  - `OnboardingPacketComponent`
  - `HosComponent`

Key logic patterns:
- Driver profile editing with recurring deductions and pay settings
- DQF/onboarding packet flow with public submission route
- Driver compliance and document-status tracking

### 3) Vehicles & maintenance

- Components:
  - `VehiclesComponent`
  - `VehicleFormComponent`
  - `MaintenanceComponent`
  - `WorkOrderComponent`

Key logic patterns:
- Truck/trailer split via route data (`vehicleType`)
- Work order creation + status + labor/parts/charge orchestration
- Customer and vehicle creation from within work-order flow

### 4) Inventory/parts

- Components:
  - `PartsCatalogComponent`
  - `BarcodeManagementComponent`
  - `WarehouseReceivingComponent`
  - `InventoryTransfersComponent`
  - `DirectSalesComponent`
  - `InventoryReportsComponent`

Key logic patterns:
- Parts management with barcode support
- Receiving ticket lifecycle
- Transfers and stock movement visibility
- Direct sales tying inventory to customer charge flows

### 5) Finance/admin

- Components:
  - `CustomersListComponent`, `CustomerFormComponent`, `CustomerDetailComponent`
  - `InvoicesListComponent`, `InvoiceDetailComponent`
  - `SettlementListComponent`, `SettlementWizardComponent`, `SettlementDetailComponent`
  - `ScheduledDeductionsComponent`, `EquipmentOwnersComponent`
  - `ReportsPageComponent`

Key logic patterns:
- Full customer lifecycle including bulk upload and pricing metadata
- Invoicing with line items/payments/documents/pdf
- Settlement payroll lifecycle (draft → recalc → approve/void → pdf/email)
- Expense-payment categories and deduction mapping

---

## Popups / modal-heavy workflows

The app uses state-driven modals (`showXModal` flags) in several components.

### Loads dashboard modal set

In [frontend/src/app/components/loads-dashboard/loads-dashboard.component.ts](../frontend/src/app/components/loads-dashboard/loads-dashboard.component.ts):

- Manual load modal (`showManualModal`)
- Auto/AI import modal (`showAutoModal`)
- Bulk upload modal (`showBulkUploadModal`)
- Load detail modal (`showDetailsModal`)
- Route modal (`showRouteModal`)
- Add stop modal (`showNewStopModal`)
- Edit stop modal (`showEditStopModal`)
- Attachment upload modal (`showUploadModal`)
- Attachment replace modal (`showReplaceModal`)
- Broker create modal (`showBrokerCreateModal`)

### Driver/dispatch modals

In [frontend/src/app/components/dispatch-drivers/dispatch-drivers.component.ts](../frontend/src/app/components/dispatch-drivers/dispatch-drivers.component.ts):

- Driver create/edit modal (`showNewModal`)
- Recurring deduction modal (`showRecurringDeductionModal`)
- Multi-tab modal with pay rates, deductions, additional payee, notes

### Settlement admin modals

- Scheduled deductions modal states in [frontend/src/app/settlements/scheduled-deductions/scheduled-deductions.component.ts](../frontend/src/app/settlements/scheduled-deductions/scheduled-deductions.component.ts)
- Equipment owner modal states in [frontend/src/app/settlements/equipment-owners/equipment-owners.component.ts](../frontend/src/app/settlements/equipment-owners/equipment-owners.component.ts)

### Work order modals

In [frontend/src/app/components/work-order/work-order.component.ts](../frontend/src/app/components/work-order/work-order.component.ts):

- New customer modal (`showNewCustomerModal`)
- New customer-vehicle modal (`showNewCustomerVehicleModal`)

### Dispatch board filters

In [frontend/src/app/components/dispatch-board/dispatch-board.component.ts](../frontend/src/app/components/dispatch-board/dispatch-board.component.ts):

- Custom filter modal (`showFilterModal`)

### Global onboarding modal

- Orchestrated via `OnboardingModalService` and root app component

---

## Frontend logic hotspots (important when adding features)

1. **`ApiService` is large and domain-rich**
   - consolidates many backend calls
   - includes settlement normalization (`normalizeSettlementDetail`)
   - includes timeout protections in some high-risk calls

2. **RBAC fallback behavior**
   - If backend does not return full permission payload, roles derive permissions locally.
   - This can mask backend permission misconfiguration if not tested thoroughly.

3. **Stateful modal workflows**
   - Many features rely on multiple interdependent modal flags.
   - Any new flow must guard against stale state when closing/opening chained modals.

4. **Route guards + permissions**
   - New pages should wire both route-level and action-level permission checks.

---

## What ChatGPT should output for new frontend features

When proposing a new frontend feature, ask ChatGPT to include:

- Route additions/changes
- Component changes and modal-state impacts
- `ApiService` additions (method names + endpoint mapping)
- RBAC/permission checks (route + UI action)
- UX states: loading, empty, error, success, optimistic updates
- Test plan: unit + integration + role-based acceptance checks
