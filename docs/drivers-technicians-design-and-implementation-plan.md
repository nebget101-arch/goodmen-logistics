# Drivers & Technicians Workflow – Design & Implementation Plan

This document outlines a design and implementation plan for FleetNeuron focused on **driver** and **technician** workflows. It is based on a review of the current codebase (frontend Angular app, API gateway, drivers-compliance and vehicles-maintenance microservices, shared routes/services).

---

## 1. Current State Summary

### 1.1 Drivers Workflow (Existing)

| Area | What Exists | Gaps / Notes |
|------|-------------|--------------|
| **Dispatch view** | `/drivers` – list drivers, add driver, assign truck/trailer, filters (name, type, status, hire/term, phone, email, truck, trailer, pay). | Dispatch + admin only. No driver self-service. |
| **DQF (Driver Qualification File)** | `/drivers/dqf` – driver list, DQF requirements, document upload, completeness, “Send Packet” modal. | Safety + admin only. |
| **Onboarding** | Send packet (SMS/email) → public `/onboard/:packetId` (employment application + MVR authorization). Backend: create packet, submit sections, driver created/linked by CDL. | Packet is admin/safety-initiated; driver completes on public page. |
| **HOS** | `/hos` – HOS records, violations. | Safety role. |
| **Roles** | `dispatch`: Loads, Drivers. `safety`: Dashboard, drivers (DQF), vehicles, HOS, audit. | Drivers themselves have no app role; they only use the public onboarding link. |

### 1.2 Technicians Workflow (Existing)

| Area | What Exists | Gaps / Notes |
|------|-------------|--------------|
| **Backend** | Work orders hub: technician can PATCH status, add labor, reserve/issue/return parts. Work order has `assigned_mechanic_user_id`; labor lines have `mechanic_user_id`. | Technicians have correct API permissions. |
| **Frontend sidebar** | `technician` role in `canSee()` returns only: `customers`, `parts`, `receiving`, `transfers`, `inventory_reports`. | **Technicians do not see Maintenance or Work Order** in the nav. They cannot reach the work order list or form through the UI. |
| **Maintenance list** | `/maintenance` – Work Orders Hub: filters (status, location, type, invoice, search), bulk upload, “New Work Order”, edit WO. | Visible only to roles that `canSee('maintenance')` (e.g. fleet, admin), not technician. |
| **Work order form** | `/work-order`, `/work-order/:id` – full create/edit with vehicle, customer, location, labor, parts (reserve/issue/return), documents, status, assign mechanic. | Same visibility as maintenance. |
| **List filters** | `listWorkOrders` supports: search, status, type, priority, locationId, customerId, vehicleId, invoiceStatus, dateFrom, dateTo, page, pageSize. | **No filter by assigned mechanic** – “My work orders” for a technician is not supported. |

---

## 2. Design Principles

- **Drivers**: Improve the flow from “driver added in dispatch” → “DQF/onboarding” → “driver completes packet” and, if desired later, a minimal driver-facing experience (e.g. view own status, documents).
- **Technicians**: First fix visibility and “my work” so technicians can open the app, see Maintenance/Work Orders, and focus on work assigned to them; then streamline status updates and parts/labor entry.
- **Roles**: Keep existing role boundaries (dispatch, safety, admin, technician, service_advisor, etc.) and extend only where needed.
- **Reuse**: Prefer existing APIs and components; add filters and role-based UI, not new microservices.

---

## 3. Driver Workflow – Design & Implementation

### 3.1 Goals

1. Clear path: **Dispatch adds driver** → **Safety/Admin sends onboarding packet** → **Driver completes packet** on public link.
2. Optional: driver-specific views (e.g. “My documents”, “My packet status”) if you introduce a driver role later.

### 3.2 Implementation Plan (Drivers)

| # | Item | Type | Description |
|---|------|------|-------------|
| D1 | **Document driver flow** | Doc | Add a short “Driver onboarding flow” section to `APPLICATION-KNOWLEDGE-FOR-AI.md`: who sends the packet, what the driver sees at `/onboard/:packetId`, and that drivers do not have an app login today. |
| D2 | **Onboarding packet completion feedback** | Feature | When a driver completes a section (e.g. employment application) on the public page, optionally show a clear “Saved” / “Section complete” and next step (e.g. MVR). Ensure backend returns section status so the UI can reflect progress. (Verify current behavior in `onboarding-packet.component` and backend submit endpoints.) |
| D3 | **Send packet from DQF** | UX | Ensure “Send Packet” is easy to find from the DQF driver list/detail (already in place via modal). Optionally add a “Packet sent” indicator or last-sent date per driver in DQF view. |
| D4 | **Driver role (optional)** | Future | If you add a “driver” role: login, minimal sidebar (e.g. “My packet”, “My documents”), read-only DQF status and document list for the logged-in driver only. Would require backend endpoints filtered by current user’s driver record. |

**Priority**: D1 (doc) and D2 (completion feedback) first; D3 is polish; D4 only if you want driver self-service.

---

## 4. Technician Workflow – Design & Implementation

### 4.1 Goals

