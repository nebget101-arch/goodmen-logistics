# FleetNeuron Production Readiness + End-to-End Test Plan

**Date:** March 13, 2026  
**Owner:** Engineering Lead / Release Manager  
**Target:** Production launch in 2 weeks

---

## 1) Goal

This document consolidates:

1. The **minimum feature completion** required to be production-ready.
2. A full **end-to-end test plan** starting from the public trial request UI and covering current platform functionality.

---

## 2) Current State Snapshot

## FleetNeuron Feature Status — Updated March 2026

| Feature | Code Status | Test Status | Deployed | Notes |
|---------|------------|-------------|----------|-------|
| Driver & DQF Management | ✅ Complete | 🚧 Partial | ✅ Yes | |
| Vehicle Maintenance | ✅ Complete | 🚧 Partial | ✅ Yes | |
| Load Management | ✅ Complete | 🚧 Partial | ✅ Yes | |
| Payroll/Settlement | ❌ Not Started | ❌ None | ❌ No | Migration pending |
| Twilio/SendGrid | 🚧 Code only | ❌ Untested | ❌ No | Needs E2E test |
| Employment Application Module | 🚧 Scaffold only | ❌ None | ❌ No | End-to-end implementation pending |
| Android Driver App | ❌ Not Started | ❌ None | ❌ No | Planned only |

### Confirmed working foundation
- Microservices + gateway + database migrations are operational.
- Public trial request flow, admin review flow, and signup token flow are implemented.
- Trial signup provisioning creates tenant + operating entity + admin user.
- Core modules are routed and available under authenticated app routes.

### Must-complete before go-live (P0)
1. **Settlements UI live API wiring** (remove mocks/TODO).
2. **Settlement email endpoint** implementation (currently returns placeholder response only).
3. **Onboarding completion gaps** (employment autosave real endpoint, MVR phase placeholder removal).
4. **Loads dashboard financial add-ons** (lumper/detention/other additions + merge docs TODOs).
5. **Production-grade rate limiting** for public routes (replace in-memory placeholder strategy where needed).

---

## 3) Release Scope

### Public flows
- Marketing homepage + trial request form.
- Trial signup page via activation token.

### Admin/business flows
- Internal trial management APIs (admin UI can be enabled for internal operations when needed).
- Authentication, plan/permission guards.
- Core fleet operations (loads, dispatch, drivers, vehicles, trailers, HOS, audit).
- Settlements, invoicing, reports, inventory, roadside workflows (based on plan and role access).

---

## 4) Environment & Setup Checklist

## 4.1 Required services
- Backend services via Docker compose.
- Frontend app running locally.
- PostgreSQL migrations applied.
- Twilio/SendGrid credentials configured for roadside and trial-related notifications (where required).

## 4.2 Baseline verification
- Gateway health reachable.
- Frontend public home loads.
- Login page reachable.
- Trial plans endpoint responds.

## 4.3 Test accounts and seed data
Prepare:
- 1 platform admin (internal) with access to trial-request admin page.
- New public prospect email for trial request.
- Optional test recipients for email notifications.
- Representative records: drivers, loads, vehicles, parts, work orders, invoices.

---

## 5) End-to-End Test Plan (Public Trial Request → Platform)

## 5.1 Phase A: Public Trial Request

### TRIAL-E2E-001: Submit trial request from public UI
**Entry:** Public page trial form.  
**Steps:**
1. Open trial page.
2. Submit valid payload (company, contact, email, phone, plan).
3. Verify success message.

**Expected:**
- HTTP 201 from public trial endpoint.
- Record exists in `trial_requests` with status `new`.
- Internal + requester notification attempts are logged in response metadata.

### TRIAL-E2E-002: Validation/negative
**Steps:**
1. Submit without required fields.
2. Submit invalid email.

**Expected:**
- HTTP 400 with validation errors.
- No DB record created.

---

## 5.2 Phase B: Admin Trial Queue + Approval

### TRIAL-E2E-003: Admin can view and filter trial requests
**Entry:** Internal admin UI (if enabled) or admin API calls.  
**Steps:**
1. Login as authorized admin.
2. Open trial-request admin page (if enabled) or call admin list endpoint.
3. Filter by status values (`new`, `contacted`, `approved`, etc.).

**Expected:**
- Records list loads.
- Filters and pagination return expected subsets.

### TRIAL-E2E-004: Approve request and verify activation link
**Steps:**
1. Approve a `new` request.
2. Capture returned `activationLink` and expiry.
3. Regenerate link and confirm new token behavior when requested.

**Expected:**
- Status transitions to `approved`.
- Activation link available.
- Approval notification attempt status captured.

### TRIAL-E2E-005: Reject and contacted transitions
**Steps:**
1. Mark request as `contacted`.
2. Reject request.

