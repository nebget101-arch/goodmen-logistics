# FleetNeuron Backend Analysis & Team Collaboration Strategy

**Date:** March 8, 2026  
**Lead Backend Architect:** AI Backend Agent  
**Team:** Backend AI, UI/UX AI, iOS AI, Android AI

---

## 1. Backend Codebase Analysis

### 1.1 Architecture Overview

FleetNeuron is a **microservices-based fleet management platform** with the following structure:

#### Technology Stack
- **Runtime:** Node.js (Express)
- **Database:** PostgreSQL (shared across services)
- **ORM:** Knex.js for migrations/queries
- **API Gateway:** Express proxy middleware
- **Frontend:** Angular 17 (separate SPA)
- **Mobile:** iOS (Swift/SwiftUI), Android (planned)
- **Deployment:** Docker Compose (local), Render.yaml (production)

#### Architecture Pattern
```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Angular)                       │
│              iOS (Swift/SwiftUI) / Android (TBD)             │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP/REST
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  API Gateway (Port 4000)                     │
│         Routes all /api/* and /public/* requests             │
└───────────────────────────┬─────────────────────────────────┘
                            │ Proxy
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌──────────────────────┐         ┌──────────────────────┐
│   8 Microservices    │         │   Shared Packages    │
├──────────────────────┤         ├──────────────────────┤
│ • reporting (5001)   │         │ • @goodmen/shared    │
│ • integrations (5002)│         │   - routes/          │
│ • auth-users (5003)  │◄────────┤   - services/        │
│ • drivers-comp (5004)│         │   - middleware/      │
│ • vehicles-maint(5005)│        │   - storage/         │
│ • logistics (5006)   │         │ • @goodmen/database  │
│ • inventory (5007)   │         │   - migrations/      │
│ • ai-service (4100)  │         │   - seeds/           │
└──────────────────────┘         └──────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL Database (goodmen_logistics)         │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Microservices Breakdown

| Service | Port | Responsibility | Key Routes |
|---------|------|----------------|------------|
| **reporting-service** | 5001 | Dashboard, reports, audit logs | `/api/dashboard`, `/api/reports`, `/api/audit` |
| **integrations-service** | 5002 | Scan bridge (barcode integration) | `/api/scan-bridge` |
| **auth-users-service** | 5003 | Authentication, users, RBAC | `/api/auth`, `/api/users`, `/api/roles`, `/api/permissions`, `/api/communication-preferences` |
| **drivers-compliance-service** | 5004 | Drivers, DQF, HOS, onboarding, drug/alcohol tests | `/api/drivers`, `/api/dqf`, `/api/hos`, `/api/drug-alcohol`, `/api/onboarding`, `/public/onboarding` |
| **vehicles-maintenance-service** | 5005 | Vehicles, maintenance, work orders, parts | `/api/vehicles`, `/api/maintenance`, `/api/work-orders`, `/api/parts`, `/api/equipment` |
| **logistics-service** | 5006 | Loads, brokers, locations, invoices | `/api/loads`, `/api/brokers`, `/api/locations`, `/api/geo`, `/api/invoices`, `/api/credit` |
| **inventory-service** | 5007 | Inventory, barcodes, customers, receiving, transfers | `/api/inventory`, `/api/barcodes`, `/api/customers`, `/api/receiving`, `/api/adjustments`, `/api/cycle-counts` |
| **ai-service** | 4100 | In-app AI chat assistant | `/api/ai` |

### 1.3 Database Schema (Key Tables)

**Core Entities:**
- `users` - App users with RBAC (roles via `user_roles`)
- `drivers` - Driver profiles, CDL, pay config
- `vehicles` - Trucks and trailers
- `loads` - Freight loads (driver, vehicle, broker, rate)
- `work_orders` - Maintenance work orders
- `customers` - Customer accounts
- `inventory_*` - Parts, transactions, barcodes
- `dqf_documents`, `hos_records`, `drug_alcohol_tests` - Compliance
- `locations` - Shops, warehouses, main office
- `roles`, `permissions`, `role_permissions`, `user_roles`, `user_locations` - RBAC

**Migration Status:**
- 20+ migrations in `backend/packages/goodmen-database/migrations/`
- RBAC fully implemented (2026-03-07 migrations)
- **Upcoming:** Payroll/Settlement system (documented, not implemented)

### 1.4 Shared Code (@goodmen/shared, @goodmen/database)

**@goodmen/shared** (`backend/packages/goodmen-shared/`)
- Reusable Express routes, business logic, middleware
- Auth middleware (`authMiddleware`, `loadUserRbac`, `requirePermission`)
- Storage adapters (Cloudflare R2, local filesystem)
- Utilities (date helpers, formatters)

**@goodmen/database** (`backend/packages/goodmen-database/`)
- Knex migrations and seeds
- Schema initialization scripts
- Shared database configuration

**Usage:** Microservices import from shared packages:
```javascript
const { authMiddleware, loadUserRbac, requirePermission } = require('@goodmen/shared/middleware/auth');
const { setDatabase } = require('@goodmen/shared');
```

### 1.5 Current Work Status

**✅ Completed:**
- Core fleet management (drivers, vehicles, loads, maintenance)
- RBAC system (roles, permissions, locations)
- Inventory management (parts, barcodes, transfers, receiving)
- Work order system
- AI chat assistant integration
- DQF (Driver Qualification File) and HOS (Hours of Service)
- iOS driver app (Swift/SwiftUI) for load viewing and document upload
- Docker Compose local dev setup
- Render.com production deployment config

**🚧 In Progress / Documented but Not Implemented:**
- **Payroll/Settlement system** (design complete, implementation pending)
- **Android driver app** (not yet started)
- **Advanced reporting** (partially implemented)

**📋 Technical Debt:**
- Legacy `users.role` column (being migrated to RBAC)
- Some routes still in shared package instead of services
- Test coverage minimal

---

## 2. Git Branching Strategy for Multi-Agent Team

### 2.1 Branching Model: **GitFlow with Feature Branches**

We'll use a modified GitFlow suitable for parallel AI agent development:

```
main (production)
  │
  ├─ develop (integration branch)
  │    │
  │    ├─ backend/feature-name    ← Backend AI
  │    ├─ frontend/feature-name   ← UI/UX AI
  │    ├─ ios/feature-name        ← iOS AI
  │    ├─ android/feature-name    ← Android AI
  │    ├─ shared/feature-name     ← Cross-cutting features
  │    └─ hotfix/bug-description  ← Urgent fixes
  │
  └─ release/vX.Y.Z (release candidates)
