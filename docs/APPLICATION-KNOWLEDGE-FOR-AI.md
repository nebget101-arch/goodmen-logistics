# FleetNeuron Application Knowledge (for AI)

This document describes the FleetNeuron application so an AI assistant or developer can answer questions about structure, features, APIs, and workflows. Use it for in-app help, onboarding, and troubleshooting.

---

## 1. What FleetNeuron Is

FleetNeuron (also referred to as Goodmen Logistics in backend package names) is an **AI-powered fleet management platform**. It covers:

- **Fleet & equipment**: Trucks, trailers, vehicles, maintenance, work orders
- **Safety & compliance**: Drivers, HOS, DQF, drug & alcohol, audit
- **Inventory**: Parts catalog, barcodes, receiving, transfers, direct sales, cycle counts, adjustments
- **Logistics**: Loads, brokers, locations, geo
- **Accounting**: Invoices, credit, customers
- **Integrations**: Scan bridge (phone/tablet barcode scanning), external systems
- **In-app AI assistant**: Chat for how-to help, work order drafts, navigation, and failure diagnosis

Users log in with JWT; roles (e.g. admin, safety, fleet, dispatch, technician, parts_manager, shop_manager, accounting, service_advisor) control which sidebar sections and features they see.

---

## 2. High-Level Architecture

- **Frontend**: Angular SPA (`frontend/`), project name `goodmen-logistics`. Single origin; all API calls go to the same backend base URL (gateway).
- **API Gateway**: Node/Express (`backend/gateway/`). Proxies `/api/*` and `/public/*` to microservices. No business logic; only routing and CORS.
- **Microservices**: Node/Express services under `backend/microservices/`. Each owns a slice of the domain. They use shared code from `backend/packages/goodmen-shared` and optionally `backend/packages/goodmen-database` for schema/migrations.
- **Database**: PostgreSQL. Connection via `DATABASE_URL` or `PG_*` env vars. Shared across services that need it.
- **AI service**: Dedicated microservice for the in-app AI chat; uses OpenAI and a small RAG over `docs/` markdown files.

---

## 3. Frontend (Angular)

- **Entry**: `frontend/src/main.ts` → `AppModule` → `AppComponent`.
- **Shell**: `frontend/src/app/app.component.ts` and `.html`. Contains:
  - Sidebar (role-based nav), main content area with `<router-outlet>`, footer
  - Global “Ask AI” floating button and AI chat panel (when logged in)
  - Onboarding “Send Packet” modal
- **Routing**: `frontend/src/app/app-routing.module.ts`. Key routes:
  - `/dashboard` – Dashboard
  - `/drivers`, `/drivers/dqf` – Drivers (dispatch vs DQF)
  - `/vehicles`, `/trailers` – Vehicles (trucks vs trailers)
  - `/hos` – HOS
  - `/maintenance` – Maintenance list
  - `/work-order`, `/work-order/:id` – Create or edit work order
  - `/loads` – Loads dashboard
  - `/audit` – Audit
  - `/parts` – Parts catalog
  - `/barcodes` – Barcode management
  - `/receiving` – Warehouse receiving
  - `/inventory-transfers` – Transfers
  - `/direct-sales` – Direct sales
  - `/inventory-reports` – Reports
  - `/customers`, `/invoices` – Lazy-loaded feature modules
  - `/users/create` – Add user (admin)
  - `/login`, `/privacy`, `/terms`, `/communication-preferences`
  - `/onboard/:packetId` – Public driver onboarding packet (no auth)
- **Auth**: JWT in localStorage (`token`, `role`). `AuthGuard` protects routes. `ApiService` and HTTP interceptors attach the token to API requests.
- **AI chat**: `AiChatService` (`frontend/src/app/services/ai-chat.service.ts`) calls `POST /api/ai/chat`. App component handles suggestion clicks (navigation, work order draft) and passes AI draft state to the work-order route when applicable.

---

## 4. API Gateway

- **File**: `backend/gateway/index.js`
- **Env**: Each microservice base URL is required: `REPORTING_SERVICE_URL`, `INTEGRATIONS_SERVICE_URL`, `AUTH_USERS_SERVICE_URL`, `DRIVERS_COMPLIANCE_SERVICE_URL`, `VEHICLES_MAINTENANCE_SERVICE_URL`, `LOGISTICS_SERVICE_URL`, `INVENTORY_SERVICE_URL`, `AI_SERVICE_URL`. Also `PORT`, `CORS_ORIGIN`, `NODE_ENV`.
- **Endpoints**:
  - `GET /health` – Gateway health check
  - All other `/api/*` and `/public/*` – proxied to the corresponding microservice (see next section).

