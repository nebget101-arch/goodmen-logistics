# RBAC (Role-Based Access Control)

This document describes the RBAC system for the Fleet / Dispatch / Shop / Parts platform.

## Overview

- **Roles** = what a user does (e.g. `dispatcher`, `parts_manager`, `service_writer`).
- **Permissions** = granular actions per module (e.g. `loads.view`, `work_orders.edit`, `inventory.transfer`).
- **Locations** = where a user can operate (e.g. Garland Shop - Hairu, Rockwall Shop). A user can be assigned multiple locations; `super_admin` bypasses location checks.

The legacy `users.role` column is **kept** for backward compatibility. A backfill migration maps existing role values into the new `user_roles` table. New authorization should use RBAC (permissions + locations).

## Database

### Tables

- **roles** – Role definitions (code, name, description).
- **permissions** – Module + action (code = `module.action`).
- **role_permissions** – Which permissions each role has.
- **user_roles** – Which roles each user has.
- **user_locations** – Which locations each user can access.
- **locations** – Extended with `code`, `location_type`, `active` (and optional `division_id`).
- **divisions** – Optional grouping (carrier, shop, parts).

### Migrations

1. **20260307000000_create_rbac_tables.js** – Creates roles, permissions, role_permissions, user_roles, user_locations; adds columns to locations; creates divisions.
2. **20260307000001_backfill_user_roles_from_legacy_role.js** – Copies legacy `users.role` into `user_roles` (admin → super_admin, safety → safety_manager, fleet/dispatch → dispatcher, driver → driver).

### Seed

- **01_rbac_seed.js** – Inserts default roles, full permission grid, role–permission mappings, and default locations (Garland shops, Rockwall, Hutchins, Garland Main Warehouse, Main Office).

Run after migrations:

```bash
# From repo root (with DB env set)
cd backend/packages/goodmen-database && npx knex seed:run
# Or via Docker
docker compose run --rm db-migrations
# Then seed (if your setup runs seeds)
npx knex seed:run
```

## Authorization

### Middleware (goodmen-shared)

1. **authMiddleware** – Sets `req.user` from JWT (id, username, role).
2. **loadUserRbac** – Loads `req.user.rbac`: `{ roles, permissionCodes, locationIds }`. Use after auth on routes that need permission or location checks.
3. **requirePermission(code)** – Ensures the user has the permission (or is super_admin).
4. **requireAnyPermission(codes)** – Ensures the user has at least one of the permissions.
5. **requireLocationAccess(getLocationId)** – Ensures the user can access the given location (or is super_admin). `getLocationId` can be a function `(req) => req.body.location_id` or a static value.
6. **authorizeResource({ permission, getLocationId })** – Combines permission + optional location check.

### Example

```js
const rbac = [authMiddleware, loadUserRbac];

// Require permission only
router.get('/loads', rbac, requirePermission('loads.view'), handler);

// Require permission and location
router.put('/work-orders/:id', rbac, requirePermission('work_orders.edit'), requireLocationAccess((req) => req.body.location_id), handler);
```

## API

### Roles (auth-users-service)

- **GET /api/roles** – List roles (requires `roles.view` or `roles.manage`).
- **GET /api/roles/:id** – Get one role.
- **GET /api/roles/:id/permissions** – List permissions for the role.
- **POST /api/roles** – Create role (requires `roles.manage`).
- **PUT /api/roles/:id** – Update role.
- **PUT /api/roles/:id/permissions** – Set role permissions (body: `permissionIds` or `permissionCodes`).

### Permissions

- **GET /api/permissions** – List all permissions (requires `permissions.view` or `roles.view`/`roles.manage`).

### User access (auth-users-service)

- **GET /api/users/:id/access** – Get user’s roles and locations (requires `users.manage` or `roles.manage`).
- **PUT /api/users/:id/roles** – Set user’s roles (body: `roleIds`).
- **PUT /api/users/:id/locations** – Set user’s locations (body: `locationIds`).

### Locations (logistics-service)

- **GET /api/locations** – List locations (supports `code`, `location_type`, `active`).
- **GET /api/locations/:id** – Get one location.
- **POST /api/locations** – Create location.
- **PUT /api/locations/:id** – Update location.

## Backward compatibility

- The **users.role** column is **not** removed. Existing code that checks `req.user.role` (e.g. legacy `requireRole(['admin'])`) continues to work.
- Backfill migration assigns one role per user from the legacy enum. To give a user multiple roles or locations, use the new APIs (PUT /api/users/:id/roles, PUT /api/users/:id/locations).
- **TODO (later):** Deprecate `users.role` and migrate all route guards to RBAC permission checks; then remove the column in a future migration.

## Test plan (manual / automated)

1. **super_admin** – Can call GET /api/roles, GET /api/permissions, GET /api/users/:id/access; can access all locations.
2. **executive_read_only** – Can view dashboard/reports; cannot create/edit/delete (no create/edit/delete permissions).
3. **dispatcher** – Can access loads (view/create/edit), load_documents; cannot access inventory adjustments or safety admin.
4. **safety_manager** – Can manage drivers, DQF, safety; cannot access settlements or inventory.
5. **service_writer** (assigned to Garland Hairu and Garland Juan) – Can edit work orders only for those locations; GET work order for Rockwall returns 403 or filtered.
6. **parts_manager** – Can receive, transfer, adjust inventory; can manage parts and vendors.
7. **mechanic** – Can update assigned work order labor/parts; cannot finalize invoice (no invoices.bill or equivalent).
8. **driver** / **customer** – Future: only own data; no access to internal admin modules.

Run migrations and seed, then create test users with different roles/locations and call the above APIs with their JWTs to verify.
