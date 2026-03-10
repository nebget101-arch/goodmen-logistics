# FleetNeuron APIs & Microservices README (for ChatGPT)

## Architecture

FleetNeuron backend is a Node.js microservice system behind an API Gateway.

Entry point:
- [backend/gateway/index.js](../backend/gateway/index.js)

Shared route implementations (used by multiple services):
- [backend/packages/goodmen-shared/routes](../backend/packages/goodmen-shared/routes)

Each microservice mounts selected shared route modules.

---

## Gateway routing map

Gateway listens on `PORT` (default `4000`) and proxies by path prefix.

Key prefixes from [backend/gateway/index.js](../backend/gateway/index.js):

- Reporting service:
  - `/api/dashboard`
  - `/api/reports`
  - `/api/audit`

- Integrations service:
  - `/api/scan-bridge`

- Auth/users service:
  - `/api/auth`
  - `/api/users`
  - `/api/roles`
  - `/api/permissions`
  - `/api/communication-preferences`

- Drivers compliance service:
  - `/api/drivers`
  - `/api/dqf`
  - `/api/dqf-documents`
  - `/api/hos`
  - `/api/drug-alcohol`
  - `/api/onboarding`
  - `/public/onboarding`

- Vehicles/maintenance service:
  - `/api/vehicles`
  - `/api/maintenance`
  - `/api/equipment`
  - `/api/work-orders`
  - `/api/parts`

- Logistics service:
  - `/api/health` (rewritten to service `/health` family)
  - `/api/loads`
  - `/api/brokers`
  - `/api/locations`
  - `/api/geo`
  - `/api/invoices`
  - `/api/credit`
  - `/api/db-example`
  - `/api/settlements`
  - `/api/expense-payment-categories`

- Inventory service:
  - `/api/inventory`
  - `/api/adjustments`
  - `/api/cycle-counts`
  - `/api/receiving`
  - `/api/barcodes`
  - `/api/customers`

- AI service:
  - `/api/ai`

---

## Microservices and mounted routers

### 1) Auth/Users Service

- Server: [backend/microservices/auth-users-service/server.js](../backend/microservices/auth-users-service/server.js)
- Health: `GET /health`
- Swagger: `/api-docs`
- Routers:
  - `/api/auth`
  - `/api/users`
  - `/api/roles`
  - `/api/permissions`
  - `/api/communication-preferences`

### 2) Drivers Compliance Service

- Server: [backend/microservices/drivers-compliance-service/server.js](../backend/microservices/drivers-compliance-service/server.js)
- Health: `GET /health`
- Swagger: `/api-docs`
- Routers:
  - `/api/drivers`
  - `/api/dqf`
  - `/api/dqf-documents`
  - `/api/hos`
  - `/api/drug-alcohol`
  - `/api/onboarding`
  - `/public/onboarding`

### 3) Vehicles Maintenance Service

- Server: [backend/microservices/vehicles-maintenance-service/server.js](../backend/microservices/vehicles-maintenance-service/server.js)
- Health: `GET /health`
- Swagger: `/api-docs`
- Routers:
  - `/api/vehicles`
  - `/api/maintenance`
  - `/api/equipment`
  - `/api/work-orders`
  - `/api/parts`

### 4) Inventory Service

- Server: [backend/microservices/inventory-service/server.js](../backend/microservices/inventory-service/server.js)
- Health: `GET /health`
- Swagger: `/api-docs`
- Routers:
  - `/api/inventory`
  - `/api/adjustments`
  - `/api/cycle-counts`
  - `/api/receiving`
  - `/api/barcodes`
  - `/api/customers` (bulk upload + customer endpoints)

### 5) Logistics Service

- Server: [backend/microservices/logistics-service/server.js](../backend/microservices/logistics-service/server.js)
- Health:
  - `GET /health`
  - `GET /health/db`
  - `GET /health/db/diagnostic`