1. Technicians can **see Maintenance and Work Orders** in the sidebar and open the work order list and form.
2. Technicians get a **“My work orders”** view (filter by assigned mechanic = current user) and optional quick filter on the maintenance list.
3. Technicians can **update status**, add **labor**, and **reserve/issue/return parts** without needing access to create WOs or bulk upload (optional restriction).
4. Optional: **technician-focused dashboard** (e.g. “My open work orders” count, next due).

### 4.2 Implementation Plan (Technicians)

| # | Item | Type | Description |
|---|------|------|-------------|
| T1 | **Sidebar: technician sees Maintenance & Work Order** | Bugfix / Config | In `frontend/src/app/app.component.ts`, update `canSee()` for role `technician` to include `maintenance` (and ensure the Fleet section shows “Maintenance” for technician). Example: `if (role === 'technician') return ['maintenance', 'customers', 'parts', 'receiving', 'transfers', 'inventory_reports'].includes(tab);` |
| T2 | **Backend: filter work orders by assigned mechanic** | Backend | In `backend/packages/goodmen-shared/services/work-orders.service.js`, extend `listWorkOrders(filters)` to accept `assignedMechanicUserId`. In the query `.modify()`, add: `if (assignedMechanicUserId) qb.andWhere('wo.assigned_mechanic_user_id', assignedMechanicUserId);` |
| T3 | **Work-orders hub: pass assignedMechanicUserId when technician** | Backend | In `work-orders-hub.js` GET `/` (list), if the request user has role `technician`, set `req.query.assignedMechanicUserId = req.user.id` (or equivalent from auth middleware) so list is scoped to “my work orders” by default. Optionally allow override via query param for shop_manager/admin. |
| T4 | **Maintenance list: “My work orders” filter** | Frontend | In `maintenance.component.ts`, get current user id (from token or a small “current user” API). Add a toggle or filter “Assigned to me” that sets `assignedMechanicUserId` in list params. For technician role, default this to true. Use `listWorkOrders({ ...filters, assignedMechanicUserId })`; ensure `ApiService.listWorkOrders` passes the new param. |
| T5 | **API service: listWorkOrders accepts assignedMechanicUserId** | Frontend | In `frontend/src/app/services/api.service.ts`, ensure `listWorkOrders(filters)` forwards `assignedMechanicUserId` in params (already supported if you pass it in the filters object and the backend is updated per T2–T3). |
| T6 | **Work order form: technician read-only for non-editable fields** | UX (optional) | For role `technician`, you can keep status/labor/parts editable but make vehicle/customer/location/creation metadata read-only to avoid accidental changes. |
| T7 | **Technician dashboard widget** | Feature (optional) | On dashboard, if role is technician, show a card “My open work orders” (count or list) by calling `listWorkOrders({ assignedMechanicUserId: currentUserId, status: 'IN_PROGRESS' }` or multiple statuses. |

**Priority**: T1 (sidebar) and T2–T5 (backend filter + “My work orders” in UI) are core. T6 and T7 are nice-to-have.

---

## 5. Role Matrix (Reference)

| Role | Dashboard | Loads | Drivers | DQF | Vehicles | HOS | Audit | Maintenance | WO | Parts | Inventory (parts, receiving, etc.) |
|------|-----------|-------|---------|-----|----------|-----|-------|-------------|-----|-------|-------------------------------------|
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| dispatch | – | ✓ | ✓ | – | – | – | – | – | – | – | – |
| safety | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| fleet | – | – | – | – | – | – | – | ✓ | ✓ | – | – |
| technician | – | – | – | – | – | – | – | **add ✓** | **add ✓** | ✓ | ✓ |
| service_advisor | – | – | – | – | – | – | – | – | – | – | ✓ (customers, invoices, sales, reports) |
| parts_manager / shop_manager | – | – | – | – | – | – | – | – | – | ✓ | ✓ |

After implementation: technician sees Maintenance and Work Order (and can use “My work orders” when T2–T5 are done).

---

## 6. Implementation Order (Recommended)

1. **Technician sidebar (T1)** – one-line change so technicians can reach Maintenance and Work Order.
2. **Backend assigned-mechanic filter (T2, T3)** – list work orders by `assignedMechanicUserId`; default to current user for technician.
3. **Frontend “My work orders” (T4, T5)** – maintenance component and API pass-through for `assignedMechanicUserId`, default “Assigned to me” for technician.
4. **Driver docs and onboarding UX (D1, D2)** – document flow and improve completion feedback on public onboarding page.
5. Optional: T6 (technician read-only fields on WO form), T7 (technician dashboard widget), D3 (packet-sent indicator), D4 (driver role).

---

## 7. File Reference (Quick)

