# Frontend RBAC (Role-Based Access Control)

This app uses a **permission- and location-aware** access control system. The UI shows only allowed modules and actions; location dropdowns and filters are limited to the user's allowed locations.

## Where things live

| Item | Path |
|------|------|
| Models & constants | `src/app/models/access-control.model.ts` |
| Access control service | `src/app/services/access-control.service.ts` |
| Permission route guard | `src/app/guards/permission.guard.ts` |
| Structural directives | `src/app/directives/has-permission.directive.ts` |
| Nav config (sidebar) | `src/app/config/nav.config.ts` |

## Expected backend shape

The app expects the backend to return (e.g. from login or `GET /api/auth/me`) an object like:

```json
{
  "user": { "id", "firstName", "lastName", "username", "email" },
  "roles": ["service_writer", "mechanic"],
  "permissions": [
    "dashboard.view",
    "work_orders.view",
    "work_orders.create",
    "work_orders.edit",
    "invoices.view",
    "parts.view"
  ],
  "locations": [
    { "id": "...", "name": "Garland Shop - Hairu" },
    { "id": "...", "name": "Garland Shop - Juan" }
  ]
}
```

If the backend only sends `role` (single string) and no `permissions`, the frontend **derives** permissions from that role so existing auth keeps working.

## AccessControlService

- **`loadAccess()`** – Load access from `GET /api/auth/me`. Use when the app has a token but no access in memory/storage.
- **`setAccessFromLoginResponse(loginRes)`** – Call after login with the login response. Normalizes full `{ user, roles, permissions, locations }` or falls back to `role` + optional `locations`.
- **`clearAccess()`** – Call on logout.

### Permission checks

- **`hasPermission(code)`** – e.g. `hasPermission('work_orders.create')`
- **`hasAnyPermission(codes)`** – e.g. `hasAnyPermission(['work_orders.create', 'work_orders.edit'])`
- **`hasRole(role)`** / **`hasAnyRole(roles)`** – Role checks (prefer permissions for UI)
- **`canSee(tab)`** – Whether the user can see a nav tab (uses `TAB_PERMISSIONS` in the model)
- **`canSeeAny(tabs)`** – Whether the user can see any of the given tabs
- **`isReadOnly()`** – True for `executive_read_only` (hide edit/create buttons)

### Location

- **`getLocations()`** / **`getAllowedLocationIds()`** – User’s allowed locations or their IDs.
- **`hasLocation(locationId)`** / **`canAccessLocation(locationId)`** – Whether the user can access a location.
- **`getFilteredLocations(all)`** – Filter an array of locations (with `id` or `locationId`) to only those the user can access. If the user has no restriction (e.g. super_admin), returns the same list.
- **`filterLocationsById(all)`** – Same idea for `{ id, name }[]`.
- **`hasLocationRestriction()`** – True if the user is restricted to specific locations.

## Route guard

Use **PermissionGuard** with `data.permission` or `data.anyPermission`:

```ts
// app-routing.module.ts
{
  path: 'users/create',
  component: UserCreateComponent,
  canActivate: [AuthGuard, PermissionGuard],
  data: { permission: 'users.create' }
}
// or
data: { anyPermission: ['work_orders.create', 'work_orders.edit'] }
```

If the user lacks the permission(s), they are redirected to `/dashboard`.

## Structural directives

In templates, use:

- **`*appHasPermission="'work_orders.create'"`** – Renders the host element only if the user has that permission.
- **`*appHasAnyPermission="['work_orders.create', 'work_orders.edit']"`** – Renders if the user has at least one of the permissions.

Avoid putting two structural directives on the same element; wrap in `<ng-container>` if you also use `*ngIf`:

```html
<ng-container *ngIf="someCondition">
  <button *appHasPermission="'loads.create'">New Load</button>
</ng-container>
```

## Sidebar / navigation

The sidebar is built from **`NAV_TOP_LINKS`** and **`NAV_SECTIONS`** in `nav.config.ts`. Each link has a `tab` key; visibility is driven by **`access.canSee(tab)`**. Sections use **`tab`** or **`tabs`** (show section if user can see any of the tabs). Do not hardcode role names in the sidebar; keep using `tab` / `tabs` and the permission map in `access-control.model.ts`.

## Location-aware UI

- **Dropdowns**: When loading locations for a dropdown, filter with **`access.getFilteredLocations(allLocations)`** (or `filterLocationsById`) so the user only sees locations they can access.
- **Grids/filters**: Restrict location filter options to the same filtered list.
- **Create forms**: Set default or allowed location from the user’s allowed locations.

Example in a component:

```ts
this.access.getFilteredLocations(this.allLocations).subscribe(...)
// or synchronously:
this.filteredLocations = this.access.getFilteredLocations(this.allLocations);
```

## Auth state integration

- **Login**: After successful login, call **`AccessControlService.setAccessFromLoginResponse(res)`** so access is set (and persisted to `localStorage`).
- **Logout**: Call **`AccessControlService.clearAccess()`** and remove token/role.
- **App init**: If the app has a token but access is not loaded (e.g. refresh), call **`loadAccess()`** so `GET /api/auth/me` can populate access.

## Adding new permissions or tabs

1. Add the permission code to **`PERMISSIONS`** in `access-control.model.ts`.
2. Add a **`TAB_PERMISSIONS`** entry if the feature is a nav tab (e.g. `my_feature: [PERMISSIONS.MY_FEATURE_VIEW]`).
3. In **`derivePermissionsFromRoles`** in `access-control.service.ts`, map the relevant roles to the new permission(s).
4. Use **`*appHasPermission`** / **`hasPermission`** in components or add a nav link with the correct `tab` in `nav.config.ts`.

## Future driver / customer portals

The model is ready for **driver** and **customer** roles. Routes can later be grouped (e.g. `/app/...`, `/driver/...`, `/customer/...`) and different layouts used without changing the central permission/location logic.