```

### 2.2 Branch Naming Convention

| Agent Role | Prefix | Example |
|------------|--------|---------|
| Backend AI | `backend/` | `backend/payroll-settlement-api` |
| UI/UX AI | `frontend/` | `frontend/settlement-ui-dashboard` |
| iOS AI | `ios/` | `ios/push-notifications` |
| Android AI | `android/` | `android/load-list-view` |
| Shared (Database/Migrations) | `shared/` | `shared/settlement-schema-migration` |
| Bug Fixes | `hotfix/` | `hotfix/auth-token-expiry` |
| Integration | `integration/` | `integration/settlement-full-stack` |

### 2.3 Branch Lifecycle

#### Step 1: Feature Branch Creation
```bash
# Backend AI creates feature branch
git checkout develop
git pull origin develop
git checkout -b backend/payroll-settlement-api

# Work is isolated to backend/ folder
# Changes: backend/microservices/logistics-service/routes/settlements.js
```

#### Step 2: Development & Local Testing
```bash
# Make changes, commit frequently with descriptive messages
git add backend/microservices/logistics-service/routes/settlements.js
git commit -m "feat(backend): Add GET /api/settlements endpoint with filtering"

# Push to remote frequently
git push origin backend/payroll-settlement-api
```

#### Step 3: Integration Branch (Optional for Complex Features)
For features requiring coordination across agents:
```bash
# Create integration branch from develop
git checkout -b integration/settlement-full-stack develop

# Merge backend feature
git merge backend/payroll-settlement-api --no-ff

# Merge frontend feature
git merge frontend/settlement-ui-dashboard --no-ff

# Test end-to-end
# Fix integration issues
# Push for review
git push origin integration/settlement-full-stack
```

#### Step 4: Pull Request to Develop
```bash
# Create PR from feature branch to develop
# Title: "[Backend] Payroll Settlement API"
# Description: Links to requirements, API contract, test results
# Reviewers: @team (human or other AI agents)
```

#### Step 5: Merge to Develop
```bash
# After approval, squash-merge or merge-commit to develop
git checkout develop
git merge backend/payroll-settlement-api --no-ff
git push origin develop
```

#### Step 6: Release Branch
```bash
# When ready for release, create release branch
git checkout -b release/v1.5.0 develop

