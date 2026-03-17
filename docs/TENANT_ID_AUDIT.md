# Tenant ID Coverage Audit

**Generated:** 2026-03-17  
**Schema source:** `backend/packages/goodmen-database/schema.sql` + all migration files  
**Total tables audited:** 127  
**Multi-tenancy introduced by:** `20260310100000_create_multi_mc_core_tables.js` + `20260310101000_add_multi_mc_scope_columns.js`

---

## Summary

| Status | Count |
|--------|-------|
| ✅ Tables WITH `tenant_id` | 62 |
| ℹ️ Tables WITHOUT — Intentional (system / reference / child) | 61 |
| 🔴 Tables WITHOUT — Action Required | 4 |

> **All 4 action-required gaps are addressed by migration `20260316220000_add_tenant_id_to_unscoped_root_tables.js`.**  
> Run `npx knex migrate:latest` from `backend/packages/goodmen-database` to apply.

---

## Tables WITH `tenant_id` ✅

### Tenancy Core

| Table | Notes |
|-------|-------|
| `tenants` | Root table — IS the tenant; `id` is the FK target for all other `tenant_id` columns |
| `operating_entities` | MC / operating company entities within a tenant |
| `user_tenant_memberships` | Maps users to tenants with per-tenant role; authoritative source for RBAC in multi-tenant context |

### Business Data — Scoped by `20260310101000_add_multi_mc_scope_columns.js`

| Table | Notes |
|-------|-------|
| `users` | Includes `tenant_id`; per-tenant role assignment migrated to `user_tenant_memberships` |
| `locations` | Shop / warehouse / terminal locations per tenant |
| `customers` | Fleet / walk-in / internal customers |
| `customer_vehicles` | Customer-owned vehicles tracked per tenant |
| `customer_audit_log` | Audit trail for customer record changes |
| `drivers` | CDL driver records; root of DQF / HOS / compliance hierarchy |
| `vehicles` | Company fleet vehicles |
| `brokers` | Load brokers / freight intermediaries |
| `payees` | Payment recipients (drivers, owners, contractors) |
| `parts` | Parts catalog per tenant |
| `communication_consents` | Twilio/SMS opt-in consents |
| `expense_payment_categories` | Tenant-defined expense categories |
| `driver_compensation_profiles` | Pay model configs per driver |
| `expense_responsibility_profiles` | Who pays which expenses (company vs driver) |
| `driver_payee_assignments` | Links drivers to payees for settlement |
| `recurring_deduction_rules` | Standing payroll deduction rules |
| `loads` | Freight load records; also has `operating_entity_id` |
| `payroll_periods` | Weekly/bi-weekly pay periods; also has `operating_entity_id` |
| `settlements` | Driver settlement records; also has `operating_entity_id` |
| `driver_onboarding_packets` | Onboarding packet per driver; also has `operating_entity_id` |
| `imported_expense_sources` | Imported fuel card / toll expense batches |
| `work_orders` | Shop repair / maintenance work orders |
| `invoices` | Customer invoices |
| `receiving_tickets` | Parts receiving / PO receipts |
| `inventory_adjustments` | Manual stock adjustments |
| `cycle_counts` | Periodic inventory count sessions |
| `inventory_transfers` | Stock transfers between locations |
| `customer_sales` | Counter / direct parts sales to customers |

### Compliance & Logging

| Table | Notes |
|-------|-------|
| `audit_logs` | System-wide audit trail; `tenant_id` + `operating_entity_id` added by `20260311120000` |

### Employment Applications Module (`20260311130000`)

| Table | Notes |
|-------|-------|
| `employment_applications` | Submitted driver employment applications with `tenant_id` |

### Roadside Service AI Module (`20260311194000`)

| Table | Notes |
|-------|-------|
| `roadside_calls` | Root call record; `tenant_id` + `operating_entity_id` |

### Toll Module (`20260315183000`)

| Table | Notes |
|-------|-------|
| `toll_providers` | Toll provider config (E-ZPass, TxTag, etc.) |
| `toll_accounts` | Tenant toll accounts |
| `toll_devices` | Transponders linked to vehicles |
| `toll_import_mapping_profiles` | Column-mapping profiles for CSV imports |
| `toll_import_batches` | Import batch headers |
| `toll_transactions` | Individual toll charge records |
| `toll_transaction_exceptions` | Unmatched / disputed toll entries |

### Fuel Module (`20260315230000`)

| Table | Notes |
|-------|-------|
| `fuel_providers` | Fuel card provider config (Comdata, EFS, etc.) |
| `fuel_card_accounts` | Tenant fuel card accounts |
| `fuel_import_mapping_profiles` | CSV import column maps |
| `fuel_import_batches` | Import batch headers |
| `fuel_transactions` | Individual fuel purchase records |
| `fuel_transaction_exceptions` | Unmatched / duplicate fuel entries |

