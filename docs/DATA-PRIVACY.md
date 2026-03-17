# DATA-PRIVACY.md — FleetNeuron Data Privacy Guide

_Last updated: 2026-03-16_

This guide documents how FleetNeuron handles sensitive driver and company data for compliance review.

## Scope

Primary source reviewed:
- `backend/packages/goodmen-database/schema.sql`

Supporting context reviewed:
- `docs/RBAC_SETUP.md` (role model)
- `backend/packages/goodmen-shared/routes/audit.js` (retention notes used by exports)
- Twilio/SendGrid/OpenAI/R2 integration code under `backend/packages/goodmen-shared/services/*`

---

## 1) Data Inventory (PII and Sensitive Fields)

> Notes:
> - Access is controlled by authenticated API + tenant/entity scoping + RBAC permissions.
> - “Who can access” below is the intended RBAC role family based on current role model and module ownership.
> - Final effective access is route-permission dependent.

| Table | Field(s) | Data Type | Sensitivity | Typical Access Roles (RBAC) |
|---|---|---|---|---|
| `drivers` | `first_name`, `last_name` | Personal identity | PII | `super_admin`, `admin`, `safety_manager`, `dispatch_manager`, `dispatcher` |
| `drivers` | `email`, `phone`, `address` | Contact | PII | `super_admin`, `admin`, `safety_manager`, `dispatch_manager`, `dispatcher` |
| `drivers` | `date_of_birth` | Government identity support | High PII | `super_admin`, `admin`, `safety_manager` |
| `drivers` | `cdl_number`, `cdl_state`, `cdl_class`, `cdl_expiry` | License/compliance | Sensitive PII | `super_admin`, `admin`, `safety_manager`, `dispatch_manager`, `dispatcher` |
| `drivers` | `medical_cert_expiry`, `clearinghouse_status`, `last_mvr_check` | Safety/compliance status | Sensitive compliance data | `super_admin`, `admin`, `safety_manager` |
| `hos_records` | `driver_id`, `record_date`, duty-hour fields, `violations`, `status` | Driver activity/compliance | Sensitive operational + compliance | `super_admin`, `admin`, `safety_manager`, `dispatch_manager`, `dispatcher` (view) |
| `hos_logs` | `hos_record_id`, `log_time`, `status`, `location` | Detailed movement/activity logs | Sensitive operational data | `super_admin`, `admin`, `safety_manager`, `dispatch_manager` |
| `drug_alcohol_tests` | `driver_id`, `test_type`, `test_date`, `result`, `testing_facility`, `collector_name`, `specimen`, `substances_tested`, `certified_by` | Medical/testing compliance | Highly sensitive compliance data | `super_admin`, `admin`, `safety_manager` |
| `dqf_documents` | `driver_id`, `document_type`, `file_name`, `file_path`, `uploaded_by` | Driver qualification file metadata | Sensitive (documents may contain PII) | `super_admin`, `admin`, `safety_manager` |
| `loads` | `pickup_location`, `delivery_location`, `shipper`, `consignee`, `driver_id` | Company + assignment info | Sensitive business/operational | `super_admin`, `admin`, `dispatch_manager`, `dispatcher`, `carrier_accountant` (limited) |
| `customers` | `company_name`, `dot_number`, `address`, `city`, `state`, `zip`, `phone`, `email` | Business + contact data | Sensitive business contact data | `super_admin`, `admin`, dispatch/shop/accounting role families |
| `users` | `first_name`, `last_name`, `email`, `username` | Workforce identity | PII | `super_admin`, `admin` |
| `users` | `password_hash` | Authentication secret (hashed) | Credential secret (not plain text) | `super_admin`, `admin`, auth subsystem only |
| `audit_logs` | `performed_by`, `ip_address`, `changes` | Traceability metadata | Security-sensitive log data | `super_admin`, `admin`, audit/compliance viewers |
| `locations` | `address` | Business location | Sensitive business data | `super_admin`, `admin`, dispatch/shop role families |
| `vehicles` / `customer_vehicles` | `vin`, `license_plate`, `unit_number` | Asset identifiers | Sensitive operational data | `super_admin`, `admin`, dispatch/shop/fleet role families |
| `work_orders` | `assigned_to`, `notes`, `description` | Service + assignment data | Sensitive operational (may include incidental PII) | `super_admin`, `admin`, shop role families |

### Explicit check results requested

- **SSN fields:** Not present in `schema.sql`.
- **Bank account/routing fields:** Not present in `schema.sql`.
- **DOB fields:** Present (`drivers.date_of_birth`).
- **License fields:** Present (`drivers.cdl_*`, vehicle license plates).
- **Drug test results:** Present (`drug_alcohol_tests.result` and related columns).
- **Address fields:** Present in multiple tables (`drivers`, `customers`, `locations`).

---

## 2) Data Retention Policy

### Current state in codebase

FleetNeuron currently stores records until deleted/archived by business process; no global automated purge policy is defined in `schema.sql`.

### Compliance baseline (documented in app export notes)

From audit export route notes:
- **HOS records**: retain at least **6 months** (`49 CFR 395.8`).
- **Maintenance records**: retain at least **1 year** (export note references `49 CFR 396.3`).
- **Drug & alcohol records**: retain according to `49 CFR 382.401` schedules.

### Policy to enforce (recommended operational standard)

| Data Class | Minimum Retention | Source/Reason |
|---|---|---|
| HOS records/logs | 6 months minimum | FMCSA `49 CFR 395.8` |
| Driver/vehicle maintenance evidence | 1 year minimum (or stricter policy adopted by compliance) | Current export policy + FMCSA reference |
| Drug/alcohol testing records | Per `49 CFR 382.401` schedule (varies by test/outcome) | FMCSA-controlled retention windows |
| Audit logs | Minimum 1 year recommended, longer for investigations | Security/compliance traceability |
| Driver core profile (PII) | Employment + legal retention window | Operational + legal defense needs |

