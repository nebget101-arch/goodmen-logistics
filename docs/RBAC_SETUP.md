# RBAC_SETUP.md — FleetNeuron Role-Based Access Control

## Overview

FleetNeuron uses a layered RBAC system that supports both a legacy single-role JWT claim
and a full normalized DB permission model. Both coexist and are backward-compatible.

---

## Roles

| Role Code            | Description |
|----------------------|-------------|
| `super_admin`        | Full system access, bypasses all permission checks |
| `admin`              | Tenant-level full access (maps to super_admin in rbac-service) |
| `executive_read_only`| View dashboards, loads, reports — no mutations |
| `dispatch_manager`   | Manage loads, dispatch, brokers, drivers |
| `dispatcher`         | View/create/edit loads, assign drivers |
| `safety_manager`     | Drivers, DQF, safety compliance, HOS |
| `carrier_accountant` | Invoices, settlements, accounting, exports |
| `company_accountant` | Accounting across divisions |
| `shop_manager`       | Full shop operations + finalization (post invoices, close WOs, approve discounts) |
| `service_writer`     | Shop CRUD similar to shop_clerk + some pricing access |
| `service_advisor`    | Legacy alias mapped to `service_writer` |
| `shop_clerk`         | **New.** Operational CRUD only — cannot finalize records (see below) |
| `mechanic`           | Work order labor/parts; no financial access |
| `technician`         | Assigned-work access; labor entry, parts usage |
| `parts_manager`      | Inventory, purchasing, vendors, POs |
| `parts_clerk`        | Receiving, transfers, customer parts sales |
| `inventory_auditor`  | View-only inventory and cycle counts |
| `driver`             | Portal: own profile and assigned loads (future) |
| `customer`           | Portal: own invoices, work orders (future) |

---

## shop_clerk Permissions

`shop_clerk` is a new role introduced in migration `20260314200000_add_shop_clerk_permissions`.

### ALLOWED

| Resource          | Actions |
|-------------------|---------|
| Customers         | view, create, edit |
| Vehicles          | view, create, edit |
| Appointments      | view, create, edit |
| Work Orders       | view, create, edit, assign |
| Work Order Lines  | view, create, edit |
| Estimates         | view, create, edit, convert |
| Invoices          | view, create, edit (draft only) |
| Payments          | view, create |
| Inventory         | view |
| Parts             | view |
| Documents         | view, upload |
| Discounts         | view |

### BLOCKED (manager-only)

| Permission             | Who Can |
|------------------------|---------|
| `invoices.post`        | shop_manager, admin, accounting |
| `invoices.void`        | shop_manager, admin, accounting |
| `work_orders.approve`  | shop_manager, admin |
| `work_orders.close`    | shop_manager, admin |
| `payments.refund`      | shop_manager, admin, accounting |
| `inventory.adjust`     | parts_manager, shop_manager, admin |
| `inventory.transfer`   | parts_manager, shop_manager, admin |
| `discounts.approve`    | shop_manager, admin |
| `reports.shop`         | shop_manager, parts_manager, admin |
| `users.*`              | super_admin, admin |
| `roles.*`              | super_admin, admin |
| `settlements.*`        | carrier_accountant, company_accountant, admin |

---

## Permission Codes

All permission codes follow the `module.action` dot notation (e.g. `work_orders.view`).

### New codes added by migration `20260314200000`

These did **not** exist in the original `module × action` grid from `01_rbac_seed.js`:

| Code | Description |
|------|-------------|
| `work_orders.close` | Close a completed work order |
| `work_order_lines.view/create/edit/delete` | Work order line item control |
| `estimates.view/create/edit/convert/approve/delete` | Estimate lifecycle |
| `appointments.view/create/edit/delete` | Service scheduling |
| `invoices.post` | Finalize/post a draft invoice |
| `invoices.void` | Void a posted invoice |
| `payments.view/create/refund/delete` | Payment recording and refunds |
| `documents.view/upload/delete` | Document management |
| `discounts.view/approve` | Discount rules and approvals |
| `reports.shop` | Shop performance reports |

---

## Status-Based Controls

### Invoices

Status transitions `→ posted` and `→ void` require `INVOICE_MANAGER_ROLES`
(admin, super_admin, shop_manager, carrier_accountant, company_accountant, accounting).

This is enforced inline in `routes/invoices.js` via the finalize guard on `PATCH /:id/status`.

| Status | shop_clerk can reach? |
|--------|----------------------|
| draft | ✅ (default on create) |
| posted | ❌ manager only |
| partially_paid | ✅ |
| paid | ✅ |
| void | ❌ manager only |

### Work Orders

Status transitions `→ closed`, `→ approved`, `→ void` require `WO_MANAGER_ROLES`
(admin, super_admin, shop_manager, carrier_accountant, accounting).

This is enforced in `routes/work-orders-hub.js` via `requireManagerForFinalStatus`.

| Status | shop_clerk can set? |
|--------|---------------------|
| draft | ✅ |
| open | ✅ |
| in_progress | ✅ |
| waiting_parts | ✅ |
| completed | ✅ |
| ready_to_invoice | ✅ |
| closed | ❌ manager only |
| approved | ❌ manager only |
| void | ❌ manager only |

---

## Compatibility Approach

### Dual-mode resolution

1. **New path (preferred):** `loadUserRbac` middleware (from `rbac-middleware.js`) loads roles and
   permission codes from the `user_roles` + `role_permissions` DB tables into `req.user.rbac`.
   Use `requirePermission('work_orders.view')` for fine-grained guards on new routes.

