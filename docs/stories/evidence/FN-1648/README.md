# FN-1648 — Evidence

## What's here

| File | What it shows |
|------|---------------|
| `00-app-boots-no-errors.png` | Headless-Chrome screenshot of `/` after the FN-1648 changes — proves the Angular bundle compiles and the app boots without runtime errors after the swap of `<input maxlength="2">` → `<app-ai-select>`. |
| `01-app-loads.png` | Same as above for `/drivers` — auth guard redirects to login (expected behavior), confirming the routing/guards still function. |
| `verification.md` | Manual-verification checklist for reviewers on the deployed dev environment. |

## Why not full Add/Edit Driver screenshots in this PR

Running the full flow (Add Driver modal open with the State select expanded, Zip-blur auto-fill on the routed Edit page) requires:

1. A live backend (the auth-users service, drivers service, etc., not running locally — Docker daemon wasn't available in this implementation session).
2. A valid login session.
3. At least one seeded driver to enter the routed Edit page.

The implementing agent verified instead via:

* **`ng build`** — full Angular production build succeeded with zero errors (template type checking caught one issue with `ReadonlyArray<UsStateOption>` vs `AiSelectOption[]` and it was fixed; see story doc "Key Decisions").
* **Bundle inspection** — `curl http://localhost:4250/main.js | grep "Select CDL state"` returned 2 matches and `grep "stateOptions"` returned 10 matches, confirming the new template bindings are in the compiled output.
* **Unit tests** — `driver-edit.component.spec.ts` now has 3 new tests covering `onZipBlur` happy-path, invalid-zip skip, and 404/error tolerance.

The deployed-dev verification checklist below should be completed by QA / the reviewer once this PR lands on `fleetneuron-logistics-ui-dev`.

## Deployed-dev manual verification checklist (for reviewer / QA)

Open `https://fleetneuron-logistics-ui-dev.onrender.com` after this PR merges.

### A. Add Driver modal (`/drivers` → "Add Driver")

- [ ] Click the **State** field — a dropdown with 51 options opens (Alabama … Wyoming + District of Columbia).
- [ ] Pick "California" — field shows "California" (or "CA" depending on display mode).
- [ ] Click the **CDL State** field — same 51-option dropdown.
- [ ] Type `90210` into **Zip Code** and tab/click out (blur) — City auto-fills to "Beverly Hills", State auto-fills to "CA".
- [ ] Type `00000` into Zip and blur — no console error, no UI crash, City/State unchanged.
- [ ] AI-prefill chip ("AI" pill next to the field label) still appears when CDL extract pre-fills the State field.

**Screenshot to capture**: `add-driver-state-open.png` showing the State dropdown expanded.

### B. Routed Edit Driver page (`/drivers/:id/edit`)

- [ ] Click on any driver row → "Edit" → confirm you land on `/drivers/:id/edit` (not the inline editor).
- [ ] **State** is a select with 51 options.
- [ ] **CDL State** is a select with 51 options.
- [ ] Change Zip to `60601` and blur — City fills "Chicago", State fills "IL".
- [ ] Save → values persist (round-trip via `apiService.updateDriver`).

**Screenshot to capture**: `routed-edit-cdlstate-open.png` showing the CDL State dropdown expanded.

### C. Inline Edit Driver (`/drivers` → row "Edit" button → inline form opens above the table)

- [ ] **editState** is a select.
- [ ] **editCdlState** is a select.
- [ ] Zip blur fills City/State (this already worked pre-FN-1648 — confirm nothing regressed).

**Screenshot to capture**: `inline-edit-zip-autofill.png` after a successful zip blur.

### D. Anti-regression checks

- [ ] Browser DevTools console — zero errors across all three surfaces during the above steps.
- [ ] DevTools Network — `GET https://api.zippopotam.us/us/{zip}` returns 200 for valid zips, 404 for invalid zips (404 must NOT surface to the UI).
- [ ] No `<input maxlength="2">` remains for state/cdlState on driver surfaces — verified by grep at PR-time:
      `grep -rn 'maxlength="2"' frontend/src/app/components/driver-edit frontend/src/app/components/drivers`
      → no matches.