> Action item: implement codified retention jobs (archive/purge) and a policy matrix approved by legal/compliance.

---

## 3) Data Access Logging (`audit_logs`)

From `schema.sql`, `audit_logs` captures:
- `entity_type`
- `entity_id`
- `action`
- `changes` (`JSONB` payload)
- `performed_by`
- `ip_address`
- `created_at`

From migration `20260311120000_add_audit_log_scope_columns.js`, environments may also include:
- `tenant_id`
- `operating_entity_id`

### Logging quality guidance

- Keep `changes` payload free of secrets and raw high-risk PII where possible.
- Retain sufficient detail for forensic traceability (who/what/when/from where).
- Restrict audit log query access to admin/compliance roles.

---

## 4) FMCSA Compliance Notes

The platform stores data classes commonly required for DOT/FMCSA compliance workflows:

- **HOS compliance** (`hos_records`, `hos_logs`) — retain per `49 CFR 395.8` (6-month minimum in current notes).
- **Drug/alcohol testing** (`drug_alcohol_tests`) — retain per `49 CFR 382.401` schedule.
- **Driver qualification/supporting docs** (`drivers`, `dqf_documents`) — DQF artifacts support qualification/compliance inspections.
- **Maintenance records** (`maintenance_records`) — export notes currently state 1-year retention baseline.

> Compliance owner should maintain a regulation-to-table control matrix and verify retention periods against current legal counsel guidance.

---

## 5) Data Deletion Procedure (Right to Erasure)

Because FleetNeuron stores regulated transportation records, deletion requests must follow a legal-hold decision process.

### Standard process

1. **Intake and identity verification**
   - Verify requester identity and authority.
2. **Legal/compliance hold check**
   - Determine whether FMCSA or contractual retention obligations prevent deletion.
3. **Scope discovery**
   - Identify all records tied to driver ID across profile, HOS, drug/alcohol, DQF, loads, work orders, audit references.
4. **Decision path**
   - **If legally required to retain:** deny full erasure; restrict processing/access and document legal basis.
   - **If deletion allowed:** perform deletion/anonymization in controlled transaction(s).
5. **Execution controls**
   - Remove/erase storage objects (R2) tied to document metadata.
   - Ensure referential integrity (some relationships are `ON DELETE CASCADE`, some are `SET NULL`, some may require reassignment/update first).
6. **Post-action evidence**
   - Write an auditable deletion event with actor, scope, legal basis, and completion timestamp.

### Practical schema behavior highlights

- Deleting a `drivers` row cascades to `hos_records`, `hos_logs`, `drug_alcohol_tests`, `dqf_documents`.
- `loads.driver_id` is `ON DELETE SET NULL`.
- Some references (for example work assignment links) may require pre-cleanup/reassignment before delete.

---

## 6) Third-Party Data Sharing

| Third Party | Typical Data Sent | Purpose | Data Risk Notes |
|---|---|---|---|
| Twilio | Phone numbers, call metadata, call recordings/webhook payload fields | Voice/SMS notifications and roadside call flows | Treat call recordings/transcripts as sensitive; apply minimum-necessary sharing |
| SendGrid | Recipient email addresses, message subjects/bodies, notification metadata | Transactional email (onboarding, roadside, alerts) | Avoid embedding sensitive PII in message content unless required |
| OpenAI | Extracted load/rate-confirmation text payloads (from AI extractor flows) | AI-assisted document extraction | Redact/minimize personal data before transmission when possible |
| Cloudflare R2 (S3-compatible object storage) | DQF docs, PDFs, document files and metadata keys | Document/file storage with signed URL access | Enforce signed URL TTL, strict object key hygiene, and bucket access policy |

---

## 7) Encryption at Rest (Render/Postgres and Storage)

### Database

- `schema.sql` does not define column-level encryption for PII fields.
- At-rest encryption for managed Postgres is expected to be platform-managed by hosting provider (Render) rather than configured in SQL.
- Compliance review should verify Render environment settings and attestations for encryption at rest.

### Object storage

- R2 storage is used for documents; encryption-at-rest is provider-managed.
- Application should enforce signed URL access and least-privilege credentials.

---

## 8) Plain-Text Sensitive Fields to Flag for Future Encryption/Tokenization

The following fields are currently stored as plain values in relational columns and should be prioritized for encryption/tokenization or stricter masking:

1. `drivers.date_of_birth`
2. `drivers.cdl_number`
3. `drivers.address`
4. `drivers.phone`, `drivers.email`
5. `drug_alcohol_tests.result` and related testing details
6. `hos_logs.location` (can be sensitive location history)
7. `customers.address`, `customers.phone`, `customers.email`

### Additional high-priority control gaps

- No SSN/bank columns in base schema today, but if introduced, they must be encrypted/tokenized at ingestion.
- Add field-level masking in admin/reporting UIs for high-risk identifiers.
- Add formal DLP/redaction rules for logs and exports.

---

## 9) Compliance Readiness Checklist

- [ ] Approved data classification standard (PII/sensitive/regulatory).
- [ ] Final legal retention schedule mapped to each table/field.
- [ ] Automated archive/purge jobs with legal-hold exceptions.
- [ ] Field-level encryption/tokenization roadmap completed.
- [ ] Vendor data-processing agreements validated (Twilio/SendGrid/OpenAI/Cloudflare).
- [ ] Data subject request workflow documented and tested.
- [ ] Annual privacy and access-control review completed.