### Safety & Claims Module (`20260316000000`)

| Table | Notes |
|-------|-------|
| `safety_incidents` | DOT accident / incident records |
| `safety_claims` | Insurance claim records linked to incidents |

### Lease-to-Own Financing Module (`20260316013000`)

| Table | Notes |
|-------|-------|
| `lease_agreements` | Driver vehicle lease agreements |
| `lease_agreement_audit_log` | Lease record change history |

### IFTA Quarterly Reporting Module (`20260316193000`)

| Table | Notes |
|-------|-------|
| `ifta_quarters` | Quarterly IFTA filing period |
| `ifta_miles_entries` | Mileage entries by jurisdiction |
| `ifta_fuel_entries` | Fuel purchase entries by jurisdiction |
| `ifta_jurisdiction_summary` | Computed tax summary per jurisdiction/quarter |
| `ifta_ai_findings` | AI-flagged anomalies per quarter |
| `ifta_exports` | Generated IFTA report exports |
| `ifta_source_files` | Uploaded source CSVs (miles / fuel) |

### Fixed by `20260316220000_add_tenant_id_to_unscoped_root_tables.js` ⚠️ Pending `migrate:latest`

| Table | Notes |
|-------|-------|
| `divisions` | RBAC org unit; `tenant_id` added, no backfill source (stays NULL until next write) |
| `dqf_documents` | Compliance doc repo; backfilled from `drivers.tenant_id` via `driver_id` |
| `driver_documents` | Onboarding / DQF docs; backfilled from `drivers.tenant_id` via `driver_id` |
| `vehicle_documents` | DOT inspection / registration docs; backfilled from `vehicles.tenant_id` via `vehicle_id` |

---

## Tables WITHOUT `tenant_id` — Intentional (system / reference / child) ℹ️

### Infrastructure

| Table | Reason |
|-------|--------|
| `knex_migrations` | Knex internal migration tracking — never queried by application code |
| `knex_migrations_lock` | Knex advisory lock — never queried by application code |

### RBAC System Tables

| Table | Reason |
|-------|--------|
| `roles` | Role definitions (`admin`, `safety`, `fleet`, `dispatch`) — system-wide codes, identical across all tenants |
| `permissions` | Permission codes (`loads.view`, `work_orders.edit`, etc.) — system-wide catalog |
| `role_permissions` | Maps roles to permissions globally — no tenant variation |
| `user_roles` | ⚠️ Pre-multi-MC role assignment table. Superseded by `user_tenant_memberships` for multi-tenant role resolution. Verify this table is no longer authoritative before deprecation. |
| `user_locations` | User↔location access grants; location already has `tenant_id`, cross-tenant access is prevented by app middleware |
| `user_operating_entities` | User↔operating entity access grants; operating entity scoped to tenant |

### Reference / Geographic Data

| Table | Reason |
|-------|--------|
| `zip_codes` | US zip/city/state/lat-lng lookup — shared globally, no tenant owner; ~40,000 rows of static data |
| `ifta_tax_rates` | IFTA fuel tax rates by US jurisdiction — seeded reference data, identical for all tenants; updated per IFTA rate changes |
| `dqf_requirements` | DQF requirement key + label + weight definitions — system-wide seed; all tenants share the same requirement set |

### Pre-Tenant / Marketing

| Table | Reason |
|-------|--------|
| `trial_requests` | Marketing lead capture submitted before a tenant is provisioned; tenant_id is N/A by design |

### Child Tables — Inherit Scope from Tenanted Parent

Tenant isolation is enforced at the parent level. All queries join through the parent which filters by `tenant_id`.

#### Driver Module (`drivers.tenant_id` → `vehicles.tenant_id`)

| Table | Parent | Relationship |
|-------|--------|--------------|
| `hos_records` | `drivers` | Many per driver |
| `hos_logs` | `hos_records` | Many per HOS record |
| `drug_alcohol_tests` | `drivers` | Many per driver |
| `maintenance_records` | `vehicles` | Many per vehicle |
| `driver_licenses` | `drivers` | 1:1 |
| `driver_compliance` | `drivers` | 1:1 (medical cert, MVR dates) |
| `driver_license_conflicts` | `drivers` | CDL conflict audit |
| `driver_past_employers` | `drivers` | Employment verification history |
| `dqf_driver_status` | `drivers` | Composite PK (driver_id, requirement_key) |
| `dqf_status_changes` | `drivers` | Audit trail for requirement status changes |
| `driver_esignatures` | `driver_onboarding_packets` | E-sig records per packet |
| `driver_onboarding_sections` | `driver_onboarding_packets` | Section completion state per packet |
| `driver_document_blobs` | *(none)* | Raw binary store only; no business FK; contains no queryable metadata; referenced via `driver_documents.blob_id` |

