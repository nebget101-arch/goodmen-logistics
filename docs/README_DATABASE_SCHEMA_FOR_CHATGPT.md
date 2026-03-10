# FleetNeuron Database Schema README (for ChatGPT)

## Source of truth

Database structure evolves through Knex migrations.

Primary location:
- [backend/packages/goodmen-database/migrations](../backend/packages/goodmen-database/migrations)

Supporting files:
- [backend/packages/goodmen-database/knexfile.js](../backend/packages/goodmen-database/knexfile.js)
- [backend/packages/goodmen-database/schema.sql](../backend/packages/goodmen-database/schema.sql) (baseline snapshot; may lag behind newer migrations)

---

## Core database domains

## 1) Identity, RBAC, and user scoping

Key tables:
- `users`
- `roles`
- `permissions`
- `role_permissions`
- `user_roles`
- `user_locations`

Purpose:
- Authentication identity and role/permission assignment
- Optional location-based access constraints

---

## 2) Drivers and compliance

Key tables:
- `drivers`
- `driver_compliance`
- `driver_licenses`
- `driver_license_conflicts`
- `driver_onboarding_packets`
- `driver_onboarding_sections`
- `driver_esignatures`
- `driver_document_blobs`
- `driver_documents`
- `dqf_requirements`
- `dqf_driver_status`

Purpose:
- Driver profile + compliance status
- DQF and onboarding packet/public form workflows
- Document metadata and signature evidence

---

## 3) Fleet, maintenance, and service operations

Key tables:
- `vehicles`
- `maintenance_records`
- `work_orders`
- `work_order_labor`
- `work_order_labor_items`
- `work_order_part_items`
- `work_order_fees`
- `work_order_notes`
- `work_order_documents`
- `work_order_attachments`
- `locations`
- `customer_vehicles`

Purpose:
- Vehicle master data and maintenance lifecycle
- Service work order composition and costing
- Location and customer vehicle linkage

---

## 4) Loads, dispatch, and broker operations

Key tables:
- `loads`
- `load_stops`
- `load_attachments`
- `brokers`
- `zip_codes`

Purpose:
- Dispatch load lifecycle and stop sequencing
- Document attachments for rate confirmations/POD
- Broker and geospatial support

---

## 5) Customer, invoice, and credit accounting

Key tables:
- `customers`
- `customer_notes`
- `customer_pricing_rules`
- `invoices`
- `invoice_line_items`
- `invoice_payments`
- `invoice_documents`
- `invoice_events`
- `customer_credit_balance`
- `customer_credit_transactions`

Purpose:
- Customer CRM and billing profile
- Full invoice lifecycle (line items, payments, docs, events)
- Credit limits and credit-transaction ledger

---

## 6) Inventory and parts operations

Key tables:
- `parts`
- `part_barcodes`
- `inventory`
- `inventory_transactions`
- `inventory_adjustments`
- `inventory_transfers`
- `inventory_transfer_lines`
- `receiving_tickets`
- `receiving_ticket_lines`
- `cycle_counts`
- `cycle_count_lines`
- `customer_sales`
- `customer_sale_lines`

Purpose:
- Parts catalog and barcode integration
- Multi-location stock tracking and movement history
- Receiving + transfer + adjustment + cycle count workflows
- Direct sales from inventory

---

## 7) Settlements/payroll domain

Key tables:
- `payees`
- `driver_compensation_profiles`
- `driver_payee_assignments`
- `expense_responsibility_profiles`
- `recurring_deduction_rules`
- `payroll_periods`
- `settlements`
- `settlement_load_items`
- `settlement_adjustment_items`
- `imported_expense_sources`
- `imported_expense_items`
- `expense_payment_categories`

Purpose:
- Payroll settlement workflow for drivers and additional payees
- Compensation profile + payee resolution
- Recurring/manual/variable deductions
- Settlement generation, recalculation, approval/void, and payout docs
- Imported expense reconciliation + category mapping

Relevant migration entry points:
- Payroll settlement tables: [backend/packages/goodmen-database/migrations/20260309100000_add_payroll_settlement_tables.js](../backend/packages/goodmen-database/migrations/20260309100000_add_payroll_settlement_tables.js)
- Expense categories: [backend/packages/goodmen-database/migrations/20260309130000_create_expense_payment_categories.js](../backend/packages/goodmen-database/migrations/20260309130000_create_expense_payment_categories.js)

---

## 8) Reporting, audit, and misc

Key tables:
- `audit_logs`
- `communication_consents`
- `divisions`

Purpose:
- Auditable event history and policy tracking
- Communication preferences/consent capture

---

## Views

Known views defined/updated in migrations:
- `all_vehicles`
- `inventory_by_location`

Examples:
- [backend/packages/goodmen-database/migrations/20260219_create_all_vehicles_view.js](../backend/packages/goodmen-database/migrations/20260219_create_all_vehicles_view.js)
- [backend/packages/goodmen-database/migrations/20260227183000_add_barcodes_transfers_and_sales.js](../backend/packages/goodmen-database/migrations/20260227183000_add_barcodes_transfers_and_sales.js)

---

## Relationship patterns (high level)

1. **Load graph**
   - `loads` 1→N `load_stops`
   - `loads` 1→N `load_attachments`
   - `loads` links to `drivers`, `vehicles` (truck/trailer), `brokers`

2. **Invoice graph**
   - `invoices` 1→N `invoice_line_items`
   - `invoices` 1→N `invoice_payments`
   - `invoices` 1→N `invoice_documents`
   - `invoices` 1→N `invoice_events`

3. **Work order graph**
   - `work_orders` with labor/parts/fees/notes/documents child tables
   - can generate and link to invoices via API workflows

4. **Inventory graph**
   - `parts` and `locations` drive `inventory`
   - stock events tracked in `inventory_transactions`
   - movement docs via transfers/receiving/adjustments/cycle counts

5. **Settlement graph**
   - `settlements` 1→N `settlement_load_items`
   - `settlements` 1→N `settlement_adjustment_items`
   - settlement ties to `drivers`, `payees`, and `payroll_periods`

---

## Data and migration operations

Common scripts live under:
- [backend/packages/goodmen-database/package.json](../backend/packages/goodmen-database/package.json)
- [backend/packages/goodmen-database/scripts](../backend/packages/goodmen-database/scripts)

Repo also includes operational scripts for payroll/settlement data fixes:
- [backend/scripts](../backend/scripts)

---

## DB guidance for new feature requirements

When asking ChatGPT for a DB plan, require:

1. New/changed tables and columns
2. Foreign keys + delete/update behavior
3. Index strategy (including unique constraints)
4. Data backfill/migration safety (idempotent migration design)
5. Rollback strategy (`down` migration behavior)
6. Impact map to APIs and frontend pages
7. Reporting impact (new metrics/views if needed)

---

## Important caution

Because there are many migrations, do not rely on a single static ERD or old `schema.sql` snapshot alone. Always validate against the full migration history in [backend/packages/goodmen-database/migrations](../backend/packages/goodmen-database/migrations).
