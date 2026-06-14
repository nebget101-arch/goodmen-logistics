# Delivery Log

Track all work progress through the development lifecycle.

| Jira Key | Event | Date | Notes |
|----------|-------|------|-------|
| FN-272 | Epic Created | 2026-03-26 | Driver Form Date Picker — Match Loads Dashboard Design |
| FN-273 | Story Created | 2026-03-26 | Update driver form date pickers to match Loads Dashboard design |
| FN-273 | In Progress | 2026-03-26 | Frontend agent implementing CSS overrides |
| FN-274 | Subtask Created | 2026-03-26 | Style Add New Driver modal date picker inputs |
| FN-275 | Subtask Created | 2026-03-26 | Style Edit Driver modal date picker inputs |
| FN-276 | Subtask Created | 2026-03-26 | Verify calendar popup dark theme + regression test |
| FN-553 | Story Done | 2026-03-31 | Rename Primary/Additional Payee labels to Driver/Equipment Owner — PR #493 merged |
| FN-566 | Bug Done | 2026-03-31 | EO% not returned by GET /api/drivers/:id — added compensation profile query, PR #496 + hotfix PR #497 merged |
| FN-568 | Bug Created | 2026-03-31 | Expense responsibility data lost on driver reload — 3 root causes identified |
| FN-569 | Subtask Created | 2026-03-31 | Backend: Fix expense responsibility POST close old records + GET sort order — Selected for Dev |
| FN-570 | Subtask Created | 2026-03-31 | Frontend: Decouple saveExpenseResponsibility from savePayeeAssignment — Selected for Dev |
| FN-571 | Subtask Created | 2026-03-31 | QA: Validate expense responsibility persists — Blocked pending FN-569, FN-570 |
| FN-1782 | Story Created | 2026-06-14 | Enforce DOT document readiness before a truck/trailer can be made Active — Backlog |
| FN-1783 | Subtask Created | 2026-06-14 | Backend: readiness rule engine + /readiness endpoint + activation guard (422) — Selected for Dev |
| FN-1784 | Subtask Created | 2026-06-14 | Frontend: activation gating + document-readiness checklist + badge — Selected for Dev |
| FN-1785 | Subtask Created | 2026-06-14 | QA: validate DOT readiness gate (API + UI) — Blocked pending FN-1783, FN-1784 |
| FN-1786 | Epic Created | 2026-06-14 | Customer-uploaded agreements: AI field detection + in-house e-signature engine — Backlog |
| FN-1787 | Story Created | 2026-06-14 | Agreement upload + AI field & signature detection with role assignment — Backlog |
| FN-1791 | Subtask Created | 2026-06-14 | AI: field/signature detection vision handler (FN-1787) — Selected for Dev |
| FN-1792 | Subtask Created | 2026-06-14 | Database: agreement_templates + fields schema (FN-1787) — Selected for Dev |
| FN-1793 | Subtask Created | 2026-06-14 | Backend: upload + template persistence + field-map CRUD (FN-1787) — Selected for Dev |
| FN-1794 | Subtask Created | 2026-06-14 | Frontend: upload + field-mapping/role-assignment UI (FN-1787) — Selected for Dev |
| FN-1795 | Subtask Created | 2026-06-14 | QA: scan + role assignment (FN-1787) — Blocked pending FN-1791..1794 |
| FN-1788 | Story Created | 2026-06-14 | Fill fields, send e-sign link, capture signature, generate signed PDF — Backlog (blocked by FN-1787) |
| FN-1796 | Subtask Created | 2026-06-14 | Database: signature_requests/fields/signatures schema (FN-1788) — Backlog |
| FN-1797 | Subtask Created | 2026-06-14 | Backend: fill + tokenized send + public sign + signed PDF (FN-1788) — Backlog |
| FN-1798 | Subtask Created | 2026-06-14 | Frontend: internal fill + public signer UI + signature capture (FN-1788) — Backlog |
| FN-1799 | Subtask Created | 2026-06-14 | QA: fill→send→sign→signed PDF (FN-1788) — Blocked pending FN-1796..1798 |
| FN-1789 | Story Created | 2026-06-14 | Adapter: Equipment / Motor-Carrier Lease Agreement signing — Backlog (blocked by FN-1787,1788) |
| FN-1800 | Subtask Created | 2026-06-14 | Backend: link equipment-lease signing to vehicle/equipment-owner (FN-1789) — Backlog |
| FN-1801 | Subtask Created | 2026-06-14 | Frontend: entry point + signing status on vehicle record (FN-1789) — Backlog |
| FN-1802 | Subtask Created | 2026-06-14 | QA: equipment lease signing flow (FN-1789) — Blocked pending FN-1800,1801 |
| FN-1790 | Story Created | 2026-06-14 | Adapter: Lease-to-Own driver agreement signing — Backlog (blocked by FN-1787,1788) |
| FN-1803 | Subtask Created | 2026-06-14 | Backend: wire send/sign into lease_agreements lifecycle (FN-1790) — Backlog |
| FN-1804 | Subtask Created | 2026-06-14 | Frontend: send-for-signature + driver signing entry + status (FN-1790) — Backlog |
| FN-1805 | Subtask Created | 2026-06-14 | QA: lease-to-own driver signing + lifecycle (FN-1790) — Blocked pending FN-1803,1804 |
| FN-1806 | Story Created | 2026-06-14 | Visual bbox field-placement editor (drag fields onto document preview) — Backlog (blocked by FN-1787) |
| FN-1807 | Subtask Created | 2026-06-14 | Frontend: drag/resize/add/delete field boxes on document preview (FN-1806) — Backlog |
| FN-1808 | Subtask Created | 2026-06-14 | Backend: field-map endpoint accepts bbox/page edits, adds, deletes (FN-1806) — Backlog |
| FN-1809 | Subtask Created | 2026-06-14 | QA: bbox editor + signed-PDF placement round-trip (FN-1806) — Blocked pending FN-1807,1808 |