#### Customer Module (`customers.tenant_id`)

| Table | Parent | Relationship |
|-------|--------|--------------|
| `customer_credit_balance` | `customers` | 1:1 credit ledger |
| `customer_credit_transactions` | `customers` | Credit transaction log |
| `customer_notes` | `customers` | Free-text notes |
| `customer_pricing_rules` | `customers` | 1:1 pricing overrides |

#### Inventory Module (`locations.tenant_id` / `parts.tenant_id`)

| Table | Parent | Relationship |
|-------|--------|--------------|
| `inventory` | `locations` + `parts` | Per-location stock levels (unique on location_id, part_id) |
| `inventory_transactions` | `inventory` | Stock movement ledger |
| `part_barcodes` | `parts` | Multiple barcodes per part |
| `cycle_count_lines` | `cycle_counts` | Line items per count session |
| `inventory_transfer_lines` | `inventory_transfers` | Line items per transfer |
| `receiving_ticket_lines` | `receiving_tickets` | Line items per PO receipt |

#### Load Module (`loads.tenant_id`)

| Table | Parent | Relationship |
|-------|--------|--------------|
| `load_stops` | `loads` | Pickup / delivery stop sequence |
| `load_attachments` | `loads` | BOL, POD, and other load docs |

#### Invoice Module (`invoices.tenant_id`)

| Table | Parent | Relationship |
|-------|--------|--------------|
| `invoice_line_items` | `invoices` | Labor / parts / fee line items |
| `invoice_payments` | `invoices` | Payment records |
| `invoice_documents` | `invoices` | Invoice PDFs and supporting docs |
| `invoice_events` | `invoices` | Status change event log |

#### Work Order Module (`work_orders.tenant_id`)

| Table | Parent | Relationship |
|-------|--------|--------------|
| `work_order_attachments` | `work_orders` | File attachments |
| `work_order_documents` | `work_orders` | Generated documents |
| `work_order_fees` | `work_orders` | Shop supply / misc fees |
| `work_order_labor` | `work_orders` | Labor line groups |
| `work_order_labor_items` | `work_orders` | Individual labor time entries |
| `work_order_notes` | `work_orders` | Technician / advisor notes |
| `work_order_part_items` | `work_orders` | Parts used on the WO |

#### Sales & Payroll Children

| Table | Parent | Relationship |
|-------|--------|--------------|
| `customer_sale_lines` | `customer_sales` | Counter sale line items |
| `settlement_load_items` | `settlements` | Loads included in a settlement |
| `settlement_adjustment_items` | `settlements` | Manual deductions / bonuses |
| `imported_expense_items` | `imported_expense_sources` | Individual expense rows from import |

#### Lease Module Children (`lease_agreements.tenant_id`)

| Table | Parent | Relationship |
|-------|--------|--------------|
| `lease_payment_schedule` | `lease_agreements` | Amortization schedule |
| `lease_payment_transactions` | `lease_agreements` | Actual payment records |
| `lease_risk_snapshots` | `lease_agreements` | Point-in-time risk assessments |

#### Safety Module Children (`safety_incidents.tenant_id`)

| Table | Parent | Relationship |
|-------|--------|--------------|
| `safety_incident_audit_log` | `safety_incidents` | Field-level change history |
| `safety_incident_documents` | `safety_incidents` | Photos, police reports, etc. |
| `safety_incident_notes` | `safety_incidents` | Investigator notes |
| `safety_incident_parties` | `safety_incidents` | Drivers, other parties involved |
| `safety_incident_tasks` | `safety_incidents` | Follow-up action items |
| `safety_incident_witnesses` | `safety_incidents` | Witness statements |

#### Toll & Fuel Module Children

| Table | Parent | Relationship |
|-------|--------|--------------|
| `toll_import_batch_rows` | `toll_import_batches` | Raw CSV row staging area |
| `fuel_import_batch_rows` | `fuel_import_batches` | Raw CSV row staging area |

#### Employment Application Children (`employment_applications.tenant_id`)

| Table | Parent | Relationship |
|-------|--------|--------------|
| `employment_application_accidents` | `employment_applications` | 3-year accident history |
| `employment_application_convictions` | `employment_applications` | Traffic conviction history |
| `employment_application_documents` | `employment_applications` | Uploaded application docs |
| `employment_application_driving_experience` | `employment_applications` | CDL driving experience history |
| `employment_application_education` | `employment_applications` | Education history |
| `employment_application_employers` | `employment_applications` | Past employer 3-year history |
| `employment_application_licenses` | `employment_applications` | License types held |
| `employment_application_residencies` | `employment_applications` | 3-year address history |

#### Roadside Service AI Children (`roadside_calls.tenant_id`)

