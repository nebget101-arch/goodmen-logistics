# FRONTEND_RBAC_NOTES

## Overview
This update adds **permission-aware UI behavior** for FleetNeuron without removing existing route/menu/auth patterns.

The backend remains the source of truth. Frontend gating is additive for better UX alignment and safer navigation behavior.

## Current authorization model (discovery summary)
- **AuthGuard** checks token presence only.
- **PlanGuard** enforces plan-based page access via `subscriptionPlan.includedPages`.
- **PermissionGuard** existed for `permission` / `anyPermission` route data keys.
- **AccessControlService** loads/normalizes `/api/auth/me` and supports role->permission fallback mapping.
- **Sidebar/account menu visibility** is driven by `TAB_PERMISSIONS` + `AccessControlService.canSee()`.
- Some legacy screens still had role checks in-component (e.g., reports page).

## Compatibility strategy implemented
- Added a wrapper service: `PermissionHelperService` with:
  - `hasRole(role)`
  - `hasPermission(permission)`
  - `hasAnyPermission([...])`
  - `hasScopedPermission(permission, scope)`
- Kept existing `AccessControlService` and guard flow intact.
- Extended `UserAccess` model with optional `permissionScopes` for future backend scoped permissions.
- Added role constants including new roles (`shop_manager`, `shop_clerk`, `technician`, `parts_manager`) and `company_admin` compatibility.
- Role fallback remains active when backend permissions are missing.

## Permission resolution behavior
1. Prefer backend-provided `permissions`.
2. If missing, infer from roles in `AccessControlService.derivePermissionsFromRoles()`.
3. For scoped checks (`hasScopedPermission`), support:
   - base permission grant
   - string patterns: `permission:scope` / `permission.scope`
   - optional `permissionScopes` map from `/auth/me`

## Routes updated (additive)
Permission-aware guarding was added to these relevant routes while preserving `AuthGuard` + `PlanGuard`:
- Customers module routes
- Vehicles / Trailers routes
- Maintenance / Work Order routes
- Invoicing routes
- Settlements routes (to prevent direct URL access)
- Reports route

## Shop Clerk UX behavior covered
Shop Clerk can access/intake workflows (when backend allows):
- customers
- vehicles
- work orders
- draft invoices
- payment entry
- document upload

Shop Clerk is restricted in UI for high-risk actions:
- invoice void
- invoice post/send (treated as finalize/post action)
- work-order close (manager/finalize permission)
- settlement/reporting route access via permission checks
- user/role/admin links hidden by nav permission model

## Screens updated for action gating
- Customers list/form
- Vehicles list
- Work order page
- Invoices list/detail
- Reports tab visibility logic (permission-first, legacy role fallback)

## Rollout notes
- This is backward compatible with existing roles and cached sessions.
- `company_admin` now behaves as admin-compatible in permission fallback.
- Existing admin/super_admin behavior is preserved.
- Frontend denies are UX-level only; backend authorization must continue to enforce security.