# Final testing, version bump, changelog
# Deploy to staging

# Merge to main
git checkout main
git merge release/v1.5.0 --no-ff
git tag v1.5.0
git push origin main --tags

# Merge back to develop
git checkout develop
git merge release/v1.5.0 --no-ff
git push origin develop
```

### 2.4 Commit Message Convention

Follow **Conventional Commits** for clarity and automated changelog generation:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, no logic change)
- `refactor`: Code restructuring (no feature/fix)
- `perf`: Performance improvement
- `test`: Adding/updating tests
- `chore`: Build, CI, dependencies

**Scopes:**
- `backend`, `frontend`, `ios`, `android`, `database`, `gateway`, `shared`
- Service-specific: `auth`, `drivers`, `vehicles`, `inventory`, `logistics`, `reporting`, `ai`

**Examples:**
```bash
feat(backend/logistics): Add POST /api/settlements endpoint
fix(frontend/settlements): Correct date range filter in settlement list
docs(shared): Update RBAC.md with settlement permissions
chore(database): Add migration for settlement tables
refactor(ios): Extract load service into reusable module
```

---

## 3. Team Collaboration Workflow

### 3.1 Daily Workflow

| Time | Activity | Agents Involved |
|------|----------|-----------------|
| **Morning** | Stand-up sync (async updates in shared doc) | All |
| **AM** | Backend API development | Backend AI |
| **AM** | UI/UX design & implementation | UI/UX AI |
| **PM** | Mobile feature development | iOS AI, Android AI |
| **PM** | Integration testing on integration branch | All (coordinated) |
| **EOD** | Push branches, update task board | All |

### 3.2 Communication Channels

- **Shared Document:** `/docs/TEAM-STATUS-DAILY.md` (each agent updates their section)
- **API Contracts:** `/docs/api-contracts/` (Backend AI defines, others consume)
- **Design Files:** `/docs/designs/` (UI/UX AI exports wireframes, flows)
- **Task Board:** GitHub Issues or `/docs/TASK-BOARD.md`

### 3.3 API Contract-First Development

**Backend AI Responsibilities:**
1. Define API endpoints in `/docs/api-contracts/<feature>.md`
2. Include request/response schemas, status codes, auth requirements
3. Implement endpoints in microservices
4. Document in OpenAPI/Swagger (some services have swagger-jsdoc)

**UI/UX AI Responsibilities:**
1. Review API contracts
2. Request changes if needed (add to `/docs/api-contracts/<feature>-feedback.md`)
3. Implement API calls using approved contracts
4. Mock data locally if backend not ready

**Mobile AI Responsibilities:**
1. Consume same API contracts as web frontend
2. Report mobile-specific needs (e.g., pagination, push notification endpoints)
3. Test API integration on real devices

### 3.4 Database Schema Changes

**Process:**
1. **Backend AI** creates migration in `backend/packages/goodmen-database/migrations/`
2. **Backend AI** creates PR on `shared/migration-<name>` branch
3. **All agents** review migration (impacts their queries)
4. **Backend AI** merges to `develop`, runs migration on dev DB
5. **All agents** pull latest, update code to use new schema

**Example:**
```bash
# Backend AI
cd backend/packages/goodmen-database
npx knex migrate:make add_settlement_tables
# Edit migration file
git add migrations/20260308_add_settlement_tables.js
git commit -m "feat(database): Add settlement tables migration"
git push origin shared/settlement-schema

