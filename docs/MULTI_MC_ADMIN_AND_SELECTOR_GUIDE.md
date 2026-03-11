# Multi-MC Admin + Selector Guide

## Core terms
- **Tenant**: top-level business account boundary. Data and admin operations are scoped here.
- **Operating Entity (Company / MC)**: a legal/operational company under a tenant (MC/DOT identity).
- **Location**: physical branch/shop/yard context; separate from operating-entity context.

## Selector behavior (frontend)
- Global company selector appears when user has more than one accessible operating entity.
- Selected operating entity is used by API requests through shared interceptor header injection.
- Page-level components subscribe to operating-entity changes and refresh data accordingly.
- Labels surface current company context subtly (no redesign).

## Storage and bootstrap
- Access/session info is loaded from `GET /api/auth/me`.
- Operating-entity context is bootstrapped from session access payload.
- Last selected company is persisted client-side and reused when still valid.

## Fallback and stale handling
- If selected company is no longer accessible, context falls back to:
  1. user default operating entity, then
  2. first accessible operating entity.
- Detail pages clear stale records when company changes or fetch fails, to avoid cross-company visual leakage.

## Admin workflow (Phase 7)
1. Admin opens **Account → Company Access Admin**.
2. Admin creates/updates operating entities for tenant.
3. Admin selects a user and assigns accessible entities.
4. Admin sets a default entity for that user.
5. User logs in (or refreshes access) and sees only assigned entities in selector.

## Security model
- Backend enforces tenant scope and permissions.
- Admin endpoints require management permissions (`users.manage` or `roles.manage` on backend policy).
- Frontend visibility is UX-only; backend remains the authority.