**Expected:**
- Status transitions are persisted and visible in queue.

---

## 5.3 Phase C: Public Trial Signup Completion

### TRIAL-E2E-006: Signup context by token
**Steps:**
1. Open trial signup URL with valid token.
2. Verify context (company/contact/plan).

**Expected:**
- Context returns `status: ready` for valid approved token.
- Expired token returns 410.
- Invalid token returns 404.

### TRIAL-E2E-007: Complete signup from token
**Steps:**
1. Submit password (+ optional username/first/last name).
2. Observe success state.

**Expected:**
- Trial request transitions to `trial_created`.
- Tenant, operating entity, and admin user are created.
- Signup token invalidated.
- Re-submit returns conflict (`already completed`).

### TRIAL-E2E-008: New trial user login
**Steps:**
1. Login with created credentials.
2. Verify default landing route and session.

**Expected:**
- Login succeeds.
- Access aligns with assigned role and plan.

---

## 5.4 Phase D: Plan Guard / Permission Guard Validation

Run this matrix for each plan created via trial flow:

### BASIC plan user
Should access core pages (dispatch/compliance baseline) and settlements.

### MULTI_MC plan user
Should additionally access multi-entity admin flow.

### END_TO_END plan user
Should additionally access inventory, invoices, reports, settlements, roadside modules.

**Expected:**
- Unauthorized routes are blocked.
- Allowed routes render and load data.

---

## 5.5 Phase E: Core Operations Regression (Everything So Far)

Execute at least one happy-path + one negative-path per module:

1. **Loads & Dispatch**
   - Create/update load, attach docs, status transitions, dispatch board visibility.
   - Verify TODO areas are either completed or excluded from release.

2. **Drivers / DQF / Onboarding**
   - Driver create/edit, DQF status updates.
   - Public onboarding packet completion and e-signature capture.
   - MVR flow must be fully wired if in scope for production.

3. **Vehicles / Trailers / HOS / Audit**
   - CRUD/read operations and key workflows execute without errors.

4. **Maintenance / Work Orders / Invoicing / Credit**
   - Work order lifecycle → invoice creation → send/pay paths.

5. **Inventory suite (end-to-end plan)**
   - Parts, barcode, receiving, transfers, direct sales, reports.

6. **Settlements**
   - Payroll period selection/creation.
   - Settlement draft creation, list/detail retrieval, status actions.
   - Email send must be real implementation (not placeholder) for launch-ready state.

7. **Roadside**
   - Public roadside link flow and dispatcher board flow.
   - Twilio call initiation + webhook path + recording retrieval.
   - Notification emails via SendGrid where configured.

8. **Reports**
   - KPI/report endpoints load and render expected summaries.

---

## 6) Non-Functional Test Plan

## 6.1 Security
- Auth required on protected routes.
- Permission checks enforced server-side.
- Public endpoints reject malformed payloads.
- No sensitive fields leaked in logs/responses.

## 6.2 Reliability
- Retry behavior for external services (Twilio/SendGrid) verified.
- Graceful degraded behavior when providers are unavailable.

## 6.3 Performance
- Critical API response targets met under representative load.
- No major regressions in frontend route load/render.

## 6.4 Rate limiting & abuse controls
- Trial request endpoint and public onboarding/public links should enforce production-safe limits.
- Verify 429 behavior and observability alerts.

---

## 7) Suggested Execution Schedule (10 Business Days)

### Days 1-2
- Close P0 feature gaps.
- Freeze API contracts for release scope.

### Days 3-5
- Execute trial flow E2E (Phases A-D).
- Fix all P0/P1 defects.

### Days 6-8
- Full module regression (Phase E).
- Non-functional and failure-mode testing.

### Days 9-10
- Release rehearsal, rollback drill, sign-off.
- Production canary + launch checklist execution.

---

## 8) Defect Severity & Exit Criteria

## 8.1 Severity
- **P0:** Data loss, auth bypass, blocked login/signup, failed core business workflow.
- **P1:** Major workflow broken with workaround.
- **P2:** Minor issues/cosmetic.

## 8.2 Go-live exit criteria
All must be true:
1. No open P0 defects.
2. All trial-flow E2E tests pass.
3. Core module happy paths pass for in-scope plan tiers.
4. Production credentials, monitoring, and rollback are validated.
5. Stakeholder sign-off completed.

---

## 9) Quick Runbook (Operator)

1. Submit trial request from public UI.
2. Approve request in admin queue.
3. Generate/copy activation link.
4. Complete signup from public signup page.
5. Login as newly created trial admin.
6. Verify plan-based module access.
7. Execute module smoke suite.
8. Confirm logs/metrics/alerts are healthy.

---

## 10) Notes

- This file is the single consolidated source for immediate production-readiness tracking and E2E execution.
- If scope changes, update this document first, then update sprint board and release checklist.