| Purpose | Path |
|--------|------|
| Sidebar / role visibility | `frontend/src/app/app.component.ts` (`canSee()`), `app.component.html` (nav) |
| Maintenance list | `frontend/src/app/components/maintenance/maintenance.component.ts/html` |
| Work order form | `frontend/src/app/components/work-order/work-order.component.ts/html` |
| List work orders API (frontend) | `frontend/src/app/services/api.service.ts` (`listWorkOrders`) |
| List work orders (backend) | `backend/packages/goodmen-shared/services/work-orders.service.js` (`listWorkOrders`), `routes/work-orders-hub.js` (GET list) |
| Driver list / DQF | `frontend/src/app/components/drivers/drivers.component.*`, `dispatch-drivers/dispatch-drivers.component.*` |
| Onboarding (public) | `frontend/src/app/components/onboarding-packet/onboarding-packet.component.*` |
| Onboarding API | `backend/packages/goodmen-shared/routes/onboarding.js` |
| Application knowledge | `docs/APPLICATION-KNOWLEDGE-FOR-AI.md` |

---

## 8. Success Criteria

- **Technicians**: Can open the app, see “Maintenance” and open the work order list; can filter or default to “Assigned to me”; can open a work order and update status, labor, and parts.
- **Drivers**: Onboarding flow is documented and completion on the public packet page gives clear feedback; dispatch/safety can send packets from DQF and (optionally) see that a packet was sent.
- **No regressions**: Existing roles (dispatch, safety, fleet, admin, service_advisor, parts_manager, shop_manager) keep their current access.

This plan is scoped to the existing web app and APIs; an iOS app (or mobile web) for drivers/technicians would be a separate design that consumes the same APIs.

---

## 9. Driver App – View Loads & Upload Documents

### 9.1 Goal

A **driver-facing experience** (web or future iOS app) where drivers can:

1. **See their loads** – List and view only loads assigned to them (`loads.driver_id`).
2. **Upload load documents**:
   - **Proof of delivery (POD)**
   - **BOL (Bill of Lading)** *(already supported)*
   - **Lumper receipt** *(already supported)*
   - **Roadside maintenance receipts**

### 9.2 Current State

- **Loads API** (`/api/loads`): Today allowed only for `admin` and `dispatch`. List supports `driverId` filter. Attachments table has types: `RATE_CONFIRMATION`, `BOL`, `LUMPER`, `OTHER`, `CONFIRMATION`.
- **Gap**: No `PROOF_OF_DELIVERY` or `ROADSIDE_MAINTENANCE_RECEIPT`; no driver role; drivers cannot access loads or upload documents.

### 9.3 Implementation Plan (Driver App)

| # | Item | Type | Description |
|---|------|------|-------------|
| DA1 | **New attachment types** | Backend | Add `PROOF_OF_DELIVERY` and `ROADSIDE_MAINTENANCE_RECEIPT` to load attachment enum and to `ATTACHMENT_TYPES` in `loads.js`. Migration: alter `load_attachments.type` enum to add the two values. |
| DA2 | **Link user to driver** | Backend | Migration: add `driver_id` (UUID, FK to `drivers`) to `users`. When creating a user with role `driver`, set `driver_id`. |
| DA3 | **JWT / auth includes driver_id** | Backend | In auth login and (if needed) `/users/me`, include `driver_id` in JWT payload and response for users with role `driver` so loads routes can scope by driver. |
| DA4 | **Loads API allows driver role** | Backend | In `loads.js`: allow role `driver` in addition to admin/dispatch. For role driver: list loads only where `driver_id = req.user.driver_id`; get single load only if `load.driver_id === req.user.driver_id`; upload/list/delete attachments only for loads that belong to that driver. |
| DA5 | **Frontend: driver sees “My Loads”** | Frontend | In `app.component.ts` `canSee()`, add `loads` for role `driver`. In sidebar, show “My Loads” (or “Loads”) for driver linking to `/loads` (or a driver-specific route that passes `driverId` from current user). |
| DA6 | **Frontend: driver load list & document upload** | Frontend | For driver role: load list uses `driverId` from current user (from `/users/me` or stored after login). Load detail: show upload for types **Proof of Delivery**, **BOL**, **Lumper receipt**, **Roadside maintenance receipt** (and optionally **Other**). Reuse existing loads dashboard attachment upload UI where possible, with driver-appropriate type options. |

### 9.4 Attachment Types (After DA1)

| Type | Use |
|------|-----|
| `RATE_CONFIRMATION` | Rate con (dispatch/office) |
| `BOL` | Bill of lading |
| `LUMPER` | Lumper receipt |
| `PROOF_OF_DELIVERY` | POD – driver upload |
| `ROADSIDE_MAINTENANCE_RECEIPT` | Roadside maintenance receipt – driver upload |
| `OTHER` | Other documents |
| `CONFIRMATION` | Confirmation |

### 9.5 File Reference (Driver App)

| Purpose | Path |
|--------|------|
| Loads list/detail/attachments API | `backend/packages/goodmen-shared/routes/loads.js` |
| Load attachment types (backend) | `ATTACHMENT_TYPES` in `loads.js`; DB enum on `load_attachments.type` |
| Auth login / JWT payload | `backend/packages/goodmen-shared/routes/auth.js`; `internal/user.js` for user fetch |
| User create (driver_id) | `backend/packages/goodmen-shared/routes/users.js` or auth-users-service |
| Frontend loads | `frontend/src/app/components/loads-dashboard/`, `loads.service.ts`, `load-dashboard.model.ts` |
| Sidebar / driver role | `frontend/src/app/app.component.ts`, `app.component.html` |
