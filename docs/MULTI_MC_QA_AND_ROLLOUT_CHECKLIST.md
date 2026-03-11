# Multi-MC QA + Rollout Checklist

## QA checklist
- [ ] Login user with single company: selector hidden, data loads normally.
- [ ] Login user with multi-company access: selector visible with correct options.
- [ ] Switch company on dashboard/loads/invoices/settlements/reports/drivers pages and verify refresh.
- [ ] Verify detail pages clear stale data after company switch and fetch failure.
- [ ] Verify no manual page-level header injection is needed (interceptor handles it).
- [ ] Create new operating entity in admin page; verify appears in list.
- [ ] Edit operating entity fields; verify persisted values.
- [ ] Assign user to multiple entities; save and re-open to confirm.
- [ ] Set default entity and confirm default persists.
- [ ] Remove access from an entity and ensure it disappears from user selector.
- [ ] Verify unauthorized user cannot open `/admin/multi-mc`.
- [ ] Verify backend rejects out-of-tenant entity access updates.

## Production rollout checklist
- [ ] Confirm DB migrations for tenant/entity membership tables are applied.
- [ ] Confirm seed/role permissions include required admin permissions.
- [ ] Backfill user operating-entity memberships where needed.
- [ ] Define tenant-level initial operating entities (name, legal name, MC/DOT).
- [ ] Define admin owners for each tenant for ongoing access management.
- [ ] Enable rollout for pilot tenant first, then phased tenant expansion.
- [ ] Monitor API errors for `/api/auth/me` and admin endpoints after release.
- [ ] Monitor support tickets for selector mismatch/default-access issues.
- [ ] Keep rollback path ready (feature route visibility + membership restores).

## Smoke commands / checks
- [ ] Frontend build passes.
- [ ] Backend service boots and routes mount successfully.
- [ ] Authenticated call to `/api/auth/me` returns tenant + operating entity access payload.
- [ ] Admin endpoints return tenant-scoped records only.