---

## 5. API Route → Microservice Mapping

| Path prefix | Microservice | Domain |
|-------------|--------------|--------|
| `/api/dashboard`, `/api/reports`, `/api/audit` | reporting-service | Dashboards, reports, audit |
| `/api/scan-bridge` | integrations-service | Phone/tablet scan bridge |
| `/api/auth`, `/api/users`, `/api/communication-preferences` | auth-users-service | Auth, users, comms |
| `/api/drivers`, `/api/dqf`, `/api/dqf-documents`, `/api/hos`, `/api/drug-alcohol`, `/api/onboarding`, `/public/onboarding` | drivers-compliance-service | Drivers, DQF, HOS, onboarding |
| `/api/vehicles`, `/api/maintenance`, `/api/equipment`, `/api/work-orders`, `/api/parts` | vehicles-maintenance-service | Vehicles, maintenance, work orders, parts |
| `/api/loads`, `/api/brokers`, `/api/locations`, `/api/geo`, `/api/invoices`, `/api/credit`, `/api/db-example` | logistics-service | Loads, invoices, locations |
| `/api/inventory`, `/api/adjustments`, `/api/cycle-counts`, `/api/receiving`, `/api/barcodes`, `/api/customers` | inventory-service | Inventory, barcodes, customers |
| `/api/ai` | ai-service | In-app AI chat |

The frontend always calls the gateway (e.g. `https://your-gateway.onrender.com` or relative `/api`); it never calls microservices directly.

---

## 6. Backend Shared Package (@goodmen/shared)

- **Path**: `backend/packages/goodmen-shared/`
- **Purpose**: Shared routes (Express routers), services (business logic), utils, middleware (e.g. auth), storage (R2, local). Used by all microservices that serve those domains.
- **Setup**: Before using any shared route, the app must call `require('@goodmen/shared').setDatabase({ pool, query, getClient, knex })` with the DB from `@goodmen/shared/config/database` or equivalent.
- **Layout**: `routes/`, `services/`, `utils/`, `middleware/`, `storage/`, `config/`, `internal/` (do not require from apps).

---

## 7. Work Orders

- **API**: Work orders are under vehicles-maintenance-service: `POST/GET/PUT /api/work-orders`, plus labor, parts, status, invoicing endpoints. See shared `work-orders.service.js` and `work-orders.js` routes.
- **UI**: `WorkOrderComponent` at `/work-order` and `/work-order/:id`. Creates/edits work orders with vehicle, customer, location, type, priority, status, description, labor lines, parts (reserve/issue/return), documents, and invoice generation.
- **Status flow**: DRAFT/OPEN → IN_PROGRESS → WAITING_PARTS → COMPLETED → CLOSED; CANCELED is possible. Only completed work orders can be invoiced.
- **AI**: The AI can suggest a “work order draft” (title, description, priority, assetId, etc.). The user clicks the suggestion and is taken to `/work-order` with the form prefilled via navigation state; the user must still choose vehicle/customer/location and save.

---

## 8. Parts & Inventory

- **Parts catalog**: `/api/parts` (vehicles-maintenance-service), UI at `/parts`.
- **Inventory**: `/api/inventory`, `/api/adjustments`, `/api/cycle-counts`, `/api/receiving` (inventory-service). Barcodes: `/api/barcodes` (inventory-service). Customers: `/api/customers` (inventory-service).
- **Barcode flows**: See `docs/API-BARCODE-SCAN-PHONE-BRIDGE.md`. Key endpoints: `POST /api/scan-bridge/session`, `GET /api/scan-bridge/session/:sessionId/events` (SSE), `POST /api/barcodes/decode-image`, `GET /api/barcodes/:code` for lookup. Work order part reservation uses barcode lookup and reserve APIs.

---

## 9. Drivers & Onboarding

- **Drivers**: `/api/drivers`, `/api/dqf`, `/api/dqf-documents`, `/api/hos`, `/api/drug-alcohol` (drivers-compliance-service).
- **Onboarding**: `/api/onboarding` (create/send packet), `/public/onboarding` (public packet link). UI: onboarding modal in app (send packet), and public page at `/onboard/:packetId` for drivers to complete the packet.

---

## 10. In-App AI Assistant