- Swagger: `/api-docs`
- Routers:
  - `/api/loads`
  - `/api/brokers`
  - `/api/locations`
  - `/api/geo`
  - `/api/invoices`
  - `/api/credit`
  - `/api/db-example`
  - `/api/settlements`
  - `/api/expense-payment-categories`

### 6) Reporting Service

- Server: [backend/microservices/reporting-service/server.js](../backend/microservices/reporting-service/server.js)
- Health: `GET /health`
- Swagger: `/api-docs`
- Routers:
  - `/api/dashboard`
  - `/api/reports`
  - `/api/audit`

### 7) Integrations Service

- Server: [backend/microservices/integrations-service/server.js](../backend/microservices/integrations-service/server.js)
- Health: `GET /health`
- Swagger: `/api-docs`
- Routers:
  - `/api/scan-bridge`

### 8) AI Service

- Server: [backend/microservices/ai-service/server.js](../backend/microservices/ai-service/server.js)
- Health: `GET /health`
- Router:
  - `/api/ai`

---

## Domain endpoint inventory (major groups)

Source route files:
- [backend/packages/goodmen-shared/routes](../backend/packages/goodmen-shared/routes)

Major groups (not exhaustive parameter details):

1. **Auth & access control**
   - `POST /auth/login`
   - `GET /users/me`, user CRUD/admin actions
   - roles + permissions management endpoints

2. **Drivers & compliance**
   - Driver CRUD (`/drivers`)
   - DQF docs upload/list/download (`/dqf`, `/dqf-documents`)
   - HOS records (`/hos`)
   - Drug/alcohol (`/drug-alcohol`)
   - Onboarding packets and public submissions (`/onboarding`, `/public/onboarding`)

3. **Loads & dispatch**
   - Load CRUD (`/loads`)
   - bulk rate confirmation upload
   - attachments upload/update/delete
   - AI extract for load docs
   - broker + geo route support

4. **Settlements/payroll**
   - Payees, compensation profiles, payee assignments
   - recurring deductions
   - payroll periods
   - settlement draft/detail/recalc/approve/void
   - load items + adjustment items
   - PDF payload/generate/download + send-email
   - imported expense matching/apply flow

5. **Vehicles/maintenance/work orders**
   - Vehicle CRUD + docs
   - maintenance records
   - work order lifecycle (labor, parts, charges, docs, invoice generation)

6. **Inventory/parts/receiving**
   - parts catalog + categories/manufacturers + barcodes + bulk upload
   - inventory stock, transfers, receiving, adjustments, transactions
   - cycle counts and approvals
   - direct sales-related inventory endpoints

7. **Customer/invoice/credit**
   - customer CRUD + notes/pricing/history
   - customer bulk upload
   - invoice CRUD + line items + payments + docs + pdf
   - customer credit balance and transaction operations

8. **Reporting/audit/dashboard**
   - dashboard stats/alerts
   - inventory reports
   - customer/vehicle/work-order/financial report families
   - audit trail/export/compliance summary

---

## Security and authorization model

- JWT bearer auth used broadly (service Swagger docs include bearer scheme).
- Route middleware patterns:
  - `authMiddleware`
  - role guards like `requireRole([...])`
  - RBAC permission guards (`rbac`, `requirePermission`, `requireAnyPermission`)

When designing new features, include:
- required role(s)
- required permission code(s)
- gateway route mapping
- service ownership

---

## API design conventions to preserve

1. Keep endpoint families domain-based (`/loads`, `/settlements`, `/inventory`, etc.).
2. Prefer additive API changes where possible (backward compatibility).
3. Preserve auth + role checks on all non-public endpoints.
4. Keep Swagger docs updated in route files where annotations exist.
5. Add health impact checks when new external dependencies are introduced.

---

## What ChatGPT should output for new API features

Request ChatGPT to return:

- Service ownership (which microservice)
- Gateway route updates if needed
- Endpoint list (method + path + auth + role/permission)
- Request/response contracts
- Error model and status codes
- Migration implications (tables/indexes)
- Observability additions (logs, health checks)