2. **Legacy path (backward compat):** Older routes use a local `requireRole(['admin', 'fleet'])`
   function that checks `req.user.role` (a single string from the JWT). These routes continue
   to work without any DB lookup.

3. **rbac-compat.js:** A utility exporting role sets (`SHOP_ROLES`, `MANAGER_ROLES`) and
   middleware factories (`requireShopClerkOrAbove`, `requireManagerRole`,
   `requireFinalizeStatusGuard`). Used to update legacy routes without full refactor.

### Legacy role fallback in rbac-service.js

When a user has no rows in `user_roles` (migration backfill not yet run), `getRolesForUser()`
falls back to `users.role` via `LEGACY_TO_ROLE_CODE`:

```
admin          → super_admin
safety         → safety_manager
fleet          → dispatcher
dispatch       → dispatcher
driver         → driver
shop_manager   → shop_manager     (new)
shop_clerk     → shop_clerk       (new)
service_writer → service_writer   (new)
service_advisor → service_writer  (new alias)
mechanic       → mechanic         (new)
technician     → technician       (new)
parts_manager  → parts_manager    (new)
parts_clerk    → parts_clerk      (new)
accounting     → carrier_accountant (alias)
```

### Frontend compatibility

`AccessControlService.derivePermissionsFromRoles()` provides client-side permission derivation
as a fallback when the backend doesn't include a `permissions` array in the login/me response.
`shop_clerk` derivation was added as a new `if (r('shop_clerk'))` block — existing blocks
for `dispatcher`, `safety_manager`, `carrier_accountant`, etc. are untouched.

---

## Files Changed

| File | Type | Notes |
|------|------|-------|
| `backend/packages/goodmen-database/migrations/20260314200000_add_shop_clerk_permissions.js` | NEW | 26 new permission codes + shop_clerk role |
| `backend/packages/goodmen-database/seeds/06_shop_clerk_seed.js` | NEW | Role-permission assignments for shop_clerk, shop_manager, technician, parts_manager |
| `backend/packages/goodmen-shared/utils/rbac-compat.js` | NEW | Compatibility adapter (role sets, status guards) |
| `backend/packages/goodmen-shared/test/rbac-shop-clerk.test.js` | NEW | 30+ unit tests |
| `backend/packages/goodmen-shared/services/rbac-service.js` | MODIFIED | Extended LEGACY_TO_ROLE_CODE with 12 new entries |
| `backend/packages/goodmen-shared/routes/customers.js` | MODIFIED | Added shop_clerk/shop_manager to create/update/notes |
| `backend/packages/goodmen-shared/routes/invoices.js` | MODIFIED | Added shop roles + finalize guard for post/void |
| `backend/packages/goodmen-shared/routes/work-orders.js` | MODIFIED | Extended router-level guard to include shop roles |
| `backend/packages/goodmen-shared/routes/work-orders-hub.js` | MODIFIED | Added shop roles to all CRUD routes + status guard |
| `backend/packages/goodmen-shared/routes/vehicles.js` | MODIFIED | Added shop roles (both router-level guards) |
| `frontend/src/app/models/access-control.model.ts` | MODIFIED | 20 new permission constants |
| `frontend/src/app/services/access-control.service.ts` | MODIFIED | shop_clerk + shop_manager derivation blocks |

---

## Rollout Steps

### 1. Apply the migration

```bash
# Via Docker
docker compose run --rm db-migrations npm run migrate:latest

# Or locally
cd backend/packages/goodmen-database
npm run migrate:latest
```

Verify:
```sql
SELECT code, name FROM roles WHERE code = 'shop_clerk';
SELECT code FROM permissions WHERE module = 'work_order_lines' ORDER BY code;
```

### 2. Run seeds

```bash
# Via Docker
docker compose run --rm db-migrations npm run seed:run

# Or locally
cd backend/packages/goodmen-database
npm run seed:run
```

Seed `06_shop_clerk_seed.js` is idempotent — safe to run multiple times.

### 3. Create a shop_clerk user

Using the existing user management API or admin UI, create a user and assign role `shop_clerk`.
The JWT will contain `role: 'shop_clerk'` after next login.

### 4. Run tests

```bash
cd backend/packages/goodmen-shared
npx jest test/rbac-shop-clerk.test.js --verbose
```

### 5. Deploy backend microservices

Restart the gateway and all microservices after deployment.

### 6. Assign permissions to existing shop users (optional)

Existing `shop_manager` and `service_writer` users will automatically receive the new
manager-only permissions on next `seed:run`. No manual intervention required.

---

## Multi-Tenant Scoping

The existing `tenant-context-middleware.js` handles tenant and operating-entity scoping.
This RBAC enhancement does **not** change tenant scoping behaviour:

- `req.context.tenantId` — set by tenant-context middleware (unchanged)
- `req.context.operatingEntityId` — set by tenant-context middleware (unchanged)
- `req.user.rbac.locationIds` — set by `loadUserRbac` from `user_locations` table (unchanged)

Shop-level location scoping (restricting a shop_clerk to specific shop locations) is supported
by the existing `user_locations` table + `requireLocationAccess` middleware from `rbac-middleware.js`.
To restrict a shop_clerk to a single location, add a row to `user_locations` for that user
and use `requireLocationAccess(...)` on location-sensitive routes.