- **Purpose**: Answer how-to questions, suggest work order drafts, suggest navigation, and help with failure diagnosis. All actions are guided (user confirms); the AI does not perform writes on its own.
- **Backend**: ai-service (`backend/microservices/ai-service/`). Single endpoint: `POST /api/ai/chat` (proxied via gateway as `/api/ai/chat`). Uses OpenAI and a simple RAG over markdown files in `docs/`.
- **Knowledge base**: The AI reads from `docs/`: `ai-assistant-requirements.md`, `ai-chat-api-contract.md`, `API-BARCODE-SCAN-PHONE-BRIDGE.md`, `ai-failure-diagnosis-playbooks.md`, and this file (`APPLICATION-KNOWLEDGE-FOR-AI.md`). Add or update these files to improve answers.
- **Request**: `{ message, conversationId?, context: { route, selectedEntityIds?, user? }, clientMeta? }`. Response: `{ conversationId, messages, suggestions, meta? }`. Suggestions can be `workOrderDraft`, `navigation`, or `explanation`; the frontend turns them into navigation or prefilled forms.
- **Suggestion handling**: In the app, clicking a navigation suggestion routes to the right screen (e.g. `/work-order`, `/parts`). Clicking a work order draft suggestion navigates to `/work-order` with `aiWorkOrderDraft` in state; `WorkOrderComponent` prefills title, priority, and vehicle when present.

---

## 11. Authentication & Authorization

- **Login**: `POST /api/auth` (auth-users-service). Returns JWT. Frontend stores `token` and `role` in localStorage.
- **Protected routes**: Frontend uses `AuthGuard`; backend routes use shared auth middleware that validate the JWT and optionally attach user/role.
- **Roles**: admin, safety, fleet, dispatch, service_advisor, accounting, technician, parts_manager, shop_manager. Sidebar visibility is determined in `AppComponent.canSee(tab)` by role.

---

## 12. Deployment (Render)

- **Blueprint**: `render.yaml` defines the UI (static), gateway, and all microservices (Node), plus a PostgreSQL database.
- **Services**: Each microservice has its own service name (e.g. `fleetneuron-ai-service`, `fleetneuron-logistics-gateway`). Gateway env vars point to each service URL (e.g. `AI_SERVICE_URL`, `INVENTORY_SERVICE_URL`).
- **Secrets**: Sensitive keys (e.g. `OPENAI_API_KEY` for the AI service, DB credentials, R2 keys) are set in Render’s environment with `sync: false` where appropriate.
- **CORS**: Gateway’s `CORS_ORIGIN` is set to the frontend URL (e.g. `https://fleetneuron-logistics-ui.onrender.com`).

---

## 13. Key File Reference

| Purpose | Path |
|--------|-----|
| Frontend app shell | `frontend/src/app/app.component.ts`, `.html` |
| Frontend routes | `frontend/src/app/app-routing.module.ts` |
| API service (HTTP) | `frontend/src/app/services/api.service.ts` |
| AI chat service | `frontend/src/app/services/ai-chat.service.ts` |
| Work order UI | `frontend/src/app/components/work-order/` |
| Gateway | `backend/gateway/index.js` |
| Shared routes/services | `backend/packages/goodmen-shared/routes/`, `services/` |
| Work order backend logic | `backend/packages/goodmen-shared/services/work-orders.service.js` |
| AI service | `backend/microservices/ai-service/server.js`, `src/` |
| AI chat handler | `backend/microservices/ai-service/src/handlers/chat-handler.js` |
| AI knowledge retriever | `backend/microservices/ai-service/src/knowledge/retriever.js` |
| AI suggestions | `backend/microservices/ai-service/src/suggestions.js` |
| Barcode/scan bridge API | `docs/API-BARCODE-SCAN-PHONE-BRIDGE.md` |
| AI API contract | `docs/ai-chat-api-contract.md` |
| AI requirements & metrics | `docs/ai-assistant-requirements.md` |
| Failure diagnosis playbooks | `docs/ai-failure-diagnosis-playbooks.md` |
| Render config | `render.yaml` |

---

## 14. Common User Questions the AI Should Handle

- **How do I create a work order?** Explain: go to Maintenance or use the AI suggestion to open the work order form; select vehicle, customer, location; fill description, priority, labor/parts; save. Optionally suggest “Create work order draft” or “Go to Work Orders.”
- **How do I use the parts catalog / find a part?** Explain: go to Parts from the Inventory section; use search/filters; for barcode scanning, use the scan bridge or decode-image API (see barcode doc).
- **Why can’t I close this work order?** Use failure-diagnosis playbook: check vehicle/customer/location, parts status, and status transitions.
- **How do I send a driver onboarding packet?** Explain: use the Drivers/DQF flow, open the send-packet modal, enter phone/email, choose SMS/email/both, send.
- **Why is my integration not syncing?** Use failure-diagnosis playbook: check credentials, configuration, and integration status page.

When answering, the AI should cite this application knowledge and the other docs in `docs/` and offer concrete suggestions (navigation or work order draft) when relevant.