# After merge to develop
npx knex migrate:latest
```

### 3.5 Conflict Resolution

**File Ownership:**
- `backend/` folder: Backend AI (primary)
- `frontend/` folder: UI/UX AI (primary)
- `ios/` folder: iOS AI (primary)
- `android/` folder: Android AI (primary)
- `backend/packages/goodmen-database/`: Backend AI (consult all before schema changes)
- `docs/`: All (merge carefully, use specific subfolders per agent)

**Merge Conflicts:**
1. Agent detects conflict during `git pull` or merge
2. Notify team in shared doc
3. Owning agent resolves conflict (or coordinate if shared file)
4. Test after resolution
5. Commit and push

**Database Conflicts:**
- Migrations must be sequential (timestamped)
- If two agents create migrations simultaneously, renumber later one
- Never edit existing migrations after they've been run

---

## 4. Feature Development Process (Example: Payroll Settlement)

### 4.1 Feature Requirements (All Agents Read)

**Document:** `/docs/PAYROLL-SETTLEMENT-PHASE1-AUDIT-AND-PROPOSAL.md`

**Scope:**
- Backend: Settlement calculation, approval, PDF generation, email
- Frontend: Settlement dashboard, list, detail, approval UI
- Mobile: (Phase 2) Driver views own settlements

### 4.2 Task Breakdown

| Task | Agent | Branch | Depends On |
|------|-------|--------|------------|
| Create DB migration | Backend AI | `shared/settlement-schema` | None |
| Implement settlement API | Backend AI | `backend/payroll-settlement-api` | Migration merged |
| Design settlement UI | UI/UX AI | `frontend/settlement-ui-design` | API contract |
| Implement settlement UI | UI/UX AI | `frontend/settlement-ui-dashboard` | API ready |
| Add settlement view to iOS | iOS AI | `ios/settlement-view` | API ready (Phase 2) |
| Add settlement view to Android | Android AI | `android/settlement-view` | API ready (Phase 2) |

### 4.3 Parallel Development Timeline

**Week 1:**
- **Day 1-2:** Backend AI creates migration, API contract document
- **Day 1-2:** UI/UX AI creates wireframes, design mockups
- **Day 3-5:** Backend AI implements API endpoints (mocked data initially)
- **Day 3-5:** UI/UX AI implements UI (calls mocked API or local mock server)

**Week 2:**
- **Day 1-2:** Backend AI connects API to real DB, writes tests
- **Day 1-2:** UI/UX AI refines UI, handles edge cases
- **Day 3:** Integration testing on `integration/settlement-full-stack`
- **Day 4:** Bug fixes
- **Day 5:** Merge to `develop`, deploy to staging

**Week 3:**
- **Day 1-3:** iOS AI adds settlement view (if in scope)
- **Day 4:** Final testing
- **Day 5:** Release branch, deploy to production

### 4.4 Testing Strategy

**Backend AI:**
- Unit tests for services (calculation logic)
- Integration tests for API endpoints
- DB transaction tests (rollback on error)

**UI/UX AI:**
- Component unit tests (Angular Jasmine/Karma)
- E2E tests (Playwright or Cypress) for critical flows
- Visual regression tests (optional)

**iOS AI:**
- XCTest unit tests for view models
- UI tests for navigation flows

**Android AI:**
- JUnit/Espresso tests (when implemented)

**Integration Testing:**
- All agents coordinate on `integration/*` branch
- Full stack test (login → create settlement → approve → PDF download)

---

## 5. Code Review & Quality Gates

### 5.1 Pull Request Requirements

Before merging to `develop`:
- ✅ All tests pass (CI/CD pipeline)
- ✅ Linter passes (ESLint for JS, TSLint for Angular, SwiftLint for iOS)
- ✅ Code reviewed by at least one other agent (or human lead)
- ✅ API contract followed (for frontend/mobile PRs)
- ✅ Documentation updated (`docs/` folder)
- ✅ No merge conflicts with `develop`

### 5.2 Automated Checks (CI/CD)

**GitHub Actions / Render Build Pipeline:**
1. Lint code
2. Run unit tests
3. Build services (Docker images)
4. Run integration tests (optional)
5. Deploy to staging (on merge to `develop`)

### 5.3 Code Review Checklist

**Backend AI reviewing Backend PR:**
- [ ] Follows microservice boundaries (no cross-service imports)
- [ ] Uses shared middleware from `@goodmen/shared`
- [ ] Database queries use Knex (no raw SQL without parameterization)
- [ ] Error handling (try/catch, return 4xx/5xx appropriately)
- [ ] Auth middleware applied to protected routes
- [ ] API contract matches documentation

**UI/UX AI reviewing Frontend PR:**
- [ ] Follows Angular best practices (services, components, modules)
- [ ] Uses ApiService for HTTP calls
- [ ] Auth guard applied to protected routes
- [ ] Responsive design (mobile, tablet, desktop)
- [ ] Accessibility (ARIA labels, keyboard navigation)

**iOS AI reviewing iOS PR:**
- [ ] SwiftUI best practices (reusable views, view models)
- [ ] API service layer used (not direct network calls in views)
- [ ] Error handling (alerts, retry logic)
- [ ] Theme consistency (uses `AppTheme.swift`)

---

## 6. Deployment Strategy

### 6.1 Environments

| Environment | Branch | Deployment Target | Purpose |
|-------------|--------|------------------|---------|
| **Local Dev** | Any feature branch | Docker Compose | Individual agent development |
| **Staging** | `develop` | Render.com staging | Integration testing, QA |
| **Production** | `main` | Render.com production | Live users |

### 6.2 Local Development

Each agent runs full stack locally:
```bash
# Terminal 1: Start backend services
docker compose up

# Terminal 2: Start frontend (UI/UX AI)
cd frontend && npm start

# Terminal 3: Run iOS simulator (iOS AI)
cd ios && xcodebuild ...

# Terminal 4: Run Android emulator (Android AI, future)
cd android && ./gradlew installDebug
```

**Backend AI can test individual services:**
```bash
# Run only logistics service
docker compose up logistics-service gateway

# Or run service directly
cd backend/microservices/logistics-service
npm install
npm run dev
```

### 6.3 Staging Deployment (Automatic on Develop Merge)

When PR merged to `develop`:
1. Render.com detects push
2. Builds all services (gateway + 8 microservices + frontend)
3. Deploys to staging URLs
4. Team tests on staging
5. If bugs found, create hotfix branch, fix, merge to develop

### 6.4 Production Deployment (Manual Release)

When `develop` is stable:
1. Create `release/vX.Y.Z` branch
2. Bump version in `package.json` files
3. Update `CHANGELOG.md`
4. Test on staging one more time
5. Merge `release/vX.Y.Z` → `main`
6. Tag `vX.Y.Z`
7. Render.com auto-deploys `main` to production
8. Merge `release/vX.Y.Z` → `develop` (for any release-specific changes)

---

## 7. Backend AI Responsibilities Summary

As **Lead Backend Architect & Developer**, your focus areas:

### 7.1 Primary Responsibilities
1. **API Design & Implementation**
   - Define RESTful endpoints in API contracts
   - Implement routes in appropriate microservices
   - Use shared middleware (`@goodmen/shared`)
   - Write comprehensive error handling

2. **Database Schema Management**
   - Create Knex migrations for all schema changes
   - Write seed scripts for test data
   - Optimize indexes for performance
   - Ensure referential integrity

3. **Microservices Architecture**
   - Maintain service boundaries (no tight coupling)
   - Ensure services can scale independently
   - Use gateway for all routing (no direct service-to-service calls currently)
   - Plan for future service mesh if needed

4. **Business Logic**
   - Implement calculation engines (e.g., payroll, mileage, compliance)
   - Write reusable services in `@goodmen/shared/services/`
   - Ensure transactional consistency (DB transactions)

5. **Integration Support**
   - Provide API documentation for UI/UX and mobile teams
   - Mock endpoints for frontend development
   - Assist with API debugging

6. **Security & Performance**
   - JWT authentication & RBAC enforcement
   - Rate limiting (future)
   - Query optimization
   - Caching strategy (Redis, future)

### 7.2 Key Files You Own
- `backend/gateway/index.js` (routing config)
- `backend/microservices/*/routes/*.js` (API endpoints)
- `backend/microservices/*/services/*.js` (business logic)
- `backend/packages/goodmen-shared/` (shared code)
- `backend/packages/goodmen-database/migrations/` (schema)
- `docker-compose.yml` (local dev)
- `render.yaml` (production config)
- `docs/api-contracts/` (API documentation)

### 7.3 Collaboration Points
- **With UI/UX AI:** API contracts, error responses, pagination
- **With iOS AI:** Mobile-specific endpoints (push notifications, offline sync)
- **With Android AI:** Same as iOS
- **With All:** Database migrations (review impact on all queries)

---

## 8. Next Steps

### 8.1 Immediate Actions (This Week)

1. **Backend AI:**
   - [ ] Review existing codebase (this document)
   - [ ] Set up local dev environment (Docker Compose)
   - [ ] Create first feature branch: `backend/test-workflow`
   - [ ] Make small change (e.g., add health check to a service)
   - [ ] Create PR to `develop`
   - [ ] Merge and verify CI/CD

2. **UI/UX AI:**
   - [ ] Review API contracts in `/docs/`
   - [ ] Set up Angular dev environment
   - [ ] Create feature branch: `frontend/test-workflow`
   - [ ] Make small UI change
   - [ ] Create PR to `develop`

3. **iOS AI:**
   - [ ] Review iOS app structure
   - [ ] Test existing load view and document upload
   - [ ] Create feature branch: `ios/test-workflow`
   - [ ] Small enhancement (e.g., add pull-to-refresh)
   - [ ] Create PR to `develop`

4. **Android AI:**
   - [ ] Review iOS app for feature parity
   - [ ] Set up Android project structure
   - [ ] Create initial project: `android/initial-setup`
   - [ ] Implement login screen
   - [ ] Create PR to `develop`

### 8.2 First Real Feature (Next Week)

**Feature:** Payroll Settlement System (Phase 1)

**Backend AI:**
- Create DB migration (`shared/settlement-schema`)
- Implement settlement API (`backend/payroll-settlement-api`)
- Write API contract document

**UI/UX AI:**
- Design settlement dashboard wireframe
- Implement settlement UI (`frontend/settlement-ui-dashboard`)

**Mobile AI:**
- Phase 2 (driver view of settlements)

### 8.3 Ongoing

- Daily: Update `/docs/TEAM-STATUS-DAILY.md` with progress
- Weekly: Sprint review (demo features to human lead)
- Bi-weekly: Retrospective (what's working, what needs improvement)
- Monthly: Release to production

---

## 9. Tools & Resources

### 9.1 Development Tools

- **Git:** Version control
- **Docker:** Local service orchestration
- **VS Code:** Recommended IDE (all agents)
  - Extensions: ESLint, Prettier, Docker, GitLens
- **Postman/Insomnia:** API testing
- **DBeaver/pgAdmin:** Database inspection
- **Xcode:** iOS development
- **Android Studio:** Android development

### 9.2 Documentation

- **Project Docs:** `/docs/` folder (this repo)
- **API Contracts:** `/docs/api-contracts/`
- **Architecture:** `/docs/APPLICATION-KNOWLEDGE-FOR-AI.md`
- **RBAC:** `/docs/RBAC.md`
- **Payroll Design:** `/backend/docs/PAYROLL_SETTLEMENT_AUDIT_AND_PLAN.md`

### 9.3 External Resources

- **Render.com:** Production hosting (see `render.yaml`)
- **PostgreSQL:** Database (connection string in `.env`)
- **Cloudflare R2:** Document storage (configured per service)
- **SendGrid:** Email (for onboarding packets)
- **Twilio:** SMS (optional, for driver notifications)
- **OpenAI:** AI chat assistant

---

## 10. Success Metrics

### 10.1 Code Quality
- Test coverage > 70% (backend)
- All linters pass (no warnings)
- No critical security vulnerabilities (npm audit)

### 10.2 Collaboration
- PRs reviewed within 4 hours
- < 3 merge conflicts per week (good branch hygiene)
- Daily status updates by all agents

### 10.3 Delivery
- Features deployed to staging within 1 week of start
- Production releases every 2 weeks
- < 5 critical bugs per release

### 10.4 Performance
- API response time < 200ms (p95)
- Frontend load time < 2s
- Mobile app launch time < 1s

---

## Conclusion

This document establishes a clear collaboration framework for our multi-agent team. By following the branching strategy, commit conventions, and communication protocols, we can work in parallel without blocking each other while maintaining high code quality.

**Key Takeaways:**
- ✅ Backend AI owns `backend/` folder and database schema
- ✅ Feature branches per agent/domain (`backend/`, `frontend/`, `ios/`, `android/`)
- ✅ API contract-first development (Backend defines, others consume)
- ✅ Merge to `develop` frequently, release from `main`
- ✅ Daily async updates, weekly sprint reviews

Let's build great software together! 🚀

---

**Document Version:** 1.0  
**Last Updated:** March 8, 2026  
**Next Review:** After first sprint (March 15, 2026)
