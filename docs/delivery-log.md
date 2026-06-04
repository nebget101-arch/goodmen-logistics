# Delivery Log

Track all work progress through the development lifecycle.

| Jira Key | Event | Date | Notes |
|----------|-------|------|-------|
| FN-1541 | Bug Created | 2026-05-07 | [Parts Catalog] Price save no-op for invoice-uploaded parts — under FN-1090 (`epic:quick-add-part`); integration `integration/FN-1541`; subtasks FN-1543 (FE), FN-1544 (BE), FN-1545 (QA) |
| FN-1542 | Bug Created | 2026-05-07 | [Warehouse Receiving] Quick-Add qty input + line alignment + header card sizing (3 UI defects bundled) — under FN-1477 (`epic:warehouse-receiving`); integration `integration/FN-1542`; subtasks FN-1546 (FE), FN-1547 (QA) |
| FN-1543 | Subtask Queued | 2026-05-07 | [FE] Investigate + fix Save no-op for bulk-uploaded parts — Selected for Dev |
| FN-1544 | Subtask Queued | 2026-05-07 | [BE] Reconcile bulk-upload insert with `partsService.createPart()` — Selected for Dev |
| FN-1545 | Subtask Created | 2026-05-07 | [QA] Validate Price save for both creation paths + Cypress regression — Blocked pending FN-1543, FN-1544 |
| FN-1546 | Subtask Queued | 2026-05-07 | [FE] Quick-Add qty input + Receive-lines alignment + header card sizing — Selected for Dev |
| FN-1547 | Subtask Created | 2026-05-07 | [QA] Validate Warehouse Receiving UI fixes + Cypress smoke — Blocked pending FN-1546 |
| FN-1548 | Bug Created | 2026-05-07 | [Build] Render production build fails — initial bundle 3.07 MB exceeds 3 MB budget by 66.77 kB; no Epic (one-off prod fix); subtasks FN-1549 (FE), FN-1550 (QA) |
| FN-1549 | Subtask Queued | 2026-05-07 | [FE] Trim initial bundle (lazy-load eager components in `app.module.ts`) + glob-exclude `**/*.spec.ts` in `tsconfig.app.json` — Selected for Dev |
| FN-1550 | Subtask Created | 2026-05-07 | [QA] Verify production build < 2.9 MB locally + Render preview deploy succeeds — Blocked pending FN-1549 |
| FN-1472 | Comment Added | 2026-05-07 | User re-confirmed during intake that auto-barcode generation on invoice/photo upload is still broken — duplicate of intake issue #2; FN-1472 in Code Review, no new ticket filed |
| FN-1515 | Epic Created | 2026-05-07 | Work Order page bug bash & enhancements (lane: `epic:wo-create-fixes`) — 6 children: FN-1516..FN-1521 |
| FN-1551 | Bug Created | 2026-05-08 | [P3] WO Basics — Requested By/Assigned To show username; backend `getWorkOrderById` should derive `first_name + last_name` (Selected for Dev, agent:backend) |
| FN-1552 | Bug Created | 2026-05-08 | [P2] WO Financials — Tax field hard-coded 8.5%, override gets overwritten, reactivity unclear; relates to FN-1521 (Selected for Dev, agent:frontend) |
| FN-1553 | Bug Created | 2026-05-08 | [P3] WO Financials — Approval Date & Next Service Due Date pickers render without labels; likely CSS/floatLabel issue (Selected for Dev, agent:frontend) |
| FN-1554 | Bug Created | 2026-05-08 | [P2] WO customer auto-select STILL broken after FN-1518 merge — `loadWorkOrder` reads `customer_id` but backend returns `shop_client_id`; one-line fix at work-order.component.ts:152 (Selected for Dev, agent:frontend) |
| FN-1555 | Bug Created | 2026-05-08 | [P1] [Parts Catalog] PATCH /api/parts/:id/deactivate returns 400 — `partsService.deactivatePart` was never implemented; route at routes/parts.js:837 calls a missing service export (Selected for Dev, agent:backend, no subtasks; lane `epic:quick-add-part`) |
| FN-1556 | Bug Created | 2026-05-08 | [P1] [Parts Catalog] Make manufacturer field optional — fixes Save no-op for AI-uploaded parts (FN-1541 follow-up); user-confirmed RCA via manual test; one-line FE change; subtasks FN-1557 (FE), FN-1559 (QA); Relates FN-1541 |
| FN-1557 | Subtask Queued | 2026-05-08 | [FE] Drop `Validators.required` from manufacturer + remove `*` label marker (parts-catalog.component.ts:60) — Selected for Dev |
| FN-1558 | Subtask Canceled | 2026-05-08 | [BE] Backfill historical rows + tighten `updatePart` — superseded by user decision to make manufacturer optional; no BE change needed |
| FN-1559 | Subtask Created | 2026-05-08 | [QA] Validate Save for AI-uploaded parts with empty manufacturer + new-part creation; manual only — Blocked pending FN-1557 |
| FN-1556 | Bug Rescoped | 2026-05-08 | User confirmed manufacturer-empty was the cause; collapsed scope to one-line FE fix; FN-1558 canceled; integration branch dropped |
| FN-1560 | Bug Created | 2026-05-08 | [P1] [Warehouse Receiving] Quick-add receives at $0 cost; need editable unit cost + part default_cost reconcile — under FN-1477 (`epic:warehouse-receiving`); integration `integration/FN-1560`; subtasks FN-1562 (FE), FN-1566 (BE), FN-1563 (QA) |
| FN-1561 | Bug Created | 2026-05-08 | [P1] [Warehouse Receiving] Invoice upload returns 500 — R2 env vars missing on inventory-service-dev (FN-1511 added SDK, env never propagated); integration `integration/FN-1561`; subtasks FN-1564 (DevOps), FN-1565 (QA); Relates FN-1480 |
| FN-1567 | Bug Created | 2026-05-08 | [P2] [Parts Catalog] Print-label PDF includes full UI screenshot — `@media print` rules in `parts-catalog.component.css` are scoped away by Angular `ViewEncapsulation.Emulated`, so `body * { visibility: hidden }` never applies; under FN-1090 (`epic:quick-add-part`); integration `integration/FN-1567`; subtasks FN-1568 (FE), FN-1569 (QA); Relates FN-1398 |
| FN-1568 | Subtask Queued | 2026-05-08 | [FE] Move parts-catalog print-label `@media print` block from component CSS to global stylesheet (`frontend/src/styles.css`) so `body *` is unscoped — Selected for Dev |
| FN-1569 | Subtask Created | 2026-05-08 | [QA] Validate Print-label PDF contains only 4×2" label (success-modal + row-action entry points; long-name; scanner read; no-barcode safety) — Blocked pending FN-1568 |
| FN-1562 | Subtask Queued | 2026-05-08 | [FE] Editable unit cost on quick-add panel + receive-lines + reconcile prompt — Selected for Dev |
| FN-1566 | Subtask Queued | 2026-05-08 | [BE] PATCH /receiving/:id/lines/:lineId + PATCH /parts/:id (default_cost, default_retail_price) — Selected for Dev |
| FN-1563 | Subtask Created | 2026-05-08 | [QA] Validate quick-add cost flows + receive-line edits + reconcile prompt — Blocked pending FN-1562, FN-1566 |
| FN-1564 | Subtask Queued | 2026-05-08 | [DevOps] Set R2 env vars on fleetneuron-inventory-service-dev (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) and redeploy — Selected for Dev |
| FN-1565 | Subtask Created | 2026-05-08 | [QA] Validate invoice upload jpg/png/pdf, size + type guards, signed URL — Blocked pending FN-1564 |
| FN-1579 | Bug Created | 2026-05-08 | [P1] WO Basics — Vehicle search not scoping to selected customer (regression after `customer_id → shop_client_id` migration `20260317093000`); FE filter at `basics-tab.component.ts:461,469` keys on stale `customer_id`; under FN-1515 (`epic:wo-create-fixes`); subtasks FN-1580 (FE), FN-1581 (QA); Relates FN-1372, FN-1467 |
| FN-1580 | Subtask Queued | 2026-05-08 | [FE] Update `getVehicleSearchPool` + `applyCustomerVehicleFilter` + `onVehicleSelect` to read `shop_client_id ?? customer_id` (single-file change) — Selected for Dev |
| FN-1581 | Subtask Created | 2026-05-08 | [QA] Validate customer-scoped vehicle search (Goodmen unit 1098 happy path + cross-customer exclusion + no-customer fallback + vehicle-first auto-fill) — Blocked pending FN-1580 |
| FN-1516 | Bug Created | 2026-05-07 | [P1] Repair-history widget 502 "AI summary service unavailable" — Relates FN-1499; subtasks FN-1527 (AI), FN-1522 (QA) |
| FN-1517 | Bug Created | 2026-05-07 | [P1] Basics tab — Scheduled/Start/Completion dates and Vehicle Make/Model/Year not populating; schema gap on dates — Relates FN-1367; integration `integration/FN-1517`; subtasks FN-1523 (DB), FN-1524 (BE), FN-1525 (FE), FN-1526 (QA) |
| FN-1518 | Bug Created | 2026-05-07 | [P2] Service Details tab fields not populating; 8 columns missing — integration `integration/FN-1518`; subtasks FN-1528 (DB), FN-1529 (BE), FN-1530 (FE — also fixes FN-1519), FN-1531 (QA) |
| FN-1519 | Bug Created | 2026-05-07 | [P2] Customer not auto-selected on WO open — frontend covered by FN-1530; subtask FN-1532 (QA) |
| FN-1520 | Story Created | 2026-05-07 | [Parts] Selling-price default + inline qty edit — integration `integration/FN-1520`; subtasks FN-1533 (BE), FN-1534 (FE), FN-1535 (QA) |
| FN-1521 | Story Created | 2026-05-07 | [Financials] State-based tax rules engine — integration `integration/FN-1521`; subtasks FN-1536 (AI research CSV), FN-1537 (DB), FN-1538 (BE), FN-1539 (FE), FN-1540 (QA) |
| FN-1522 | Subtask Created | 2026-05-07 | [QA] Validate repair-history retry/recovery — Blocked pending FN-1527 |
| FN-1523 | Subtask Queued | 2026-05-07 | [DB] Add scheduled/start/completion DATE columns to work_orders — Selected for Dev |
| FN-1524 | Subtask Created | 2026-05-07 | [BE] Read/write 3 dates in WO API — Blocked pending FN-1523 |
| FN-1525 | Subtask Created | 2026-05-07 | [FE] Bind dates + vehicle Make/Model/Year on WO load — Blocked pending FN-1524 |
| FN-1526 | Subtask Created | 2026-05-07 | [QA] WO Basics round-trip Cypress + manual evidence — Blocked pending FN-1525 |
| FN-1527 | Subtask Queued | 2026-05-07 | [AI] Investigate + harden repair-history-summary 502 path (timeout, retry, Retry-After) — Selected for Dev |
| FN-1528 | Subtask Queued | 2026-05-07 | [DB] Add 8 service-detail columns to work_orders — Selected for Dev |
| FN-1529 | Subtask Created | 2026-05-07 | [BE] Read/write 8 service-detail fields in WO API — Blocked pending FN-1528 |
| FN-1530 | Subtask Created | 2026-05-07 | [FE] Wire Service Details + customer auto-select on WO load — Blocked pending FN-1529 |
| FN-1531 | Subtask Created | 2026-05-07 | [QA] Service Details round-trip Cypress + manual evidence — Blocked pending FN-1530 |
| FN-1532 | Subtask Created | 2026-05-07 | [QA] Validate customer auto-select on WO open — Blocked pending FN-1530 |
| FN-1533 | Subtask Queued | 2026-05-07 | [BE] Selling-price default + PATCH `/work-orders/:id/parts/:lineId` — Selected for Dev |
| FN-1534 | Subtask Created | 2026-05-07 | [FE] Inline qty edit + selling-price default UI — Blocked pending FN-1533 |
| FN-1535 | Subtask Created | 2026-05-07 | [QA] Selling-price + inline qty edit Cypress — Blocked pending FN-1534 |
| FN-1536 | Subtask Queued | 2026-05-07 | [AI] Research 50-state sales-tax CSV (labor/parts/fees taxability + base rate + citations) — Selected for Dev |
| FN-1537 | Subtask Created | 2026-05-07 | [DB] state_tax_rules table + seed from CSV — Blocked pending FN-1536 |
| FN-1538 | Subtask Created | 2026-05-07 | [BE] Tax computation engine (location.state → rules, per-component flags, tax_breakdown JSONB) — Blocked pending FN-1537 |
| FN-1539 | Subtask Created | 2026-05-07 | [FE] Financials tab tax display + tooltip + override toggle — Blocked pending FN-1538 |
| FN-1540 | Subtask Created | 2026-05-07 | [QA] Tax across TX/CA/MT/FL Karate spec + manual evidence — Blocked pending FN-1539 |
| FN-1506 | Bug Created | 2026-05-07 | [P0] [Work Orders] `work_order_labor_items.mechanic_user_id` column missing — schema drift causing GET 500, PUT 400, parts list stale (3 symptoms, 1 root cause); subtasks FN-1507 (DB), FN-1508 (QA); integration `integration/FN-1506` |
| FN-1507 | Subtask Queued | 2026-05-07 | [DB] Add `mechanic_user_id uuid` column + FK to `users.id` + index on `work_order_labor_items` — Selected for Dev |
| FN-1508 | Subtask Created | 2026-05-07 | [QA] Validate GET WO 200, PUT with labor 200, parts list refreshes after Add Part — Blocked pending FN-1507 |
| FN-1503 | Bug Created | 2026-05-07 | [Receiving] receiving.js joins on users.name (column doesn't exist) — 3 query sites (2 pre-existing on dev + 1 added by FN-1482); under FN-1477 (epic:warehouse-receiving); Relates FN-1482; subtasks FN-1504 (BE), FN-1505 (QA); fix lands on `integration/FN-1478` |
| FN-1504 | Subtask Queued | 2026-05-07 | [BE] Replace `users.name` with `COALESCE(first_name \|\| ' ' \|\| last_name, '')` in receiving.js — Selected for Dev |
| FN-1505 | Subtask Created | 2026-05-07 | [QA] Validate receiving GET endpoints return 200 with populated user names — Blocked pending FN-1504 |
| FN-1496 | Bug Created | 2026-05-07 | [P0] POST /api/work-orders fails with work_orders_status_check violation on dev — DB constraint drift downstream of FN-1468/1469 (Relates) — subtasks FN-1497 (DB), FN-1498 (QA); integration `integration/FN-1496` |
| FN-1497 | Subtask Queued | 2026-05-07 | [DB] Drop+recreate work_orders_status_check to allow legacy + canonical values — Selected for Dev |
| FN-1498 | Subtask Created | 2026-05-07 | [QA] Validate WO create + status transitions after constraint fix — Blocked pending FN-1497 |
| FN-1499 | Bug Created | 2026-05-07 | [P1] Repair-history widget shows error for vehicles with no history — under FN-1429 (epic:ai-tools-phase-1); Relates FN-1447 — subtasks FN-1500 (BE), FN-1501 (FE), FN-1502 (QA); integration `integration/FN-1499` |
| FN-1500 | Subtask Queued | 2026-05-07 | [BE] Graceful no-history response + customer_vehicles resolution + axios throw mapping — Selected for Dev |
| FN-1501 | Subtask Queued | 2026-05-07 | [FE] Empty state for 404 / insufficientHistory; retry chip for 502 — Selected for Dev |
| FN-1502 | Subtask Created | 2026-05-07 | [QA] Validate widget states (no-history, AI down, 500) — Blocked pending FN-1500, FN-1501 |
| FN-1477 | Epic Created | 2026-05-07 | Warehouse Receiving Redesign — quick-add, invoice OCR, activity report (lane: epic:warehouse-receiving) |
| FN-1478 | Story Created | 2026-05-07 | Receiving page redesign — switch to ticket lifecycle + new layout — foundation for FN-1479/1480/1481 — Selected for Dev (subtasks FN-1482/1483 ready, FN-1484 blocked) |
| FN-1479 | Story Created | 2026-05-07 | Quick-add parts panel (search/recent/common) — Backlog, blocked by FN-1478 |
| FN-1480 | Story Created | 2026-05-07 | Invoice upload + AI line extraction (Claude Vision) — Backlog, blocked by FN-1478 |
| FN-1481 | Story Created | 2026-05-07 | Receiving activity report (filters + CSV) — Backlog, blocked by FN-1478 |
| FN-1482 | Subtask Queued | 2026-05-07 | [BE] DRAFT-resume + today summary endpoints — Selected for Dev |
| FN-1483 | Subtask Queued | 2026-05-07 | [FE] Rewire receiving page to ticket lifecycle + redesign — Selected for Dev |
| FN-1484 | Subtask Created | 2026-05-07 | [QA] Validate receiving lifecycle + redesign — Blocked pending FN-1482, FN-1483 |
| FN-1485 | Subtask Created | 2026-05-07 | [BE] recent + common parts at location endpoints — Backlog (FN-1479) |
| FN-1486 | Subtask Created | 2026-05-07 | [FE] Quick-add panel (Search/Recent/Common tabs) — Backlog (FN-1479) |
| FN-1487 | Subtask Created | 2026-05-07 | [QA] Validate quick-add — Blocked (FN-1485, FN-1486) |
| FN-1488 | Subtask Created | 2026-05-07 | [DB] receiving_tickets invoice columns — Backlog (FN-1480) |
| FN-1489 | Subtask Created | 2026-05-07 | [AI] Claude Vision invoice extractor — Backlog (FN-1480) |
| FN-1490 | Subtask Created | 2026-05-07 | [BE] Invoice upload + attach + AI forward — Backlog, blocked by FN-1488/1489 |
| FN-1491 | Subtask Created | 2026-05-07 | [FE] Invoice upload card + review modal — Backlog, blocked by FN-1490 |
| FN-1492 | Subtask Created | 2026-05-07 | [QA] Validate invoice OCR end-to-end — Blocked (FN-1491) |
| FN-1493 | Subtask Created | 2026-05-07 | [BE] Receiving activity endpoint + CSV export — Backlog (FN-1481) |
| FN-1494 | Subtask Created | 2026-05-07 | [FE] Activity tab + drawer + CSV export — Backlog (FN-1481) |
| FN-1495 | Subtask Created | 2026-05-07 | [QA] Validate activity report — Blocked (FN-1493, FN-1494) |
| FN-1472 | Bug Created | 2026-05-07 | [Quick Add Part] AI invoice + photo upload skips auto-barcode and never extracts category — under FN-1090 (epic:quick-add-part); subtasks FN-1473/1474/1475/1476; integration branch `integration/FN-1472` |
| FN-1473 | Subtask Created | 2026-05-07 | [AI] Add `category` to parts-invoice + photo identify Claude prompts — Selected for Dev |
| FN-1474 | Subtask Created | 2026-05-07 | [BE] Route AI bulk-create + photo create through createPart() so FN-1400 barcode generator fires — Selected for Dev |
| FN-1475 | Subtask Created | 2026-05-07 | [FE] Show AI-extracted category in review modals; surface auto-generated barcode after save — Selected for Dev |
| FN-1476 | Subtask Created | 2026-05-07 | [QA] Validate AI invoice + photo upload — auto-barcode + AI category prefill — Blocked pending FN-1473, FN-1474, FN-1475 |
| FN-1412 | Story Done | 2026-05-06 | FMCSA schema + getFmcsaKnex() + tenants.is_internal — merged; unblocks FN-1413/1414/1415 |
| FN-1420 | Subtask Queued | 2026-05-06 | [BE] Census + Authority bulk importer — Selected for Dev (FN-1412 done) |
| FN-1422 | Subtask Queued | 2026-05-06 | [BE] Inspection + Crash + SMS Input bulk importer — Selected for Dev (FN-1412 done) |
| FN-1424 | Subtask Queued | 2026-05-06 | [BE] Manual trigger API + biweekly cron + is_internal middleware — Selected for Dev (FN-1412 done) |
| FN-1425 | Subtask Queued | 2026-05-06 | [FE] Admin UI page for FMCSA imports — Selected for Dev (FN-1412 done; runs in parallel with FN-1424 via API contract in story doc) |
| FN-1429 | Epic Created | 2026-05-06 | AI Tools Phase 1 — wire-up unused handlers + high-impact dispatch/shop features (lane: epic:ai-tools-phase-1) |
| FN-1430 | Story Created | 2026-05-06 | D3: Loads NLQ search bar in dispatch board — under FN-1429 — wire-up only (handler exists) |
| FN-1431 | Story Created | 2026-05-06 | D1: AI Load-to-Driver Assignment — under FN-1429 — net-new handler + route + UI |
| FN-1432 | Story Created | 2026-05-06 | T1: Triage + Live Parts Availability — under FN-1429 — extends work-order-triage handler |
| FN-1433 | Story Created | 2026-05-06 | T2: VIN Repair History Lookup (RAG) — under FN-1429 — net-new handler + route + UI |
| FN-1434 | Story Created | 2026-05-06 | S4: Wire up Toll Invoice Vision — under FN-1429 — UI wire-up only |
| FN-1435 | Subtask Created | 2026-05-06 | [FE] D3 NLQ search bar on dispatch board — Selected for Dev |
| FN-1436 | Subtask Created | 2026-05-06 | [QA] D3 Cypress E2E + evidence — Blocked pending FN-1435 |
| FN-1437 | Subtask Created | 2026-05-06 | [AI] D1 load-driver-match-handler + register in ai-router — Selected for Dev |
| FN-1438 | Subtask Created | 2026-05-06 | [BE] D1 logistics route — aggregate load + drivers, proxy to AI — Selected for Dev |
| FN-1439 | Subtask Created | 2026-05-06 | [FE] D1 Suggest-driver modal on dispatch board — Selected for Dev |
| FN-1440 | Subtask Created | 2026-05-06 | [QA] D1 Cypress E2E + evidence — Blocked pending FN-1437, FN-1438, FN-1439 |
| FN-1441 | Subtask Created | 2026-05-06 | [AI] T1 extend triage handler with stable SKU shape — Selected for Dev |
| FN-1442 | Subtask Created | 2026-05-06 | [BE] T1 triage-enrichment route — join AI parts with inventory — Selected for Dev |
| FN-1443 | Subtask Created | 2026-05-06 | [FE] T1 availability badges + reorder action in triage panel — Selected for Dev |
| FN-1444 | Subtask Created | 2026-05-06 | [QA] T1 Cypress E2E + evidence — Blocked pending FN-1441, FN-1442, FN-1443 |
| FN-1445 | Subtask Created | 2026-05-06 | [AI] T2 vehicle-repair-history-handler with prompt cache — Selected for Dev |
| FN-1446 | Subtask Created | 2026-05-06 | [BE] T2 vehicles repair-history-summary route — Selected for Dev |
| FN-1447 | Subtask Created | 2026-05-06 | [FE] T2 repair-history widget on WO header + expandable panel — Selected for Dev |
| FN-1448 | Subtask Created | 2026-05-06 | [QA] T2 Cypress E2E + evidence — Blocked pending FN-1445, FN-1446, FN-1447 |
| FN-1449 | Subtask Created | 2026-05-06 | [FE] S4 wire toll-invoice vision into tolls-import + invoice-preview — Selected for Dev |
| FN-1450 | Subtask Created | 2026-05-06 | [QA] S4 Cypress E2E + sample invoice fixture — Blocked pending FN-1449 |
| FN-1411 | Epic Created | 2026-05-06 | FMCSA reference dataset (retire scraper) — bulk-download replaces SAFER/SMS/L&I scraping; biweekly cron + manual trigger for FleetNeuron-internal tenant |
| FN-1412 | Story Created | 2026-05-06 | FMCSA schema + getFmcsaKnex() accessor + tenants.is_internal flag — under FN-1411 (epic:fmcsa-reference) — unblocks Stories 2/3/4 |
| FN-1413 | Story Created | 2026-05-06 | FMCSA Census + Operating Authority bulk importer — under FN-1411 — blocked by FN-1412 |
| FN-1414 | Story Created | 2026-05-06 | FMCSA Inspection + Crash + SMS Input bulk importer — under FN-1411 — blocked by FN-1412 |
| FN-1415 | Story Created | 2026-05-06 | Manual FMCSA import trigger (FleetNeuron-internal) + biweekly cron + admin UI — under FN-1411 — blocked by FN-1412 |
| FN-1416 | Story Created | 2026-05-06 | Migrate consumers to fmcsa.* + retire SAFER scraper — under FN-1411 — blocked by FN-1413, FN-1414 |
| FN-1417 | Subtask Created | 2026-05-06 | [DB] Create fmcsa.* schema + tables + tenants.is_internal — Selected for Dev |
| FN-1418 | Subtask Created | 2026-05-06 | [BE] getFmcsaKnex() accessor module — Selected for Dev |
| FN-1419 | Subtask Created | 2026-05-06 | [QA] Validate FMCSA schema migration + getFmcsaKnex() smoke — Blocked pending FN-1417, FN-1418 |
| FN-1420 | Subtask Created | 2026-05-06 | [BE] Census + Authority bulk importer — Blocked pending FN-1412 |
| FN-1421 | Subtask Created | 2026-05-06 | [QA] Validate Census + Authority importer — Blocked pending FN-1420 |
| FN-1422 | Subtask Created | 2026-05-06 | [BE] Inspection + Crash + SMS Input bulk importer — Blocked pending FN-1412 |
| FN-1423 | Subtask Created | 2026-05-06 | [QA] Validate Inspection + Crash + SMS importer + parity check — Blocked pending FN-1422 |
| FN-1424 | Subtask Created | 2026-05-06 | [BE] Manual trigger API + biweekly cron + is_internal middleware — Blocked pending FN-1412 |
| FN-1425 | Subtask Created | 2026-05-06 | [FE] Admin UI page for FMCSA imports (FleetNeuron-internal) — Blocked pending FN-1412 |
| FN-1426 | Subtask Created | 2026-05-06 | [QA] Validate manual trigger + cron + tenant gating — Blocked pending FN-1424, FN-1425 |
| FN-1427 | Subtask Created | 2026-05-06 | [BE] fmcsa-reference service + migrate consumers + delete scraper — Blocked pending FN-1413, FN-1414 |
| FN-1428 | Subtask Created | 2026-05-06 | [QA] Parity validation + latency benchmarks + scraper retirement check — Blocked pending FN-1427 |
| FN-1405 | Story Created | 2026-05-06 | Wire Bins/Users/Supply-Rules tabs into Edit Location modal (Jira/code drift — components exist, never wired) — standalone — Selected for Dev |
| FN-1406 | Story Created | 2026-05-06 | Locations admin list — AI dark-theme redesign + responsive columns — under FN-1351 (epic:ux-redesign) — Selected for Dev |
| FN-1407 | Subtask Created | 2026-05-06 | [FE] Replace 3 placeholder blocks with bins/users/supply-rules tab components — Selected for Dev |
| FN-1408 | Subtask Created | 2026-05-06 | [QA] Full CRUD + visibility validation on each Edit Location tab — Blocked pending FN-1407 |
| FN-1409 | Subtask Created | 2026-05-06 | [FE] Re-tokenize locations-list to AI dark theme + fix column layout — Selected for Dev |
| FN-1410 | Subtask Created | 2026-05-06 | [QA] Visual + responsive validation of redesigned Locations list — Blocked pending FN-1409 |
| FN-1398 | Story Created | 2026-05-06 | Barcode generator + printable label on part create — under FN-1090 (epic:quick-add-part) — Selected for Dev |
| FN-1399 | Subtask Created | 2026-05-06 | [FE] JsBarcode + QR label component, print flow on part create — Selected for Dev |
| FN-1400 | Subtask Created | 2026-05-06 | [BE] Auto-generate unique `FN-XXXXXXXX` barcode on POST /api/parts (parts.service.js) — Selected for Dev |
| FN-1401 | Subtask Created | 2026-05-06 | [QA] Validate generation + print + 1D & QR scanner read — Blocked pending FN-1399, FN-1400 |
| FN-1395 | Story Created | 2026-05-06 | Redesign sidebar company switcher (avatar + MC chip + search + keyboard nav) — under FN-1351 — Selected for Dev |
| FN-1396 | Subtask Created | 2026-05-06 | [FE] Build CompanySwitcher component & integrate into shell — Selected for Dev |
| FN-1397 | Subtask Created | 2026-05-06 | [QA] Validate company switcher redesign (manual + evidence) — Blocked pending FN-1396 |
| FN-1392 | Story Created | 2026-05-05 | Dispatch drivers list redesign + extracted Edit Driver routed page (UX) — under FN-1351 — Selected for Dev |
| FN-1393 | Subtask Created | 2026-05-05 | [FE] Redesign list, extract Edit Driver page, remove +New Driver — Selected for Dev |
| FN-1394 | Subtask Created | 2026-05-05 | [QA] Validate list redesign + Edit Driver page — Blocked pending FN-1393 |
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
| FN-1113 | Epic Created | 2026-05-04 | AI-first Reports Center — turn Reports into AI-native intelligence center |
| FN-1114 | Story Created | 2026-05-04 | Reports: AI narrative panel (Sonnet, prompt-cached) — unblocks FN-1118, FN-1120 |
| FN-1115 | Story Created | 2026-05-04 | Reports: Anomaly detection callouts — unblocks FN-1120 |
| FN-1116 | Story Created | 2026-05-04 | Reports: Report-context chat side-panel — unblocks FN-1120 |
| FN-1117 | Story Created | 2026-05-04 | Reports: Natural-language filter parser |
| FN-1118 | Story Created | 2026-05-04 | Reports: Branded PDF export with embedded narrative — blocked by FN-1114 |
| FN-1119 | Story Created | 2026-05-04 | Reports: Drill-down deep-links to Loads/Drivers/Customers |
| FN-1120 | Story Created | 2026-05-04 | Reports: Theme tokenization + a11y pass — blocked by FN-1114, FN-1115, FN-1116 |
| FN-1121 | Subtask Created | 2026-05-04 | [FE] Narrative panel component — Selected for Dev |
| FN-1123 | Subtask Created | 2026-05-04 | [AI] Narrative endpoint (Sonnet, prompt-cached) — Selected for Dev |
| FN-1127 | Subtask Created | 2026-05-04 | [QA] Narrative panel validation — Blocked pending FN-1121, FN-1123 |
| FN-1131 | Subtask Created | 2026-05-04 | [FE] Anomaly chip row — Selected for Dev |
| FN-1134 | Subtask Created | 2026-05-04 | [AI] Anomalies endpoint (structured output) — Selected for Dev |
| FN-1135 | Subtask Created | 2026-05-04 | [QA] Anomalies validation — Blocked pending FN-1131, FN-1134 |
| FN-1136 | Subtask Created | 2026-05-04 | [FE] Chat drawer component — Selected for Dev |
| FN-1137 | Subtask Created | 2026-05-04 | [AI] Chat endpoint with cached dataset block — Selected for Dev |
| FN-1138 | Subtask Created | 2026-05-04 | [QA] Chat drawer validation — Blocked pending FN-1136, FN-1137 |
| FN-1142 | Subtask Created | 2026-05-04 | [FE] NL filter input — Selected for Dev |
| FN-1149 | Subtask Created | 2026-05-04 | [AI] Parse-query endpoint (Haiku, cached) — Selected for Dev |
| FN-1155 | Subtask Created | 2026-05-04 | [QA] NL filter validation — Blocked pending FN-1142, FN-1149 |
| FN-1160 | Subtask Created | 2026-05-04 | [FE] Wire branded PDF export button — Selected for Dev |
| FN-1167 | Subtask Created | 2026-05-04 | [BE] PDF templating in reporting-service — Backlog (blocked by FN-1123) |
| FN-1173 | Subtask Created | 2026-05-04 | [AI] Validate narrative endpoint for PDF embedding — Backlog (blocked by FN-1123) |
| FN-1178 | Subtask Created | 2026-05-04 | [QA] Branded PDF validation — Blocked pending FN-1160, FN-1167, FN-1173 |
| FN-1183 | Subtask Created | 2026-05-04 | [FE] Drill-down routerLink + URL contracts — Selected for Dev |
| FN-1188 | Subtask Created | 2026-05-04 | [QA] Drill-down validation — Blocked pending FN-1183 |
| FN-1191 | Subtask Created | 2026-05-04 | [FE] Re-tokenize Reports SCSS + ARIA — Backlog (blocked by FN-1121, FN-1131, FN-1136) |
| FN-1194 | Subtask Created | 2026-05-04 | [QA] Theme + a11y validation — Blocked pending FN-1191 |
| FN-1294 | Bug Created | 2026-05-04 | Stop card State select never displays persisted/AI-extracted value (drawer + rate-con auto-approve) — Selected for Dev |
| FN-1295 | Subtask Created | 2026-05-04 | [FE] Swap stop-card State + Stop Type selects from [value] to [ngModel] + spec — Selected for Dev |
| FN-1296 | Subtask Created | 2026-05-04 | [QA] Manual validation across drawer + rate-con flows + DELIVERY regression — Blocked pending FN-1295 |
| FN-1297 | Bug Created | 2026-05-04 | AI Insights panel renders empty — frontend `getAiInsights` reads `res.data` but API returns `res.insights` (also severity/type enum drift) — Selected for Dev (agent:frontend) |
| FN-1298 | Bug Created | 2026-05-04 | Single-PDF Auto-Create: Save in manual modal fires no API call after AI extraction — Selected for Dev (agent:frontend) |
| FN-1299 | Story Created | 2026-05-04 | Single-PDF auto-create: route through V2 wizard (ai-extract) — adds animated progress UI, fixes save, retires legacy auto-modal — In Backlog |
| FN-1300 | Subtask Created | 2026-05-04 | [FE] Wire single-PDF hero drop to V2 wizard with pre-loaded file; remove showAutoModal path — Selected for Dev |
| FN-1301 | Subtask Created | 2026-05-04 | [QA] Validate single-PDF flow through V2 wizard; regression on bulk + manual — Blocked pending FN-1300 |
| FN-1124 | Story Done | 2026-05-04 | S1: Daily AI Briefing on Control Center — PR #648 merged to dev (commit 17c752c) |
| FN-1146 | Subtask Selected for Dev | 2026-05-04 | [FE] Ask FleetNeuron NL bar component — unblocked by FN-1124 merge |
| FN-1148 | Subtask Selected for Dev | 2026-05-04 | [BE] `POST /api/ai/ask` route + ai-service classifier — unblocked by FN-1124 merge |
| FN-1302 | Bug Created | 2026-05-04 | S1.bug: Daily AI Briefing aggregator calls 4 nonexistent upstream endpoints (throughput, exceptions/count, drivers/risk/top, vehicles/risk/top) — parented to epic FN-1122 |
| FN-1303 | Subtask Created | 2026-05-04 | [BE] Implement briefing upstream endpoints + fix /api/loads/:id route ordering (UUID-shape guard) — Selected for Dev |
| FN-1304 | Subtask Created | 2026-05-04 | [QA] Validate Daily Briefing returns real upstream data + regression on /api/loads/:id — Blocked pending FN-1303 |
| FN-1305 | Bug Created | 2026-05-04 | Gateway crash loop after PR #651 merge — `/api/insights/trends` (FN-1152) requires knex inside gateway which has no DB deps; fix by moving aggregator to reporting-service. Parented to epic FN-1122. Caused by FN-1152, relates FN-1126. |
| FN-1306 | Subtask Created | 2026-05-04 | [BE] Move trends aggregator from gateway → reporting-service; gateway proxies — Selected for Dev |
| FN-1307 | Subtask Created | 2026-05-04 | [QA] Validate trends endpoint via gateway proxy + verify gateway has no knex/pg in deps — Blocked pending FN-1306 |
| FN-1169 | Subtask Selected for Dev | 2026-05-04 | [FE] S5.fe: Quick Actions component embedded in alerts/insights (parent FN-1129; deps met by FN-1128 Done) |
| FN-1177 | Subtask Selected for Dev | 2026-05-04 | [BE] S7.be: Gateway `GET /api/ai/explain/:token` proxy (parent FN-1132; deps met by FN-1126 Done) |
| FN-1179 | Subtask Selected for Dev | 2026-05-04 | [FE] S7.fe: Drill-down explanation side panel (parent FN-1132) |
| FN-1181 | Subtask Selected for Dev | 2026-05-04 | [DevOps] S8.devops: WebSocket infra, degraded mode, OTel, Render dashboards (parent FN-1133; deps met by FN-1124, FN-1126, FN-1128 Done) |
| FN-1182 | Subtask Selected for Dev | 2026-05-04 | [FE] S8.fe: Degraded-mode banner + a11y audit fixes (parent FN-1133) |
| FN-1185 | Subtask Selected for Dev | 2026-05-04 | [BE] S8.be: Health-aware degraded fallbacks in gateway (parent FN-1133) |
| FN-1308 | Bug Created | 2026-05-04 | S4.bug: Smart Alerts aggregator upstream endpoints return 404 (4 missing routes) — parent FN-1122 |
| FN-1309 | Subtask Selected for Dev | 2026-05-04 | [BE] S4.bug.be: Implement Smart Alerts upstream endpoints (HOS imminent, fatigue/top, inspections/overdue, late-risk) — parent FN-1308 |
| FN-1310 | Subtask Created | 2026-05-04 | [QA] S4.bug.qa: Validate Smart Alerts panel populates after upstream fix — parent FN-1308; Blocked pending FN-1309 |
| FN-1308 | Bug Selected for Dev | 2026-05-04 | Backend subtask FN-1309 ready to pick |
| FN-1130 | Story Selected for Dev | 2026-05-04 | S6: Role-based personalization for Control Center — blockers FN-1124/1126/1128/1129 all Done |
| FN-1171 | Subtask Selected for Dev | 2026-05-04 | [FE] S6.fe: Role-based layout + drag-reorder + reset (parent FN-1130) |
| FN-1172 | Subtask Selected for Dev | 2026-05-04 | [BE] S6.be: Layout persistence endpoints (parent FN-1130) |
| FN-1175 | Subtask Blocked Link | 2026-05-04 | [QA] S6.qa: linked is_blocked_by FN-1171, FN-1172, FN-1174 — stays in Backlog until impl Done |
| FN-1311 | Bug Created | 2026-05-04 | Smart Alert "Reassign load" quick action opens legacy load drawer/modal instead of V2 wizard — caused by FN-1129; parent FN-1122 (Control Center); High priority; frontend-only |
| FN-1312 | Subtask Selected for Dev | 2026-05-04 | [FE] Route load-context quick-action deep-links to V2 wizard (mode=edit) — parent FN-1311 |
| FN-1313 | Subtask Created | 2026-05-04 | [QA] Validate Reassign quick action lands in V2 wizard with prefilled loadId — parent FN-1311; manual; blocked by FN-1312 |
| FN-1314 | Bug Created | 2026-05-04 | Reports narrative API returns 403 AI_FORBIDDEN for all users — root cause: ai-service missing jsonwebtoken dep + gateway never attaches req.user; parent FN-1113 (Reports Center); High priority; relates FN-1114 |
| FN-1315 | Subtask Selected for Dev | 2026-05-04 | [AI] Add jsonwebtoken to ai-service + harden narrative auth resolveUser — parent FN-1314 |
| FN-1316 | Subtask Created | 2026-05-04 | [QA] Validate narrative endpoint + panel for all allowed roles — parent FN-1314; manual; blocked by FN-1315 |
| FN-1317 | Bug Created | 2026-05-04 | reporting-service deploy fails on dev — Cannot find module 'pdfkit' (FN-1167 regression); shared-pkg transitive deps not installed by Render; High priority; relates FN-1167/FN-1118 |
| FN-1318 | Subtask Selected for Dev | 2026-05-04 | [DevOps] Add pdfkit dep to reporting-service package.json + verify Render deploy — parent FN-1317 |
| FN-1319 | Subtask Created | 2026-05-04 | [QA] Smoke-test reporting-service deploy + branded PDF export on dev — parent FN-1317; manual; blocked by FN-1318 |
| FN-1320 | Story Created | 2026-05-04 | DevOps follow-up: render.yaml microservice buildCommands should install goodmen-shared transitive deps (systemic fix for FN-1317 class) — Backlog; relates FN-1317 |
| FN-1321 | Epic Created | 2026-05-05 | Control Center Redesign — Action-Oriented UX (lane: epic:control-center-redesign) |
| FN-1322 | Story Created | 2026-05-05 | Story A: Action Queue — unified, severity-ranked, grouped alerts feed; blocked by FN-1326; blocks FN-1328 |
| FN-1323 | Story Created | 2026-05-05 | Story B: KPI strip + global Today/7d/30d window selector with deltas; blocks FN-1328 |
| FN-1324 | Story Created | 2026-05-05 | Story C: Quick Actions consolidation + global command palette; blocks FN-1328 |
| FN-1325 | Story Created | 2026-05-05 | Story D: AI Briefing + Predictive Insights empty-state cleanup; blocks FN-1328 |
| FN-1326 | Story Created | 2026-05-05 | Story E (FOUNDATION): Severity color system + reusable grouped-alert component; blocks FN-1322 |
| FN-1327 | Story Created | 2026-05-05 | Story F: Role-based default layouts (Owner/Dispatcher/Compliance presets) on top of FN-1130 |
| FN-1328 | Story Created | 2026-05-05 | Story G: Responsive layout pass — collapse rail under 1280px; blocked by FN-1322/1323/1324/1325 |
| FN-1329 | Subtask Created | 2026-05-05 | [FE] S-A.fe: Action Queue component + remove legacy feeds + bulk actions — parent FN-1322; Blocked pending FN-1339 |
| FN-1330 | Subtask Selected for Dev | 2026-05-05 | [BE] S-A.be: Grouped alerts aggregation endpoint — parent FN-1322 |
| FN-1331 | Subtask Created | 2026-05-05 | [QA] S-A.qa: Action Queue validation — parent FN-1322; Blocked pending FN-1329, FN-1330 |
| FN-1332 | Subtask Selected for Dev | 2026-05-05 | [FE] S-B.fe: KPI strip + Today/7d/30d window selector — parent FN-1323 |
| FN-1333 | Subtask Selected for Dev | 2026-05-05 | [BE] S-B.be: Window-scoped stats endpoint with deltas — parent FN-1323 |
| FN-1334 | Subtask Created | 2026-05-05 | [QA] S-B.qa: KPI strip + window selector validation — parent FN-1323; Blocked pending FN-1332, FN-1333 |
| FN-1335 | Subtask Selected for Dev | 2026-05-05 | [FE] S-C.fe: Consolidate Quick Actions + global command palette — parent FN-1324 |
| FN-1336 | Subtask Created | 2026-05-05 | [QA] S-C.qa: Quick Actions + command palette validation — parent FN-1324; Blocked pending FN-1335 |
| FN-1337 | Subtask Selected for Dev | 2026-05-05 | [FE] S-D.fe: Hide empty-baseline cards + first-baseline-by copy — parent FN-1325 |
| FN-1338 | Subtask Created | 2026-05-05 | [QA] S-D.qa: Empty-state cleanup validation — parent FN-1325; Blocked pending FN-1337 |
| FN-1339 | Subtask Selected for Dev | 2026-05-05 | [FE] S-E.fe (FOUNDATION): Severity tokens + grouped-alert component + sample route — parent FN-1326 |
| FN-1340 | Subtask Created | 2026-05-05 | [QA] S-E.qa: Severity system + grouped-alert validation (a11y contrast) — parent FN-1326; Blocked pending FN-1339 |
| FN-1341 | Subtask Selected for Dev | 2026-05-05 | [DB] S-F.db: dashboard_layout_presets table + seeds — parent FN-1327 |
| FN-1342 | Subtask Created | 2026-05-05 | [BE] S-F.be: Read presets from new table in dashboard-layout endpoints — parent FN-1327; Blocked pending FN-1341 |
| FN-1343 | Subtask Created | 2026-05-05 | [FE] S-F.fe: Preset preview + switcher in Control Center settings — parent FN-1327; Blocked pending FN-1342 |
| FN-1344 | Subtask Created | 2026-05-05 | [QA] S-F.qa: Role-based preset validation — parent FN-1327; Blocked pending FN-1341, FN-1342, FN-1343 |
| FN-1345 | Subtask Created | 2026-05-05 | [FE] S-G.fe: Responsive pass — collapse rail under 1280px + mobile rhythm — parent FN-1328; Blocked pending FN-1329, FN-1332, FN-1335, FN-1337 |
| FN-1346 | Subtask Created | 2026-05-05 | [QA] S-G.qa: Responsive validation across 5 breakpoints — parent FN-1328; Blocked pending FN-1345 |
| FN-1091 | Story Done | 2026-05-05 | [Quick Add Part] Manufacturers & Vendors master tables — PR #668 merged to dev; unblocks FN-1096, FN-1101, FN-1106, FN-1109 |
| FN-1096 | Story Selected for Dev | 2026-05-05 | [Quick Add Part] AI Photo-of-Part intake — unblocked by FN-1091 merge |
| FN-1097 | Subtask Selected for Dev | 2026-05-05 | [FN-1096][AI] parts-vision-handler.js (Sonnet 4) — leads chain → FN-1098 → FN-1099 → FN-1100 |
| FN-1101 | Story Selected for Dev | 2026-05-05 | [Quick Add Part] AI Invoice OCR intake (multi-line bulk create) — unblocked by FN-1091 merge |
| FN-1102 | Subtask Selected for Dev | 2026-05-05 | [FN-1101][AI] Invoice OCR handler — leads chain → FN-1103 → FN-1104 → FN-1105 |
| FN-1106 | Story Selected for Dev | 2026-05-05 | [Quick Add Part] Barcode/QR scanner integration — unblocked by FN-1091 merge |
| FN-1107 | Subtask Selected for Dev | 2026-05-05 | [FN-1106][FE] Quick Add → Scan Barcode (reuse existing scanner) — leads → FN-1108 |
| FN-1109 | Story Selected for Dev | 2026-05-05 | [Quick Add Part] Smart defaults + live duplicate detection — unblocked by FN-1091 merge |
| FN-1110 | Subtask Selected for Dev | 2026-05-05 | [FN-1109][BE] /api/parts/duplicate-check (pg_trgm) — leads chain → FN-1111 → FN-1112 |
| FN-1329 | Subtask Selected for Dev | 2026-05-05 | [FE] S-A.fe: Action Queue component + remove legacy feeds + bulk actions — parent FN-1322; unblocked by FN-1326 Done |
| FN-1322 | Story Selected for Dev | 2026-05-05 | Story A: Action Queue — FE FN-1329 queued, BE FN-1330 already Done, QA FN-1331 pending FN-1329 |
| FN-1323 | Story Selected for Dev | 2026-05-05 | Story B: KPI strip — FE FN-1332 + BE FN-1333 already queued |
| FN-1324 | Story Selected for Dev | 2026-05-05 | Story C: Quick Actions + command palette — FE FN-1335 already queued |
| FN-1325 | Story Selected for Dev | 2026-05-05 | Story D: AI Briefing/Predictive Insights empty-state cleanup — FE FN-1337 already queued |
| FN-1327 | Story Selected for Dev | 2026-05-05 | Story F: Role-based default layouts — DB FN-1341 queued; BE/FE/QA chain pending |
| FN-1347 | Bug Created | 2026-05-05 | Build blocker on integration/FN-1327: control-center.component.ts:220 references bare `widgets` (TS2663). One-line fix; rides into existing FN-1327 PR via integration branch. Selected for Dev (frontend). Linked to FN-1327, FN-1343 |
| FN-1351 | Epic Created | 2026-05-05 | UX Redesign — AI-Themed Loads Workspace & Global Chat Polish. Lane label `epic:ux-redesign` added to intake registry. Backlog. |
| FN-1352 | Story Created | 2026-05-05 | Loads list — AI-themed redesign with hybrid row layout, route cell, view toggle & actionable AI Insights. Integration branch `integration/FN-1352`. |
| FN-1353 | Subtask Selected for Dev | 2026-05-05 | [FE] Loads list redesign — hybrid rows, pipeline pill, view toggle, AI insights wiring. Branches off `origin/integration/FN-1352`. |
| FN-1354 | Subtask Created | 2026-05-05 | [QA] Loads list validation — view toggle, filter persistence, AI insights click-through, a11y. Backlog (blocked by FN-1353). |
| FN-1355 | Story Created | 2026-05-05 | Ask Neuron FAB — collision-aware positioning, minimized state, and safe-area contract. Integration branch `integration/FN-1355`. |
| FN-1356 | Subtask Selected for Dev | 2026-05-05 | [FE] FAB Default/Minimized states + `--neuron-fab-safe-bottom` contract + Loads paginator/drawer wiring. Branches off `origin/integration/FN-1355`. |
| FN-1357 | Subtask Created | 2026-05-05 | [QA] FAB validation — overlap fix, mobile default, drawer, persistence, a11y. Backlog (blocked by FN-1356). |
| FN-1359 | Bug Created | 2026-05-05 | Control Center KPI strip returns zeros — /api/dashboard/stats?window=* filters state-of-fleet KPIs by created_at. Parented to FN-1321; Relates to FN-1323, FN-1333. |
| FN-1360 | Subtask Selected for Dev | 2026-05-05 | [BE] Fix dashboard.js windowing — drivers as-of-windowEnd, NULL-safe predicates, vehicles-zero RCA, telemetry, unit tests. Branches off `origin/integration/FN-1359`. |
| FN-1361 | Subtask Created | 2026-05-05 | [QA] Validate KPI counts match Action Queue + DQF page across today/7d/30d. Backlog (blocked by FN-1360). |
| FN-1362 | Bug Created | 2026-05-05 | [Quick Add Part] Invoice review modal light-theme + DB `parts.category` NOT NULL crash on bulk-create + photo intake prefill empty. Parented to FN-1090. |
| FN-1363 | Subtask Selected for Dev | 2026-05-05 | [DB] Drop NOT NULL on parts.category. Branches off `origin/integration/FN-1362`. |
| FN-1364 | Subtask Created | 2026-05-05 | [BE] parts.service create + bulk-create tolerate null/missing category; defensive 'Uncategorized' default. Backlog (blocked by FN-1363). |
| FN-1365 | Subtask Selected for Dev | 2026-05-05 | [FE] Re-tokenize Review Invoice Lines modal to dark theme + add Category column + fix photo prefill response unwrapping + SKU duplicate check on photo flow. Branches off `origin/integration/FN-1362`. |
| FN-1366 | Subtask Created | 2026-05-05 | [QA] Validate dark theme, bulk-create success without category, photo prefill, SKU dedup, unreadable-image fallback. Backlog (blocked by FN-1363, FN-1364, FN-1365). |
| FN-1368 | Bug Created | 2026-05-05 | Parts catalog expand row throws "locationId query parameter is required". Root cause: FN-708 added `getInventoryByPart()` calling `GET /api/inventory?partId=X`, but that route requires `locationId`. Fix: new cross-location endpoint + frontend swap. Relates FN-708. |
| FN-1371 | Subtask Selected for Dev | 2026-05-05 | [BE] Add `GET /api/inventory/by-part/:partId` returning rows for one part across all locations. Branches off `origin/integration/FN-1368`. |
| FN-1373 | Subtask Created | 2026-05-05 | [FE] Point `getInventoryByPart()` at `/inventory/by-part/:partId`. Backlog (blocked by FN-1371). |
| FN-1375 | Subtask Created | 2026-05-05 | [QA] Validate expand row renders multi/single/empty stock states without error; capture screenshots. Backlog (blocked by FN-1373). |
| FN-1367 | Story Created | 2026-05-05 | Create Work Order — Basics tab data wiring & label fixes. Single frontend pass covering 5 linked Bugs (FN-1369/1370/1372/1374/1376). Selected for Dev. |
| FN-1369 | Bug Created | 2026-05-05 | DOT search not populating Quick Create Customer; FMCSA payload arrives but inline form fields stay empty. Selected for Dev (Relates FN-1367). |
| FN-1370 | Bug Created | 2026-05-05 | Search-and-select customer by name typeahead returns no matches; switch to server-side `?search=` query. Selected for Dev (Relates FN-1367). |
| FN-1372 | Bug Created | 2026-05-05 | Vehicle search not returning results; must scope to selected customer. Selected for Dev (Relates FN-1367). |
| FN-1374 | Bug Created | 2026-05-05 | Shop Location dropdown empty; root cause `loadLocations()` assigning `{data, meta}` envelope to `this.locations`. Selected for Dev (Relates FN-1367). |
| FN-1376 | Bug Created | 2026-05-05 | Date fields render with no visible labels (Request/Scheduled/Start/Completion). Selected for Dev (Relates FN-1367). |
| FN-1377 | Subtask Created | 2026-05-05 | [FE] Fix all 5 Basics tab bugs in single branch `frontend/FN-1377/wo-basics-fixes` off `origin/dev`. Selected for Dev. |
| FN-1378 | Subtask Created | 2026-05-05 | [QA] Manual validation of all 5 Basics fixes with screenshot evidence under `docs/stories/evidence/FN-1367/`. Backlog (blocked by FN-1377). |
| FN-1379 | Epic Created | 2026-05-05 | Fleet Equipment Redesign — Trucks/Trailers UX, OO vs Company classification, Vehicle Maintenance History. Lane `epic:fleet-equipment-redesign`. |
| FN-1380 | Story Created | 2026-05-05 | Trucks/Trailers list redesign — unified columns, ownership chip & filter. Selected for Dev. |
| FN-1381 | Story Created | 2026-05-05 | Add/Edit Vehicle form redesign + OO vs Company classification. Backlog (blocked by FN-1380). |
| FN-1382 | Story Created | 2026-05-05 | Vehicle Maintenance History tab — WOs + invoices on detail drawer. Backlog (blocked by FN-1381). |
| FN-1383 | Subtask Created | 2026-05-05 | [FE] List redesign — ownership column, filter chips, trailer parity. Selected for Dev. |
| FN-1384 | Subtask Created | 2026-05-05 | [QA] Validate list redesign. Backlog (blocked by FN-1383). |
| FN-1385 | Subtask Created | 2026-05-05 | [DB] Add `vehicles.ownership_type` enum + backfill. Backlog (queue when FN-1380 done). |
| FN-1386 | Subtask Created | 2026-05-05 | [BE] Vehicles save endpoint accepts/persists ownership_type. Backlog (blocked by FN-1385). |
| FN-1387 | Subtask Created | 2026-05-05 | [FE] Form redesign + Ownership segmented control. Backlog (blocked by FN-1386). |
| FN-1388 | Subtask Created | 2026-05-05 | [QA] Validate form redesign. Backlog (blocked by FN-1387, FN-1386). |
| FN-1389 | Subtask Created | 2026-05-05 | [BE] GET /api/vehicles/:id/maintenance-history (WO+invoice join via VIN). Backlog (queue when FN-1381 done). |
| FN-1390 | Subtask Created | 2026-05-05 | [FE] Maintenance History tab on vehicle detail drawer. Backlog (blocked by FN-1389). |
| FN-1391 | Subtask Created | 2026-05-05 | [QA] Validate Maintenance History tab. Backlog (blocked by FN-1390, FN-1389). |
| FN-1402 | Story Created | 2026-05-06 | Loads list — Table view visual redesign (sticky header, gridlines, theme tokens, status-cell overflow). Parent FN-1351; lane `epic:ux-redesign`. Integration branch `integration/FN-1402`. Selected for Dev. |
| FN-1403 | Subtask Selected for Dev | 2026-05-06 | [FE] Table view redesign — sticky header, gridlines, theme tokens, status-cell overflow, density horizontal padding. Branches off `origin/integration/FN-1402`. |
| FN-1404 | Subtask Created | 2026-05-06 | [QA] Table view redesign validation — visual regression on Cards/Kanban, functionality preservation matrix, density × view evidence. Backlog (blocked by FN-1403). |
| FN-1456 | Story Selected for Dev | 2026-05-06 | FMCSA imports — manual file upload (replaces FMCSA_*_URL env-var path). Decouples from FMCSA captcha (FN-1422) + Socrata href/file slugs (FN-1455). Parent FN-1411; lane `epic:fmcsa-reference`. Integration branch `integration/FN-1456`. |
| FN-1457 | Subtask Selected for Dev | 2026-05-06 | [BE] POST /api/fmcsa/imports/run-upload + queue source plumbing + adapter path-source support. Branches off `origin/integration/FN-1456`. |
| FN-1458 | Subtask Selected for Dev | 2026-05-06 | [FE] FMCSA imports admin — upload modal (file picker + fileType + dryRun + progress bar). Branches off `origin/integration/FN-1456`. Runs parallel to FN-1457 via API contract in story doc. |
| FN-1459 | Subtask Created | 2026-05-06 | [QA] Validate FMCSA bulk-file upload end-to-end (10 manual scenarios + evidence). Backlog (blocked by FN-1457, FN-1458). |
| FN-1464 | Bug Selected for Dev | 2026-05-06 | POST /api/vehicles/customer 500 — `customer_vehicles.customer_id` no longer exists (renamed to `shop_client_id` by FN-37 migration). Tail of FN-37 rename. Integration branch `integration/FN-1464`. |
| FN-1467 | Subtask Selected for Dev | 2026-05-06 | [BE] Rename customer_id → shop_client_id in `routes/vehicles.js` (INSERT + UPDATE allowed/excluded fields); accept either name on incoming JSON. Branches off `origin/integration/FN-1464`. |
| FN-1465 | Subtask Selected for Dev | 2026-05-06 | [FE] basics-tab.component.ts — read `vehicle.shop_client_id`, send `payload.shop_client_id`. Runs parallel to FN-1467 via API contract in story doc. |
| FN-1466 | Subtask Created | 2026-05-06 | [QA] Manual validation of add-customer-vehicle flow on Work Orders page + evidence. Backlog (blocked by FN-1467, FN-1465). |
| FN-1468 | Bug Created | 2026-05-07 | POST /api/work-orders 500 — `requested_by_user_id` missing from work_orders. Audit found `tenant_id`, `cost_type` also missing on work_orders, plus `tenant_id` and `operating_entity_id` missing on invoices. Same drift class as FN-1464. Integration branch `integration/FN-1468`. |
| FN-1469 | Subtask Selected for Dev | 2026-05-07 | [DB] Add missing columns to work_orders (tenant_id, requested_by_user_id, cost_type) + invoices (tenant_id, operating_entity_id). Idempotent migration with hasColumn guards. |
| FN-1470 | Subtask Created | 2026-05-07 | [BE] Fix undeclared `context` ref in updateWorkOrderStatus (work-orders.service.js:488) + plumb cost_type through create/update + audit WO service for residual schema drift. Blocked by FN-1469. |
| FN-1471 | Subtask Created | 2026-05-07 | [QA] Manual validation across 12 WO endpoints (create, update, status, labor, parts/issue/return, charges, documents, generate-invoice, bulk-upload, list). Blocked by FN-1469, FN-1470. |
| FN-1478 | Story Done | 2026-05-08 | Receiving page redesign — switch to ticket lifecycle + new layout. PR #715 merged. Foundation for FN-1480, FN-1481. |
| FN-1479 | Story Done | 2026-05-08 | Quick-add parts panel — search, recent, common at location. PR #717 merged. |
| FN-1488 | Subtask Selected for Dev | 2026-05-08 | [DB] Add invoice columns (`invoice_file_url`, `invoice_extracted_at`, `invoice_extracted_data jsonb`) to receiving_tickets. Idempotent migration. Parent FN-1480; integration branch `integration/FN-1480`. |
| FN-1489 | Subtask Selected for Dev | 2026-05-08 | [AI] Claude Vision invoice extractor — `POST /ai/invoice/extract` returns `{ vendor, reference, invoiceDate, lines[] }`. Default model `claude-haiku-4-5-20251001`. Parallel to FN-1488. Parent FN-1480. |
| FN-1490 | Subtask Created | 2026-05-08 | [BE] Receiving invoice upload endpoint — multipart upload, attach to ticket, forward to AI service. Blocked by FN-1488 (schema). Parent FN-1480. |
| FN-1491 | Subtask Created | 2026-05-08 | [FE] Invoice upload card + review-extracted-lines modal + vendor/reference auto-fill. Blocked by FN-1490. Parent FN-1480. |
| FN-1492 | Subtask Created | 2026-05-08 | [QA] Validate invoice OCR end-to-end (upload → extract → review → apply). Blocked by FN-1491. Parent FN-1480. |
| FN-1493 | Subtask Selected for Dev | 2026-05-08 | [BE] Receiving activity endpoint + CSV export — `GET /api/receiving/activity` and `/activity.csv` with filters and aggregations. Parent FN-1481; integration branch `integration/FN-1481`. |
| FN-1494 | Subtask Created | 2026-05-08 | [FE] Activity tab + ticket detail drawer + filter chips + CSV button. URL-deep-linkable filters. Blocked by FN-1493. Parent FN-1481. |
| FN-1495 | Subtask Created | 2026-05-08 | [QA] Validate activity report (filters, drawer, CSV, mobile, a11y). Blocked by FN-1494. Parent FN-1481. |
| FN-1509 | Bug Selected for Dev | 2026-05-08 | **DEPLOY BLOCKER** — `fleetneuron-inventory-service` crashes on Render with `Cannot find module '@aws-sdk/client-s3'`. Root cause: FN-1480 (commit ba335bb8) added `require('../storage/r2-storage')` to `goodmen-shared/routes/receiving.js`; inventory-service `package.json` doesn't declare `@aws-sdk/*` (other consuming services already do). Integration branch `integration/FN-1509`. |
| FN-1511 | Subtask Selected for Dev | 2026-05-08 | [BE] Add `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (`^3.967.0`) to `inventory-service/package.json`; regen lock. Parent FN-1509. |
| FN-1512 | Subtask Created | 2026-05-08 | [QA] Verify Render deploy reaches Live + smoke test `GET /api/receiving` and FN-1480 invoice upload on dev. Blocked by FN-1511. Parent FN-1509. |
| FN-1510 | Bug Selected for Dev | 2026-05-08 | swagger-jsdoc YAML parse errors emitted on every service boot from `goodmen-shared/routes/auth.js` (malformed `@openapi` block at line 118 — closing `*/` likely missing, swallowing JS code into YAML). Non-fatal log noise. Integration branch `integration/FN-1510`. |
| FN-1513 | Subtask Selected for Dev | 2026-05-08 | [BE] Audit + fix `@openapi` blocks in `goodmen-shared/routes/auth.js`. Parent FN-1510. |
| FN-1514 | Subtask Created | 2026-05-08 | [QA] Verify clean boot logs (zero YAML errors) on auth-users + inventory services; confirm swagger spec still covers `/api/auth/*`. Blocked by FN-1513. Parent FN-1510. |
| FN-1516 | Bug In Progress | 2026-05-07 | Repair-history 502 — AI subtask FN-1527 already Done; Bug rolled to In Progress, QA queued. Parent FN-1515. |
| FN-1522 | Subtask Selected for Dev | 2026-05-07 | [QA] Validate repair-history widget 502 retry + recovery (manual evidence). Predecessor FN-1527 Done. Parent FN-1516. |
| FN-1524 | Subtask Selected for Dev | 2026-05-07 | [BE] Read/write scheduled / start / completion dates in work-order API. Predecessor FN-1523 (DB) Done. Parent FN-1517; integration branch `integration/FN-1517`. |
| FN-1529 | Subtask Selected for Dev | 2026-05-07 | [BE] Read/write Service Details fields in work-order API (covers FN-1518 + FN-1519). Predecessor FN-1528 (DB) Done. Parent FN-1518; integration branch `integration/FN-1518`. |
| FN-1534 | Subtask Selected for Dev | 2026-05-07 | [FE] Inline qty edit on parts table + selling-price default in Add Part dialog. Predecessor FN-1533 (BE) Done. Parent FN-1520; integration branch `integration/FN-1520`. |
| FN-1537 | Subtask Selected for Dev | 2026-05-07 | [DB] state_tax_rules table + seed from CSV produced by FN-1536. Predecessor FN-1536 (AI CSV) Done. Parent FN-1521; integration branch `integration/FN-1521`. |
| FN-1570 | Bug Created | 2026-05-08 | [P2] [Locations Admin] Bins tab returns 404 — `location-bins.js` router never mounted in `logistics-service/server.js` (regression from FN-692). Under FN-679 (new lane `epic:locations-admin` registered). No integration branch (single backend subtask). Subtasks FN-1572 (BE), FN-1571 (QA). |
| FN-1572 | Subtask Queued | 2026-05-08 | [BE] Mount `location-bins` router in `logistics-service/server.js` after auth + tenant middleware — Selected for Dev. |
| FN-1571 | Subtask Created | 2026-05-08 | [QA] Validate Bins tab end-to-end (load, add, bulk create, edit, delete) on dev — Blocked pending FN-1572. |
| FN-1573 | Bug Created | 2026-05-08 | [P2] [Locations Admin] Users tab shows empty state — frontend reads `res.data` but backend returns a bare array; also `LocationUserRecord` declares `user_id`/`username` fields the API does not return. Frontend-only fix under FN-679 (`epic:locations-admin`). No integration branch (single FE subtask). Subtasks FN-1574 (FE), FN-1575 (QA). |
| FN-1574 | Subtask Queued | 2026-05-08 | [FE] Realign `LocationUserRecord` to bare-array `{id, first_name, last_name, email, role, assigned_at}`; drop `user_id`/`username` refs in users-tab template and component — Selected for Dev. |
| FN-1575 | Subtask Created | 2026-05-08 | [QA] Validate Users tab end-to-end (load with rows, empty state, assign, remove with correct UUID in DELETE URL) on dev — Blocked pending FN-1574. |
| FN-1576 | Bug Created | 2026-05-08 | [P2] [Work Orders Hub] KPI cards (Open / Waiting Parts / Completed Today / Overdue) show 0 — `computeStats()` in `maintenance.component.ts:242` likely uses status enum values that don't match the wire format from `GET /work-orders`. Under FN-1515 (`epic:wo-create-fixes`). Single-agent FE bug, no subtasks (Selected for Dev, agent:frontend). |
| FN-1577 | Bug Created | 2026-05-08 | [P3] [Work Orders Hub] Assigned To filter dropdown shows raw technician UUIDs — `loadDriversAsMechanics()` falls back to `\|\| d.id` when `first_name`/`last_name` are missing on the `getDrivers()` response. Under FN-1515 (`epic:wo-create-fixes`); related to FN-1551 (different surface). Single-agent BE bug, no subtasks (Selected for Dev, agent:backend). |
| FN-1578 | Bug Created | 2026-05-08 | [P2] [Work Orders Hub] Date From/To filter excludes WOs created on the To date — `applyClientFilters()` parses `YYYY-MM-DD` as UTC midnight then `setHours()` in local time, breaking the boundary in non-UTC zones (`maintenance.component.ts:318-327`). Under FN-1515 (`epic:wo-create-fixes`). Single-agent FE bug, no subtasks (Selected for Dev, agent:frontend). |
| FN-1583 | Epic Created | 2026-05-08 | AI-powered spreadsheet → Loads importer (lane: `epic:loads-import`) — Phase 1 stories FN-1584 (BE+DB), FN-1585 (AI), FN-1586 (FE); Phase 2 placeholders FN-1587 (per-row free-text), FN-1588 (async/queued >500 rows). Mirrors fuel-import-wizard pattern. |
| FN-1584 | Story Created | 2026-05-08 | [BE+DB] Spreadsheet import — preview/stage/commit endpoints + idempotency + fuzzy-match wiring; integration `integration/FN-1584`; subtasks FN-1589 (DB), FN-1590 (BE), FN-1591 (QA-Karate); Blocked by FN-1585 (AI contract first); blocks FN-1586. |
| FN-1585 | Story Created | 2026-05-08 | [AI] loads-spreadsheet-handler (Claude Sonnet, JSON, prompt cache, file-level call) + status/billing enum normalization + multi-stop pattern detection; integration `integration/FN-1585`; subtasks FN-1592 (AI), FN-1593 (QA); blocks FN-1584. |
| FN-1586 | Story Created | 2026-05-08 | [FE] loads-import-wizard (6 steps) + duplicate review modal + result screen; integration `integration/FN-1586`; subtasks FN-1594 (FE), FN-1595 (QA-Cypress); Blocked by FN-1584 for E2E commit. |
| FN-1587 | Story Created | 2026-05-08 | [Phase 2 placeholder] Per-row free-text parsing for messy blob columns — Backlog only, no subtasks; blocked by Phase 1. |
| FN-1588 | Story Created | 2026-05-08 | [Phase 2 placeholder] Async/queued processing for >500-row files — Backlog only, no subtasks; blocked by Phase 1. |
| FN-1589 | Subtask Queued | 2026-05-08 | [DB] `load_import_batches` + `load_import_rows` Knex migration (tenant-scoped, status enum, JSONB ai_metadata + result_summary, FK to loads on row.resulting_load_id) — Selected for Dev. |
| FN-1590 | Subtask Created | 2026-05-08 | [BE] `/api/loads/import/{preview,stage,commit/:batchId,batches,batches/:id}` — fuzzy match brokers/drivers/vehicles, threshold-based DRAFT vs NEW (`LOADS_IMPORT_AUTO_THRESHOLD` default 0.85), idempotent commit, 500-row cap → 413 — Blocked pending FN-1589. |
| FN-1591 | Subtask Created | 2026-05-08 | [QA-Karate] API tests for import endpoints (happy/multi-broker/duplicate/low-confidence/multi-stop/freetext/oversize/cache-hit/tenant-isolation/RBAC) + 8 sample CSV/XLSX fixtures — Blocked pending FN-1590, FN-1592. |
| FN-1592 | Subtask Queued | 2026-05-08 | [AI] `loads-spreadsheet-handler.js` at `backend/microservices/ai-service/src/handlers/` — Claude Sonnet, system prompt with cache_control ephemeral, JSON-only output, `load_ai_extractions` cache lookup, fallback path — Selected for Dev. |
| FN-1593 | Subtask Created | 2026-05-08 | [QA] AI handler unit tests with recorded fixtures (3+ broker formats incl. multi-stop variants) — Blocked pending FN-1592. |
| FN-1594 | Subtask Queued | 2026-05-08 | [FE] `loads-import-wizard` component tree (6 step components) + duplicate review modal + result screen + `LoadsImportService`; entry button on loads dashboard; AI dark theme — Selected for Dev (scaffolding may start in parallel; commit-step E2E needs FN-1590). |
| FN-1595 | Subtask Created | 2026-05-08 | [QA-Cypress] E2E for wizard (happy path + duplicate flow + low-confidence + mapping override + multi-stop pattern override + size limits + tenant isolation) — Blocked pending FN-1594, FN-1590. |
| FN-1584 | Story Queued | 2026-05-08 | Loads-import BE+DB Story transitioned to Selected for Dev for board visibility (sub-tasks FN-1589/1590/1591 carry the actual lifecycle). |
| FN-1585 | Story Queued | 2026-05-08 | Loads-import AI Story transitioned to Selected for Dev (sub-tasks FN-1592/1593 carry the lifecycle). |
| FN-1586 | Story Queued | 2026-05-08 | Loads-import FE Story transitioned to Selected for Dev (sub-tasks FN-1594/1595 carry the lifecycle). |
| FN-1596 | Bug Created | 2026-05-08 | [P1] [Loads Import] AI Analysis step renders empty mapping — FE/BE contract drift across 5 fields (`aiMapping` vs `columnMapping`, `rawHeader` vs `sourceHeader`, `preview` vs `sampleRows`, `'multi'` vs `'multi_row\|extra_columns\|free_text'`, `pickup_address` vs `pickup_address1`). FE was built to FN-1594 model that diverged from FN-1585 wire contract; AI service IS returning the mapping, FE just reads wrong keys. Single-agent FE fix, no sub-tasks (Selected for Dev, agent:frontend); under FN-1583 (`epic:loads-import`). |
| FN-1597 | Bug Created | 2026-05-08 | [P1] [Loads Import] BE drops AI columnMapping due to envelope unwrap bug + poisons `load_ai_extractions` cache. AI handler returns `{success, data: {columnMapping, ...}, meta}`; consumer in `loads-import-service.js` treats envelope as if AI fields were top-level (caches envelope, then reads `aiResult.columnMapping` → null). Once cached, every re-upload returns `cacheHit:true, columnMapping:null`. Independent of FN-1596 — both must merge for feature to work. Single-agent BE fix, no sub-tasks (Selected for Dev, agent:backend); Relates FN-1596; under FN-1583 (`epic:loads-import`). |
| FN-1598 | Bug Created | 2026-05-08 | [P1] [Loads Import] Validate step's "Continue to Commit" button stays disabled even with 272/272 ok rows + result counts will be blank. Stage response BE/FE drift: BE returns `{ok, needsReview, errors}` but FE `StageResponse` reads `okCount/needsReviewCount/errorCount` → `canProceed` is `NaN > 0 = false`. Same drift queued in commit response: BE `{created:{auto, needsReview}, duplicates, errors}` vs FE `{autoCreatedCount, needsReviewCount, duplicatesSkippedCount, errorCount}` — bundled together. Single-agent FE fix, no sub-tasks (Selected for Dev, agent:frontend); Relates FN-1596, FN-1597; under FN-1583 (`epic:loads-import`). |
| FN-1596 | Bug Merged | 2026-05-08 | PR #751 (`3b16e598`) merged to dev — FE wizard aligned to FN-1585 wire contract. Transitioned to Done. AI Analysis step now renders mapping rows. |
| FN-1597 | Bug Merged | 2026-05-08 | PR #752 (`01ce4183`) merged to dev — BE unwraps AI envelope to `body.data` and self-heals poisoned cache via shape-guard in `lookupAiCache`. Transitioned to Done. `/preview` response now carries non-null `columnMapping` / `statusEnumMapping` / `multiStopPattern`. |
| FN-1599 | Bug Created | 2026-05-08 | [P1] [Loads Import] Commit drops mapped fields — `commitBatch()` only INSERTs 16 cols, never persists pickup/delivery/completed dates, never falls back to textual `driver_name` when fuzzy match fails, never consults `ai_metadata.statusEnumMapping` (force-DRAFTs); `billing_status` enum works, `status` doesn't. Under FN-1583 (`epic:loads-import`); integration `integration/FN-1599`; subtasks FN-1601 (BE), FN-1602 (QA). Blocks FN-1600 (shared file `loads-import-mapper.js`). |
| FN-1600 | Bug Created | 2026-05-08 | [P1] [Loads Import] `Pickup`/`Delivery` columns with combined "City, ST" not parsed — AI emits `CITY_STATE_COMBINED` warning but no splitter exists; `pickup_city`/`pickup_state` save null and `buildStopsFromRow()` skips stop creation. Under FN-1583 (`epic:loads-import`); integration `integration/FN-1600`; subtasks FN-1603 (BE), FN-1604 (QA). Blocked by FN-1599. |
| FN-1601 | Subtask Queued | 2026-05-08 | [BE] Persist dates, driver_name fallback, apply statusEnumMapping in commitBatch — Selected for Dev. |
| FN-1602 | Subtask Created | 2026-05-08 | [QA] Validate dates, driver_name, status enum persist after commit (manual) — Blocked pending FN-1601. |
| FN-1603 | Subtask Created | 2026-05-08 | [BE] Add `parseCombinedCityState()` util + wire into `applyColumnMapping` when `CITY_STATE_COMBINED` warning fires — Blocked pending FN-1601 (shared file `loads-import-mapper.js`). |
| FN-1604 | Subtask Created | 2026-05-08 | [QA] Validate combined "City, ST" cells split correctly and stops are created (manual) — Blocked pending FN-1603. |
| FN-1605 | Bug Created | 2026-05-08 | [P1] [Recommend Driver] Suggest-driver always returns `"AI service unavailable"` empty on dev — root: logistics route in `loads.js` collapses every AI failure (4xx/5xx/timeout/network) to one misleading string + no pre-flight for missing equipmentClass / origin geocode. Under FN-1429 (`epic:ai-tools-phase-1`); integration `integration/FN-1605`; subtasks FN-1606 (DevOps audit), FN-1607 (BE error-mode differentiation + pre-flight), FN-1608 (QA). Blocks FN-1431. |
| FN-1606 | Subtask Queued | 2026-05-08 | [DevOps] Audit `AI_SERVICE_URL` / `ANTHROPIC_API_KEY` on dev + pull Render logs for failing recommend-driver call (load `3230a7ef…`) to identify true failure mode — Selected for Dev. |
| FN-1607 | Subtask Created | 2026-05-08 | [BE] Differentiate AI 4xx/5xx/timeout/network in `/api/loads/:id/recommend-driver` reasoning + pre-flight short-circuit on missing equipmentClass/origin geocode + tests — Blocked pending FN-1606. |
| FN-1608 | Subtask Created | 2026-05-08 | [QA] Validate suggest-driver shows accurate reasoning across 5 scenarios on dev (manual + screenshots) — Blocked pending FN-1606, FN-1607. |
| FN-1609 | Bug Created | 2026-05-08 | [P1] [Loads Import] Commit 500s on `load_stops` insert — JS `Date.toString()` form ("Thu May 07 2026 00:00:00 GMT+0000 (Coordinated Universal Time)") flows from `buildStopsFromRow` (mapper.js) into `stop_date` unparsed; top-level loads INSERT calls `parseImportDate` but stops INSERT only `trimOrNull`s. Under FN-1583 (`epic:loads-import`); single-agent fix, no subtasks (matches FN-1597/1599/1600 pattern); Selected for Dev, agent:backend. |
| FN-1610 | Bug Created | 2026-05-08 | [P2] [Control Center] Daily briefing + 7-day trends use UTC for "today" — late-evening US users see tomorrow's empty briefing + forward-shifted trend window; root: `briefing-aggregator.js:5-7` `todayUtcDate()` and `trend-aggregator.js:21,29-48`. Fix: FE passes `localDate=YYYY-MM-DD`, BE honors + cache-keys it (UTC fallback preserved). Under FN-1122 (`epic:control-center`); integration `integration/FN-1610`; subtasks FN-1611 (BE), FN-1612 (FE), FN-1613 (QA). |
| FN-1611 | Subtask Queued | 2026-05-08 | [BE] Honor `localDate` query param in briefing + trends; include in cache key; UTC fallback for missing — Selected for Dev. |
| FN-1612 | Subtask Queued | 2026-05-08 | [FE] Pass user-local date to briefing + trends services + new `shared/utils/local-date.ts` helper — Selected for Dev. |
| FN-1613 | Subtask Created | 2026-05-08 | [QA] Validate Control Center localDate flow + cross-tz cache isolation + refresh bypass; manual + screenshots — Blocked pending FN-1611, FN-1612. |
| FN-1614 | Bug Created | 2026-05-09 | [P1] [Warehouse Receiving] Invoice upload returns `aiError=AI_UPSTREAM_ERROR` — `AI_SERVICE_URL` not set on `fleetneuron-inventory-service` (render.yaml block + dev/prod dashboard). `extractInvoiceViaAi` defaults to `http://localhost:4100`, axios throws inside the container, mapped to `AI_UPSTREAM_ERROR`. File saves to R2 fine; AI extraction never runs. Sibling to FN-1561 (R2 env miss). Under FN-1477 (`epic:warehouse-receiving`); integration `integration/FN-1614`; subtasks FN-1615 (DevOps), FN-1616 (QA); Relates FN-1480. |
| FN-1615 | Subtask Queued | 2026-05-09 | [DevOps] Add `AI_SERVICE_URL` to `fleetneuron-inventory-service` (render.yaml + dev/prod Render dashboard) and redeploy dev — Selected for Dev. |
| FN-1616 | Subtask Created | 2026-05-09 | [QA] Validate invoice OCR end-to-end on dev (PDF + JPG, re-upload, auto-fill rule, evidence under `docs/stories/evidence/FN-1614/`) — Blocked pending FN-1615. |
| FN-1617 | Epic Created | 2026-05-09 | "AI Tools Phase 2 — Strategic dispatch, market intelligence, partner integrations" — new lane `epic:ai-tools-phase-2` (registered in `.claude/skills/intake/SKILL.md`); 4 research-spike stories (FN-1618 partner integrations, FN-1619 load profitability, FN-1620 contract-win analysis, FN-1621 market briefing). |
| FN-1618 | Story Queued | 2026-05-09 | Spike: Third-party partner integrations (factoring + ELD) — vendor matrix + architecture proposal — agent:ai, no subtasks (research-only) — Selected for Dev. |
| FN-1619 | Story Queued | 2026-05-09 | Spike: Per-load profitability + market-rate overlay + AI negotiation assistant — agent:ai, builds on FN-502 cost model — Selected for Dev. |
| FN-1620 | Story Queued | 2026-05-09 | Spike: AI dedicated-freight contract win analysis — RFP discovery + scoring model — agent:ai, depends on FN-1411 FMCSA dataset shape — Selected for Dev. |
| FN-1621 | Story Queued | 2026-05-09 | Spike: Daily public-market briefing + hot-area dispatching — agent:ai, extends FN-1124, must work on free public data only — Selected for Dev. |
| FN-1622 | Bug Created | 2026-05-09 | [Settlements] New-Settlement wizard "Create period" inline form not user-friendly — `.btn-secondary` unstyled (only scoped under `.header-actions`/`.wizard-actions` in settlement-wizard.component.css), cramped row, no validation; no Epic (one-off UX fix); subtasks FN-1623 (FE), FN-1624 (QA). |
| FN-1623 | Subtask Queued | 2026-05-09 | [FE] Restyle settlement-wizard "Create period" sub-form: themed secondary button + icon, visual grouping, disabled/validation gating (canCreatePeriod getter), inline End<Start error — Selected for Dev. |
| FN-1624 | Subtask Created | 2026-05-09 | [QA] Manual UX validation for FN-1622 (9 cases incl. desktop/narrow layouts, validation, no-regression) + screenshots in `docs/stories/evidence/FN-1622/` — Blocked pending FN-1623. |
| FN-1625 | Story Created | 2026-05-09 | DQF — Upload CDL, AI-extract identity + license fields, prefill Add New Driver modal. Excluded fields per user: phone, hireDate, medicalCertExpiry. Mirrors mvr-vision/psp-vision/tolls-invoice-vision pattern. Under FN-1429 (`epic:ai-tools-phase-1`); integration `integration/FN-1625`; subtasks FN-1626 (AI vision handler), FN-1627 (BE route + extraction service), FN-1628 (FE prefill UX), FN-1629 (QA). |
| FN-1626 | Subtask Queued | 2026-05-09 | [AI] cdl-vision-handler — Claude Sonnet vision + cached system prompt + per-field confidence + hallucination guards on zip/state/class/dates — Selected for Dev. |
| FN-1627 | Subtask Queued | 2026-05-09 | [BE] POST /api/dqf/cdl-extract — multer (10 MB, jpg/png/pdf) → AI service → confidence floor 0.6 → camelCase newDriver-shaped response; no PII in logs; no file persistence — Selected for Dev. |
| FN-1628 | Subtask Queued | 2026-05-09 | [FE] DQF "Upload CDL" CTA + extraction call + Add New Driver modal prefill with AI pills + banner + Manual-entry hints on phone/hireDate/medicalCertExpiry — Selected for Dev. |
| FN-1629 | Subtask Created | 2026-05-09 | [QA] 10-scenario manual validation (happy/PDF/partial/total-failure/file-type/oversize/excluded-fields/regression/RBAC/cross-browser) + screenshots in `docs/stories/evidence/FN-1625/` — Blocked pending FN-1626, FN-1627, FN-1628. |
| FN-1630 | Comment Added | 2026-05-09 | User re-reported `cdl_extract_ai_unavailable` 11 min after PR #761 merged to dev (merge 04:13:30 UTC, failure 04:24:50 UTC). No new ticket — within Render Blueprint sync window. If failures persist past 04:30 UTC, follow up via DevOps verification of Render env var on `fleetneuron-drivers-compliance-service`. |
| FN-1630 | Reopened (Code Review → In Progress) | 2026-05-09 | Post-deploy retry STILL fails with `processingMs: 28` (DNS-fail-to-localhost signature). External health probes confirm both services up; render.yaml change verified on dev (commit `207da1b4`). Diagnosis: Render Blueprint sync didn't write the env var to the running service (likely dashboard-managed envVars or no auto-redeploy on env-only change). Action: DevOps must add `AI_SERVICE_URL` manually via Render dashboard → Environment tab on `fleetneuron-drivers-compliance-service` and trigger redeploy. |
| FN-1630 | RCA Correction | 2026-05-09 | User confirmed manual Render dashboard add of `AI_SERVICE_URL=https://fleetneuron-ai-service-dev.onrender.com` (DEV URL) on `fleetneuron-drivers-compliance-service-dev` resolved the failure end-to-end. Surfaced wider RCA: codebase has TWO Blueprint files — `render.yaml` (prod) and `render-dev.yaml` (dev) — and PR #761 only patched the prod file. Manual dev fix is at risk of being wiped on next Blueprint sync. |
| FN-1631 | Bug Created + Queued | 2026-05-09 | [DevOps] Add `AI_SERVICE_URL=https://fleetneuron-ai-service-dev.onrender.com` to `fleetneuron-drivers-compliance-service-dev` block in `render-dev.yaml` (line ~228, before `NODE_ENV`). Direct follow-up to FN-1630 (linked via Relates). Under FN-1429 (`epic:ai-tools-phase-1`); single-file change, no subtasks; user already validated the runtime fix manually so no separate QA subtask. Selected for Dev. |
| FN-1632 | Story Created + Queued | 2026-05-10 | DQF — AI CDL upload accepts multiple files (batch extract + sequential review). Enhancement on shipped FN-1625 single-file flow. Under FN-1429 (`epic:ai-tools-phase-1`); integration `integration/FN-1632`; subtasks FN-1633 (FE), FN-1634 (BE), FN-1635 (QA). AI handler + per-file extraction service unchanged — change is route-level array iteration + queue UI. |
| FN-1633 | Subtask Queued | 2026-05-10 | [FE] Multi-file CDL picker + extraction queue card + sequential Add-Driver review. Selected for Dev. |
| FN-1634 | Subtask Queued | 2026-05-10 | [BE] `/api/dqf/cdl-extract` accepts `upload.array('files', 10)` + returns `{results:[]}`; legacy single-file shape preserved for backward-compat. Selected for Dev. |
| FN-1635 | Subtask Created | 2026-05-10 | [QA] Manual validation of multi-CDL upload, batch queue, partial-failure isolation, single-file regression; evidence in `docs/stories/evidence/FN-1632/`. Blocked pending FN-1633, FN-1634. |
| FN-1636 | Story Created | 2026-05-30 | Dashboard redesign foundation — 6 AI primitives (`<app-kpi-card>`, `<app-ai-segmented-control>`, `<app-ai-skeleton>`, `<app-ai-hero-strip>`, `<app-ai-alert-row>`, `.ai-panel-flat`). Under FN-1351 (`epic:ux-redesign`); integration `integration/FN-1636`; subtasks FN-1638 (FE), FN-1639 (QA). Pure-additive — no edits to existing pages. **Blocks FN-1637**. |
| FN-1637 | Story Created | 2026-05-30 | Dashboard redesign — rewrite `/dashboard` (Fleet Control Center) consuming FN-1636 primitives; new layout per Claude Design prompt (kicker header + timeframe selector + hero strip + KPI clusters + alerts rail with ack/snooze + skeleton loading + `.ai-panel-flat` degraded banner). Under FN-1351 (`epic:ux-redesign`); integration `integration/FN-1637`; subtasks FN-1640 (FE), FN-1641 (QA). **Blocked by FN-1636**. Note: parallel to (not duplicate of) FN-1321 Control Center Redesign — that epic targeted `<app-control-center>` while this story rewrites `dashboard.component.*` per user direction 2026-05-30. |
| FN-1638 | Subtask Queued | 2026-05-30 | [FE] Build 6 dashboard primitives + dev-only sample route `/dev/dashboard-primitives` + unit specs + `docs/AI_THEME_VISUAL_REFERENCE.md` append — Selected for Dev. |
| FN-1639 | Subtask Created | 2026-05-30 | [QA] Visual + a11y sweep on `/dev/dashboard-primitives` (4-status kpi-card, segmented control kbd nav, skeleton aria-busy, hero-strip dominant-severity, alert-row events, `.ai-panel-flat`) — Blocked pending FN-1638. |
| FN-1640 | Subtask Created | 2026-05-30 | [FE] Rewrite `dashboard.component.{html,ts,css}` consuming FN-1636 primitives; delete all legacy classes (`.panel`, `.metric-card`, `.action-chip`, `.filter-select`, `.orbital-loader`, `.dashboard-header*`) — Blocked pending FN-1636. |
| FN-1641 | Subtask Created | 2026-05-30 | [QA] 6-breakpoint visual + a11y + functional regression on `/dashboard` (timeframe URL persistence, ack/snooze, sort toggle, degraded retry, hero empty state) — Blocked pending FN-1640. |
| — | Design Bundle Committed | 2026-05-30 | Roadside redesign spec + theme.css + Claude Design chat transcript landed at `docs/design/roadside/` (Roadside-Redesign-Spec.html 65KB, theme.css 28KB, claude-design-chat.md). Source of truth for FN-1642 + FN-1643. |
| FN-1642 | Story Created | 2026-05-30 | Roadside redesign foundation — 3 components (`<app-status-stepper>` 5-state, `<app-summary-chip>`, `<app-side-rail-tabs>`) + 2 CSS utilities (`.num-field`, `.read-field`) + `ToastService` (audit then build or reuse). Under FN-1351 (`epic:ux-redesign`); integration `integration/FN-1642`; subtasks FN-1644 (FE), FN-1645 (QA). Pure-additive — no edits to existing pages. **Blocks FN-1643**. |
| FN-1643 | Story Created | 2026-05-30 | Roadside redesign — rewrite `/roadside` (Roadside Service AI) consuming FN-1642 primitives per `docs/design/roadside/Roadside-Redesign-Spec.html`. 25-row diff: 6 structural + 5 fields + 4 buttons + 4 icons + 6 copy. Under FN-1351 (`epic:ux-redesign`); integration `integration/FN-1643`; subtasks FN-1646 (FE), FN-1647 (QA). **Blocked by FN-1642**. Out of scope (per spec): backend, `/roadside/:callId`, plan-gating. |
| FN-1644 | Subtask Queued | 2026-05-30 | [FE] Build 3 components + 2 CSS utilities + toast service (audit first) + dev-only sample route `/dev/roadside-primitives` + unit specs + theme-doc append — Selected for Dev. |
| FN-1645 | Subtask Created | 2026-05-30 | [QA] Visual + a11y sweep on `/dev/roadside-primitives` (stepper 5 states + kbd nav, summary-chip emit, side-rail-tabs swap, num-field unit variants, read-field pencil, toast variants) — Blocked pending FN-1644. |
| FN-1646 | Subtask Created | 2026-05-30 | [FE] Rewrite `roadside-board.component.{html,ts,css}` per 25-row diff; consume FN-1642 primitives — Blocked pending FN-1642. |
| FN-1647 | Subtask Created | 2026-05-30 | [QA] 6-breakpoint visual + stepper state matrix (New/Triaged/Dispatched/Resolved) + 25-row diff walkthrough + toast firing + a11y on `/roadside` — Blocked pending FN-1646. |
| FN-1649 | Story Created | 2026-06-02 | Roadside board polish (post-FN-1646) — (1) Status filter `<app-ai-select>` overflows left-rail `.ai-panel` box / clipped by `overflow:hidden`; enlarge filter container so both selects fit + dropdown unclipped. (2) Restyle `New Call` / `Start triage` / `Create public link` CTAs to be friendlier/catchier. Under FN-1351 (`epic:ux-redesign`); integration `integration/FN-1649`; subtasks FN-1650 (FE), FN-1651 (QA). *Relates* FN-1643. Frontend-only; both issues in same `roadside-board.component.{css,html}` → single FE subtask (no conflict). |
| FN-1650 | Subtask Queued | 2026-06-02 | [FE] Fit filter selects in rail box + restyle 3 CTAs in `roadside-board.component.{css,html}` — Selected for Dev. |
| FN-1651 | Subtask Created | 2026-06-02 | [QA] Validate filter fit/overflow + CTA restyle, a11y + no regression on `/roadside` (5 breakpoints + open Status dropdown) — Blocked pending FN-1650. |
| FN-1652 | Epic Created | 2026-06-02 | Live Vehicle Tracking — Telematics Ingestion, Geofencing & Public Share Links (Phase 1). Lane `epic:fleet-equipment-redesign` (per user intake decision — surfaces in Fleet Equipment Redesign swimlane). Research: `docs/design/telematics-tracking-research-2026-06-02.md`. Intake decisions: Samsara+Motive adapters; public page same-domain `/track/:token`; token-only share auth; 7d post-delivery expiry; 30d raw ping retention; PostGIS-or-jsonb deferred to DB agent. 7 Stories FN-1653..FN-1659, 22 subtasks FN-1660..FN-1681. |
| FN-1653 | Story Created | 2026-06-02 | Story A — Telematics ingestion foundation (adapters + webhook + polling). Integration `integration/FN-1653`. Subtasks FN-1660 (DB), FN-1661 (BE), FN-1662 (DevOps), FN-1663 (QA). No deps; blocks FN-1655, FN-1656, FN-1659. |
| FN-1654 | Story Created | 2026-06-02 | Story B — Geofence schema + CRUD (circle + polygon). Integration `integration/FN-1654`. Subtasks FN-1664 (DB), FN-1665 (BE), FN-1666 (FE), FN-1667 (QA). No deps; blocks FN-1655, FN-1659. |
| FN-1655 | Story Created | 2026-06-02 | Story C — Geofence event computation + load-status automation. Integration `integration/FN-1655`. Subtasks FN-1668 (DB), FN-1669 (BE), FN-1670 (QA). Blocked by FN-1653, FN-1654. |
| FN-1656 | Story Created | 2026-06-02 | Story D — Live map UI inside the app. Integration `integration/FN-1656`. Subtasks FN-1671 (FE), FN-1672 (BE), FN-1673 (QA). Blocked by FN-1653; consumes FN-1654 overlay. |
| FN-1657 | Story Created | 2026-06-02 | Story E — Share-link generation + management. Integration `integration/FN-1657`. Subtasks FN-1674 (DB), FN-1675 (BE), FN-1676 (FE), FN-1677 (QA). No deps; blocks FN-1658, FN-1659. |
| FN-1658 | Story Created | 2026-06-02 | Story F — Public tracking page (unauthenticated `/track/:token`). Integration `integration/FN-1658`. Subtasks FN-1678 (FE), FN-1679 (BE), FN-1680 (QA). Blocked by FN-1657. |
| FN-1659 | Story Created | 2026-06-02 | Story G — E2E + k6 load test + security review. Integration `integration/FN-1659`. Subtask FN-1681 (QA). Blocked by Stories A–F (FN-1653..FN-1658). |
| FN-1660 | Subtask Queued | 2026-06-02 | [DB] Telematics schema (providers/devices/position_pings) + 30d retention — Selected for Dev. |
| FN-1661 | Subtask Queued | 2026-06-02 | [BE] TelematicsAdapter + Samsara/Motive adapters + webhook ingress + polling — Selected for Dev. |
| FN-1662 | Subtask Queued | 2026-06-02 | [DevOps] Telematics env vars + gateway route + optional telematics-ingest-service — Selected for Dev. |
| FN-1663 | Subtask Created | 2026-06-02 | [QA] Ingestion contract tests (per-provider fixtures) + load fixtures — Blocked pending FN-1660, FN-1661, FN-1662. |
| FN-1664 | Subtask Queued | 2026-06-02 | [DB] Geofence schema (geofences + geofence_triggers; PostGIS or jsonb) — Selected for Dev. |
| FN-1665 | Subtask Queued | 2026-06-02 | [BE] Geofence CRUD API `/api/geofences` — Selected for Dev. |
| FN-1666 | Subtask Queued | 2026-06-02 | [FE] Geofence library page + Leaflet draw controls — Selected for Dev. |
| FN-1667 | Subtask Created | 2026-06-02 | [QA] Geofence in/out simulation validation — Blocked pending FN-1664, FN-1665, FN-1666. |
| FN-1668 | Subtask Created | 2026-06-02 | [DB] geofence_events table — Backlog (blocked by Story A+B). |
| FN-1669 | Subtask Created | 2026-06-02 | [BE] Geofence event worker + load-status automation — Backlog (blocked by Story A+B). |
| FN-1670 | Subtask Created | 2026-06-02 | [QA] Load-status transition-path integration tests — Blocked pending FN-1668, FN-1669. |
| FN-1671 | Subtask Created | 2026-06-02 | [FE] Live map page (vehicle layer/breadcrumbs/overlay/side panel/filters) — Backlog (blocked by Story A). |
| FN-1672 | Subtask Created | 2026-06-02 | [BE] Vehicle-positions read endpoint + WS broadcast — Backlog (blocked by Story A). |
| FN-1673 | Subtask Created | 2026-06-02 | [QA] Live map visual regression + 500-vehicle perf — Blocked pending FN-1671, FN-1672. |
| FN-1674 | Subtask Queued | 2026-06-02 | [DB] Share-link tables (load_share_links + load_share_link_views) — Selected for Dev. |
| FN-1675 | Subtask Queued | 2026-06-02 | [BE] Share-link API (create/list/revoke) + token hashing + view audit — Selected for Dev. |
| FN-1676 | Subtask Queued | 2026-06-02 | [FE] Share-tracking-link modal on load detail drawer — Selected for Dev. |
| FN-1677 | Subtask Created | 2026-06-02 | [QA] Share-link security validation (guess 404 / expired 410 / revoked 410) — Blocked pending FN-1674, FN-1675, FN-1676. |
| FN-1678 | Subtask Created | 2026-06-02 | [FE] Public tracking page `/track/:token` (standalone, unauth) — Backlog (blocked by Story E). |
| FN-1679 | Subtask Created | 2026-06-02 | [BE] Public token-resolve read API (unauthenticated) — Backlog (blocked by Story E). |
| FN-1680 | Subtask Created | 2026-06-02 | [QA] Public page mobile + 200KB payload budget + reveal-option permutations — Blocked pending FN-1678, FN-1679. |
| FN-1681 | Subtask Created | 2026-06-02 | [QA] End-to-end + k6 load test + security review — Blocked pending Stories A–F. |
| FN-1682 | Story Created | 2026-06-03 | Story H — Demo position-ping simulator + seed loads for client demo. Under FN-1652 (`epic:fleet-equipment-redesign`); integration `integration/FN-1682`; subtasks FN-1683 (BE), FN-1684 (QA). Layers synthetic pings on the real `vehicle_position_pings` table so the existing Story D live map renders moving trucks without a Samsara/Motive feed. |
| FN-1683 | Subtask Created | 2026-06-03 | [BE] Seed + simulator + teardown CLI scripts under `backend/scripts/` — Backlog (blocked by FN-1653, FN-1656). |
| FN-1684 | Subtask Created | 2026-06-03 | [QA] Manual end-to-end demo validation + 1080p / 375px screenshot evidence under `docs/stories/evidence/FN-1682/` — Backlog (blocked by FN-1683). |
| FN-1685 | Epic Created | 2026-06-03 | Billing & Subscription Redesign + Stripe Go-Live. New lane `epic:billing-redesign` ("Billing & Subscription"). Builds on FN-70 (Done). Stories FN-1686..FN-1690. |
| FN-1686 | Story Created | 2026-06-03 | Story A — Stripe production configuration & go-live (devops+backend). Integration `integration/FN-1686`. Subtasks FN-1691 (DevOps), FN-1692 (BE), FN-1693 (QA). No deps; blocks FN-1688, FN-1690. |
| FN-1687 | Story Created | 2026-06-03 | Story B — Trial & payment access enforcement (backend). Integration `integration/FN-1687`. Subtasks FN-1694 (BE), FN-1695 (QA). No deps; blocks FN-1690. |
| FN-1688 | Story Created | 2026-06-03 | Story C — Subscription management API + Customer Portal (backend). Integration `integration/FN-1688`. Subtasks FN-1696 (BE), FN-1697 (QA). Blocked by FN-1686; blocks FN-1689, FN-1690. |
| FN-1689 | Story Created | 2026-06-03 | Story D — Billing page redesign, AI dark theme (frontend). Integration `integration/FN-1689`. Subtasks FN-1698 (FE), FN-1699 (QA). Blocked by FN-1688; blocks FN-1690. |
| FN-1690 | Story Created | 2026-06-03 | Story E — E2E + security validation (qa). Integration `integration/FN-1690`. Subtask FN-1700 (QA). Blocked by FN-1686..FN-1689. |
| FN-1691 | Subtask Queued | 2026-06-03 | [DevOps] Provision STRIPE_* env vars (render.yaml + frontend) + go-live runbook — Selected for Dev. |
| FN-1692 | Subtask Queued | 2026-06-03 | [BE] Stripe config validation + `GET /api/billing/config-status` — Selected for Dev. |
| FN-1693 | Subtask Created | 2026-06-03 | [QA] Verify Stripe config against a test account — Blocked pending FN-1691, FN-1692. |
| FN-1694 | Subtask Queued | 2026-06-03 | [BE] Trial/grace enforcement middleware + payment-failure email (FN-76) + sendTrialReminders repair — Selected for Dev. |
| FN-1695 | Subtask Created | 2026-06-03 | [QA] Enforcement boundaries + payment-failure email + reminder query — Blocked pending FN-1694. |
| FN-1696 | Subtask Created | 2026-06-03 | [BE] Subscription mgmt endpoints + Customer Portal + subscription.deleted sync — Backlog (blocked by FN-1686). |
| FN-1697 | Subtask Created | 2026-06-03 | [QA] Subscription API: proration/cancel/portal/sync/no-leak — Blocked pending FN-1696. |
| FN-1698 | Subtask Created | 2026-06-03 | [FE] Billing page dark-theme redesign + self-service subscription UI — Backlog (blocked by FN-1688). |
| FN-1699 | Subtask Created | 2026-06-03 | [QA] Billing dark theme + a11y + flows + visual regression — Blocked pending FN-1698. |
| FN-1700 | Subtask Created | 2026-06-03 | [QA] Full billing E2E + security validation — Blocked pending Stories A–D (FN-1686..FN-1689). |
| FN-1701 | Epic Created | 2026-06-04 | Concurrent Session Control — Single Active Session + Takeover. New lane `epic:session-management` ("Session Management"). Converts stateless JWT → session-aware auth. Stories FN-1702..FN-1706. |
| FN-1702 | Story Created | 2026-06-04 | Story A — `user_sessions` schema (database). Integration `integration/FN-1702`. Subtasks FN-1707 (DB), FN-1708 (QA). No deps; blocks FN-1703, FN-1706. |
| FN-1703 | Story Created | 2026-06-04 | Story B — Session-aware auth + login conflict/takeover + logout (backend, cross-cutting middleware). Integration `integration/FN-1703`. Subtasks FN-1709 (BE), FN-1710 (QA). Blocked by FN-1702; blocks FN-1704, FN-1705, FN-1706. |
| FN-1704 | Story Created | 2026-06-04 | Story C — Real-time forced-logout via WebSocket per-session targeting (backend). Integration `integration/FN-1704`. Subtasks FN-1711 (BE), FN-1712 (QA). Blocked by FN-1703; blocks FN-1706. |
| FN-1705 | Story Created | 2026-06-04 | Story D — Login takeover dialog + forced-logout handling (frontend). Integration `integration/FN-1705`. Subtasks FN-1713 (FE), FN-1714 (QA). Blocked by FN-1703; consumes FN-1704; blocks FN-1706. |
| FN-1706 | Story Created | 2026-06-04 | Story E — Session control E2E + security validation (qa). Integration `integration/FN-1706`. Subtask FN-1715 (QA). Blocked by FN-1702..FN-1705. |
| FN-1707 | Subtask Queued | 2026-06-04 | [DB] `user_sessions` table migration — Selected for Dev. |
| FN-1708 | Subtask Created | 2026-06-04 | [QA] Verify user_sessions migration (up/down, constraints, indexes) — Blocked pending FN-1707. |
| FN-1709 | Subtask Created | 2026-06-04 | [BE] Session-aware auth middleware + login conflict/takeover + logout + device capture — Backlog (blocked by FN-1702). |
| FN-1710 | Subtask Created | 2026-06-04 | [QA] Conflict/takeover/logout + cross-service revocation + no-leak — Blocked pending FN-1709. |
| FN-1711 | Subtask Created | 2026-06-04 | [BE] Gateway per-user/session WS rooms + targeted `session:revoked` emit — Backlog (blocked by FN-1703). |
| FN-1712 | Subtask Created | 2026-06-04 | [QA] WS session:revoked targeted delivery + no cross-tenant leak — Blocked pending FN-1711. |
| FN-1713 | Subtask Created | 2026-06-04 | [FE] Session-conflict takeover dialog + forced-logout + 401 handling — Backlog (blocked by FN-1703). |
| FN-1714 | Subtask Created | 2026-06-04 | [QA] Takeover dialog UX + real-time kick + 401 fallback + a11y — Blocked pending FN-1713. |
| FN-1715 | Subtask Created | 2026-06-04 | [QA] Full two-browser takeover E2E + cross-service revocation + security — Blocked pending Stories A–D (FN-1702..FN-1705). |
| FN-1716 | Story Created | 2026-06-04 | Story I — Demo simulator: scale to 50 trucks (backend). Under FN-1652 (`epic:fleet-equipment-redesign`); integration `integration/FN-1716`; subtasks FN-1718 (BE), FN-1719 (QA). Blocked by FN-1682 (base simulator, in progress). |
| FN-1717 | Story Created | 2026-06-04 | Story J — 3D live map (MapLibre GL engine swap) + AI-driven truck icons (frontend). Under FN-1652 (`epic:fleet-equipment-redesign`); integration `integration/FN-1717`; subtasks FN-1720 (FE), FN-1721 (QA). Blocked by FN-1656 (base live map, in progress). Intake decision: true 3D via MapLibre GL, not faked 2.5D. |
| FN-1718 | Subtask Created | 2026-06-04 | [BE] Scale demo simulator + seed + teardown to 50 trucks (batched insert) — Backlog (blocked by FN-1682). |
| FN-1719 | Subtask Created | 2026-06-04 | [QA] Verify 50-truck simulator + teardown + tick perf — Blocked pending FN-1718. |
| FN-1720 | Subtask Created | 2026-06-04 | [FE] Swap live map to MapLibre GL (3D) + animated AI truck icons — Backlog (blocked by FN-1656). |
| FN-1721 | Subtask Created | 2026-06-04 | [QA] 3D map interaction + truck icons + 50-truck perf + a11y — Blocked pending FN-1720. |
| FN-1718 | Subtask Queued | 2026-06-04 | [BE] Scale demo simulator to 50 trucks — Selected for Dev (user override: queued ahead of base FN-1682 merge). |
| FN-1720 | Subtask Queued | 2026-06-04 | [FE] MapLibre GL 3D map + AI truck icons — Selected for Dev (user override: queued ahead of base FN-1656 merge). |
| FN-1718 | Bugfix Pushed | 2026-06-04 | [BE] Seed: `.onConflict('zip').ignore()` → `.merge([...])` so demo trucks resolve to real US coords (was scattering 50 trucks across South America/Pacific — pre-existing zip_codes rows with bad coords). Pushed to `backend/FN-1718/demo-50-trucks` (28aea4c1..c5a7ad9a). |
| FN-1722 | Story Created | 2026-06-04 | Story K — Live map polish: US states/brighter basemap, street-level zoom, follow-the-unit, open-coordinate-in-Google-Maps (frontend). Under FN-1652 (`epic:fleet-equipment-redesign`); integration `integration/FN-1722`; subtasks FN-1723 (FE), FN-1724 (QA). Builds on FN-1717 (merged). |
| FN-1723 | Subtask Queued | 2026-06-04 | [FE] US-legible basemap + street zoom + follow-unit + open-in-Maps — Selected for Dev. |
| FN-1724 | Subtask Created | 2026-06-04 | [QA] US legibility + street zoom + follow-unit + Maps link + a11y — Blocked pending FN-1723. |