| Table | Parent | Relationship |
|-------|--------|--------------|
| `roadside_sessions` | `roadside_calls` | AI conversation session |
| `roadside_intakes` | `roadside_calls` | Structured incident intake form |
| `roadside_media` | `roadside_calls` | Photos / voice recordings |
| `roadside_locations` | `roadside_calls` | GPS location snapshots |
| `roadside_ai_assessments` | `roadside_calls` | AI-generated damage / repair assessments |
| `roadside_dispatch_assignments` | `roadside_calls` | Technician / tow dispatch records |
| `roadside_payments` | `roadside_calls` | Roadside service payment records |
| `roadside_event_logs` | `roadside_calls` | Full lifecycle event log |
| `roadside_public_link_tokens` | `roadside_calls` | Shareable status page tokens |
| `roadside_work_order_links` | `roadside_calls` | Bridge to internal work orders |

---

## Tables WITHOUT `tenant_id` — ACTION REQUIRED 🔴

> **Resolution:** All four gaps are addressed by  
> `backend/packages/goodmen-database/migrations/20260316220000_add_tenant_id_to_unscoped_root_tables.js`  
> Run `npx knex migrate:latest` from `backend/packages/goodmen-database`.

| Table | Risk Level | Data Exposure Risk | Recommended Fix |
|-------|-----------|-------------------|-----------------|
| `divisions` | 🔴 High | RBAC org unit with no parent FK — any tenant could read or write divisions belonging to another tenant if not filtered in application code | Add `tenant_id NOT NULL` after backfill; add `WHERE tenant_id = :tenantId` to all queries; enforce FK constraint |
| `dqf_documents` | 🔴 High | Compliance document records contain driver PII (CDL scans, drug test docs, medical certs) — cross-tenant read exposes regulated driver data | Add `tenant_id`; backfill via `drivers.tenant_id`; update all service queries to filter by tenant |
| `driver_documents` | 🔴 High | Same as `dqf_documents` — employment application docs include SSN-adjacent identity documents; independently queried by the document management API without a drivers JOIN | Add `tenant_id`; backfill via `drivers.tenant_id`; audit all direct queries in `drivers-compliance-service` |
| `vehicle_documents` | 🟡 Medium | DOT inspection records, registration certs, insurance docs — cross-tenant read exposes compliance status of another carrier's vehicles | Add `tenant_id`; backfill via `vehicles.tenant_id`; update vehicle document API queries |

### Post-migration steps

After running `20260316220000`:

1. **Verify backfill** — confirm NULL count dropped to expected level:
   ```sql
   SELECT table_name, COUNT(*) AS null_tenant_rows
   FROM (
     SELECT 'dqf_documents'   AS table_name, tenant_id FROM dqf_documents   WHERE tenant_id IS NULL
     UNION ALL
     SELECT 'driver_documents',               tenant_id FROM driver_documents  WHERE tenant_id IS NULL
     UNION ALL
     SELECT 'vehicle_documents',              tenant_id FROM vehicle_documents WHERE tenant_id IS NULL
     UNION ALL
     SELECT 'divisions',                      tenant_id FROM divisions         WHERE tenant_id IS NULL
   ) t
   GROUP BY table_name;
   ```

2. **Add NOT NULL constraint** — once all app writes stamp `tenant_id`, tighten the constraint:
   ```sql
   -- Run per-table after confirming zero NULL rows
   ALTER TABLE dqf_documents    ALTER COLUMN tenant_id SET NOT NULL;
   ALTER TABLE driver_documents ALTER COLUMN tenant_id SET NOT NULL;
   ALTER TABLE vehicle_documents ALTER COLUMN tenant_id SET NOT NULL;
   -- divisions: defer until first write path is confirmed
   ```

3. **Audit service queries** — search for queries against these tables that do not include `WHERE tenant_id = ?`:
   ```bash
   grep -rn "from dqf_documents\|from driver_documents\|from vehicle_documents\|from divisions" \
     backend/microservices/ --include="*.js" -i
   ```

4. **`user_roles` deprecation** — verify whether any middleware still reads `user_roles` as the authoritative role source. If `user_tenant_memberships.role` is the sole source, drop `user_roles` to prevent stale role escalation:
   ```bash
   grep -rn "user_roles" backend/ --include="*.js" | grep -v "migrations"
   ```

---

## Appendix: Migration Timeline

| Migration | Action |
|-----------|--------|
| `20260310100000` | Created `tenants`, `operating_entities`, `user_tenant_memberships` |
| `20260310101000` | Added `tenant_id` to 27 existing business tables |
| `20260310102000` | Backfilled default tenant context for pre-existing rows |
| `20260311010000` | Added `operating_entity_id` to drivers and vehicles |
| `20260311120000` | Added `tenant_id` + `operating_entity_id` to `audit_logs` |
| `20260316220000` | **NEW** — Added `tenant_id` to `divisions`, `dqf_documents`, `driver_documents`, `vehicle_documents` |
