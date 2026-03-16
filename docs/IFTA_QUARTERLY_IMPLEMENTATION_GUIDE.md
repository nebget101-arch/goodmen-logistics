# FleetNeuron – IFTA Quarterly Filing (Implementation Guide)

## What was delivered

### Frontend
- New route: `/compliance/ifta`
- New module/files:
  - `frontend/src/app/compliance/compliance.module.ts`
  - `frontend/src/app/compliance/compliance-routing.module.ts`
  - `frontend/src/app/compliance/ifta.model.ts`
  - `frontend/src/app/compliance/ifta.service.ts`
  - `frontend/src/app/compliance/ifta-quarterly/ifta-quarterly.component.{ts,html,css}`
- Navigation section added under **Compliance** → **IFTA Quarterly**.
- Dark/neon UI with cards, status badge, warning rows, and summary widgets.
- Workflow UX implemented:
  - Create Quarter
  - Select trucks
  - Manual/csv data entry for miles & fuel
  - Run AI review
  - Resolve findings
  - Finalize
  - Export PDF/CSV/JSON

### Backend
- New API route module:
  - `backend/packages/goodmen-shared/routes/ifta.js`
- New deterministic helper service:
  - `backend/packages/goodmen-shared/services/ifta-service.js`
- Wiring updates:
  - `backend/microservices/logistics-service/server.js`
  - `backend/gateway/index.js`
- Plan path support for `/compliance/ifta`:
  - `backend/packages/goodmen-shared/config/plans.js`

### Database
- New schema migration:
  - `20260316193000_create_ifta_quarterly_tables.js`
- New permission migration:
  - `20260316194000_add_ifta_permissions.js`
- New seed migration:
  - `20260316195000_seed_ifta_sample_data.js`

## Data model summary
- `ifta_quarters`
- `ifta_tax_rates`
- `ifta_miles_entries`
- `ifta_fuel_entries`
- `ifta_jurisdiction_summary` (snapshot history + current snapshot)
- `ifta_ai_findings`
- `ifta_exports`
- `ifta_source_files`

## Security
Added permission codes:
- `ifta.view`
- `ifta.edit`
- `ifta.import`
- `ifta.run_ai_review`
- `ifta.finalize`
- `ifta.export`

Frontend RBAC and sidebar tab mapping updated accordingly.

## Deterministic tax engine
The backend computes (non-AI):
- total taxable miles
- total gallons
- fleet MPG
- jurisdiction taxable gallons
- net taxable gallons
- tax due/credit using tax rate table

Each recomputation creates a **new summary snapshot version** and marks older snapshot rows as non-current.

## AI review behavior
`run-ai-review` currently applies deterministic heuristic analysis and stores findings with severity:
- info
- warning
- blocker

Outputs include:
- completeness issues
- mpg outliers
- miles/fuel jurisdiction mismatch
- duplicate receipt suspicion
- outside-quarter purchase warnings
- readiness score
- narrative summary

## API surface (high level)
- Quarter:
  - `GET /api/ifta/quarters`
  - `POST /api/ifta/quarters`
  - `GET /api/ifta/quarters/:id`
  - `PATCH /api/ifta/quarters/:id`
- Miles:
  - `GET /api/ifta/quarters/:id/miles`
  - `POST /api/ifta/quarters/:id/miles`
  - `POST /api/ifta/quarters/:id/miles/import`
  - `PATCH /api/ifta/quarters/:id/miles/:entryId`
  - `DELETE /api/ifta/quarters/:id/miles/:entryId`
- Fuel:
  - `GET /api/ifta/quarters/:id/fuel`
  - `POST /api/ifta/quarters/:id/fuel`
  - `POST /api/ifta/quarters/:id/fuel/import`
  - `PATCH /api/ifta/quarters/:id/fuel/:entryId`
  - `DELETE /api/ifta/quarters/:id/fuel/:entryId`
- Review/Validation:
  - `POST /api/ifta/quarters/:id/recalculate`
  - `POST /api/ifta/quarters/:id/run-ai-review`
  - `GET /api/ifta/quarters/:id/findings`
  - `POST /api/ifta/findings/:findingId/resolve`
  - `POST /api/ifta/quarters/:id/finalize`
- Report/Export:
  - `GET /api/ifta/quarters/:id/report-preview`
  - `GET /api/ifta/quarters/:id/export/pdf`
  - `GET /api/ifta/quarters/:id/export/csv/:kind`
  - `GET /api/ifta/quarters/:id/filing-payload`

## QA checklist

### Core flow
- [ ] Create quarter Qx/year with filing entity.
- [ ] Select one or more trucks and save.
- [ ] Add manual miles row and verify list + totals update.
- [ ] Import miles CSV and verify inserted count.
- [ ] Add manual fuel row and verify duplicate hint behavior.
- [ ] Import fuel CSV and verify inserted count.
- [ ] Run AI review and verify findings + readiness + narrative persist.
- [ ] Resolve a finding and verify resolved state persists.
- [ ] Finalize quarter with valid data.

### Validation blockers
- [ ] Finalize blocked when no trucks selected.
- [ ] Finalize blocked when no miles entries.
- [ ] Finalize blocked when no fuel entries.
- [ ] Finalize blocked on invalid quarter/year.
- [ ] Finalize blocked when miles > 0 and gallons == 0.

### Warnings
- [ ] Warning for miles in jurisdiction with no fuel purchases.
- [ ] Warning for suspected duplicate receipt number.
- [ ] Warning for truck MPG outlier.
- [ ] Warning for purchase date outside quarter.
- [ ] Warning for inactive selected truck.

### Export
- [ ] Export PDF summary successfully downloads.
- [ ] Export CSV miles downloads valid rows.
- [ ] Export CSV fuel downloads valid rows.
- [ ] Export CSV jurisdiction summary downloads valid rows.
- [ ] Filing payload JSON downloads and includes summary/findings.

### Performance and pagination
- [ ] Miles list paginates with limit/offset.
- [ ] Fuel list paginates with limit/offset.
- [ ] Inline edits autosave (debounced) and refresh summary.

## Notes
- Core tax math is deterministic and does not depend on AI.
- Findings are persisted for auditability; snapshot history is retained in summary table by version.
- Exports are logged in `ifta_exports` and quarter status updates to `exported` after export actions.
